import { readCurrent } from "./current";
import { insertDocument } from "./persistence";
import type { PersistHook } from "./persistence";
import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drafts } from "../db/schema/documents";
import {
  fromUpdate,
  snapshot,
  base64,
  unbase64,
} from "../../shared/documents/model";
import { type IdentityReference } from "../../shared/types";
import type { OfficeService } from "./service";
import { ServiceError } from "./error";

type Service = Pick<
  OfficeService,
  | "describe"
  | "info"
  | "journal"
  | "require"
  | "storage"
  | "get"
  | "kind"
  | "locked"
  | "draftInfo"
  | "broadcast"
  | "update"
>;

export async function draftInfo(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  await service.require(id, who);
  return (
    (
      await service.storage.db.select().from(drafts).where(eq(drafts.id, id))
    )[0] ?? null
  );
}

export async function createDraft(
  service: Service,
  id: string,
  who: IdentityReference,
  persisted: PersistHook,
) {
  const source = await service.get(id, who);
  if (source.draft)
    throw new ServiceError(400, "Create a draft from the main document");
  const draftId = randomUUID();
  const model = fromUpdate(unbase64(source.update));
  model.transact(() => model.getMap("unit").set("id", draftId));
  try {
    await insertDocument(
      service,
      model,
      snapshot(model),
      who,
      `Draft from revision ${source.revision}`,
      persisted,
      { sourceId: id, baseRevision: source.revision },
    );
  } finally {
    model.destroy();
  }
  return service.get(draftId, who);
}

export async function reviewDraft(
  service: Service,
  id: string,
  who: IdentityReference,
  action: "ready" | "reopen" | "merge",
) {
  if (!["ready", "reopen", "merge"].includes(action))
    throw new ServiceError(400, "Unknown draft action");
  return service.locked(id, async () => {
    const branch = await service.draftInfo(id, who);
    if (!branch) throw new ServiceError(400, "This is not a draft");
    if (branch.status === "merged")
      return {
        status: "merged",
        revision: branch.mergedRevision,
        sourceId: branch.sourceId,
      };
    if (action !== "merge") {
      await service.require(id, who, true);
      await service.storage.write(() =>
        service.storage.db
          .update(drafts)
          .set({ status: action === "ready" ? "ready" : "draft" })
          .where(eq(drafts.id, id)),
      );
      service.broadcast(id, { type: "draft-state" });
      return service.draftInfo(id, who);
    }
    await service.require(branch.sourceId, who, true, true);
    if (branch.status !== "ready")
      throw new ServiceError(409, "Submit the draft for review first");
    const source = await service.get(branch.sourceId, who);
    const candidate = await readCurrent(service, id, who, false, false);
    const model = fromUpdate(unbase64(source.update));
    const vector = Y.encodeStateVector(model);
    Y.applyUpdate(model, unbase64(candidate.update));
    model.transact(() => model.getMap("unit").set("id", branch.sourceId));
    const update = base64(Y.encodeStateAsUpdate(model, vector));
    model.destroy();
    const result = await service.update(branch.sourceId, who, {
      update,
      requestId: `merge:${id}:${candidate.revision}`,
      message: `Merge draft ${id}`,
      expectedRevision: source.revision,
    });
    await service.storage.write(() =>
      service.storage.db
        .update(drafts)
        .set({ status: "merged", mergedRevision: result.revision })
        .where(eq(drafts.id, id)),
    );
    service.broadcast(id, { type: "draft-state" });
    return {
      status: "merged",
      revision: result.revision,
      sourceId: branch.sourceId,
    };
  });
}
