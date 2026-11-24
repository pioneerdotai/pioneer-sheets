import type * as Y from "yjs";
import type { DatabaseTransaction } from "../db/database";
import { units, revisions, journal, drafts } from "../db/schema/documents";
import { encode, type Snapshot } from "../../shared/documents/model";
import { identityReference, type IdentityReference } from "../../shared/types";
import type { OfficeService } from "./service";
import { encodeRecord } from "./record-codec";

export type PersistHook = (
  tx: DatabaseTransaction,
  data: Snapshot,
  who: IdentityReference,
  id: string,
  revision: number,
) => Promise<void>;

// Main documents and drafts use the same atomic initial checkpoint/revision.
export async function insertDocument(
  service: Pick<OfficeService, "storage" | "kind">,
  model: Y.Doc,
  data: Snapshot,
  who: IdentityReference,
  message: string,
  persisted: PersistHook,
  draft?: { sourceId: string; baseRevision: number },
) {
  const record = await encodeRecord(encode(model), true);
  const now = Date.now();
  const id = data.id as string;
  await service.storage.transaction(async (tx) => {
    await tx.insert(units).values({
      id,
      title: String(service.kind === "sheet" ? data.name : data.title).slice(
        0,
        200,
      ),
      kind: service.kind,
      ownerId: who.id,
      revision: 0,
      sequence: 0,
      checkpointSequence: 0,
      checkpointSize: record.rawSize,
      deltaBytes: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      starred: false,
    });
    await tx.insert(journal).values({
      ...record,
      documentId: id,
      sequence: 0,
      kind: "checkpoint",
    });
    await persisted(tx, data, who, id, 0);
    await tx.insert(revisions).values({
      documentId: id,
      revision: 0,
      sequence: 0,
      actor: JSON.stringify(identityReference(who)),
      message,
      createdAt: now,
    });
    if (draft)
      await tx.insert(drafts).values({ id, ...draft, status: "draft" });
  });
}
