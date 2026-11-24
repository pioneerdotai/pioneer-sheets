import * as Y from "yjs";
import { and, eq, isNull } from "drizzle-orm";
import {
  units,
  revisions,
  receipts,
  drafts,
  journal,
} from "../db/schema/documents";
import {
  base64,
  unbase64,
  snapshot,
  writeSnapshot,
  validateSnapshot,
  type Snapshot,
} from "../../shared/documents/model";
import { sameContent } from "../../shared/documents/content";
import { identityReference, type IdentityReference } from "../../shared/types";
import type { OfficeService } from "./service";
import type { PersistHook } from "./persistence";
import type { DocumentHead, ResidentDocument } from "./journal";
import { ServiceError } from "./error";

export type UpdateRequest = {
  update: string;
  requestId: string;
  message?: string;
  expectedRevision?: number;
};

type Service = Pick<
  OfficeService,
  "storage" | "kind" | "journal" | "locked" | "require" | "broadcast"
>;
type EditRequest = Omit<UpdateRequest, "update">;

async function readForEdit(
  service: Service,
  id: string,
  who: IdentityReference,
  input: EditRequest,
  staleMessage = "The document has changed. Read the latest revision",
): Promise<
  { row: DocumentHead } | { result: { revision: number; duplicate: true } }
> {
  await service.require(id, who, true);
  const draft = (
    await service.storage.db.select().from(drafts).where(eq(drafts.id, id))
  )[0];
  if (draft && draft.status !== "draft")
    throw new ServiceError(409, "Draft is closed for editing");
  const row = await service.storage.get(id);
  if (!row || row.deletedAt)
    throw new ServiceError(410, "Document is unavailable");
  const receipt = (
    await service.storage.db
      .select()
      .from(receipts)
      .where(and(eq(receipts.documentId, id), eq(receipts.id, input.requestId)))
  )[0];
  if (receipt)
    return { result: { revision: receipt.revision, duplicate: true } };
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== row.revision
  )
    throw new ServiceError(409, staleMessage);

  return { row };
}

async function commit(
  service: Service,
  id: string,
  who: IdentityReference,
  input: EditRequest,
  apply: (entry: ResidentDocument) => Promise<Uint8Array>,
  persisted: PersistHook,
) {
  if (!input.requestId || input.requestId.length > 200)
    throw new ServiceError(400, "Invalid update");
  return service.locked(id, async () => {
    const checked = await readForEdit(service, id, who, input);
    if ("result" in checked) return checked.result;
    const { row } = checked;
    return service.journal.use(row, async (entry) => {
      let touched = false;
      const observe = () => {
        touched = true;
      };
      const unit = entry.doc.getMap("unit");
      unit.observeDeep(observe);
      let delta: Uint8Array;
      try {
        delta = await apply(entry);
      } finally {
        unit.unobserveDeep(observe);
      }
      if (delta.length > 22_500_000)
        throw new ServiceError(400, "Invalid update");
      const next = touched ? snapshot(entry.doc) : entry.data;
      if (touched) {
        if (next.id !== id)
          throw new ServiceError(400, "Cannot change the document ID");
        validateSnapshot(next, service.kind);
      }
      const changed = touched && !sameContent(entry.data, next);
      const revision = row.revision + (changed ? 1 : 0);
      const title = String(
        service.kind === "sheet" ? next.name : next.title,
      ).slice(0, 200);
      const now = Date.now();
      // Store every accepted causal delta, including view/cache changes and
      // updates waiting on dependencies. Only visible edits create revisions.
      const prepared = await service.journal.prepare(row, entry, delta);
      await service.storage.transaction(async (tx) => {
        const updated = await tx
          .update(units)
          .set({
            ...prepared.head,
            ...(changed ? { title, revision, updatedAt: now } : {}),
          })
          .where(
            and(
              eq(units.id, id),
              eq(units.sequence, row.sequence),
              isNull(units.deletedAt),
            ),
          )
          .returning({ id: units.id });
        if (!updated.length)
          throw new ServiceError(409, "Document sequence conflict");
        await tx.insert(journal).values(prepared.record);
        if (changed) {
          await persisted(tx, next, who, id, revision);
          await tx.insert(revisions).values({
            documentId: id,
            revision,
            sequence: prepared.head.sequence,
            actor: JSON.stringify(identityReference(who)),
            message: (input.message ?? "Edit").slice(0, 200),
            createdAt: now,
          });
        }
        await tx
          .insert(receipts)
          .values({ documentId: id, id: input.requestId, revision });
      });
      service.journal.committed(entry, prepared.head, next);
      service.broadcast(id, {
        type: "update",
        update: base64(delta),
        revision,
        requestId: input.requestId,
        actor: identityReference(who),
        title,
      });
      return { revision, duplicate: false };
    });
  });
}

export async function updateDocument(
  service: Service,
  id: string,
  who: IdentityReference,
  input: UpdateRequest,
  persisted: PersistHook,
) {
  if (input.update.length > 30_000_000)
    throw new ServiceError(400, "Invalid update");
  return commit(
    service,
    id,
    who,
    input,
    async (entry) => {
      const delta = unbase64(input.update);
      Y.applyUpdate(entry.doc, delta);
      return delta;
    },
    persisted,
  );
}

export async function mutateDocument(
  service: Service,
  id: string,
  who: IdentityReference,
  fn: (data: Snapshot) => void | Promise<void>,
  input: EditRequest,
  persisted: PersistHook,
) {
  if (!input.requestId || input.requestId.length > 200)
    throw new ServiceError(400, "Invalid update");
  const prepared = await service.locked(id, async () => {
    const checked = await readForEdit(
      service,
      id,
      who,
      input,
      "Stale revision",
    );
    if ("result" in checked) return checked;
    return service.journal.use(checked.row, async (entry) => ({
      revision: checked.row.revision,
      before: structuredClone(entry.data),
    }));
  });
  if ("result" in prepared) return prepared.result;
  const after = structuredClone(prepared.before);
  // Formula calculation/agent callbacks may be asynchronous. Keep them outside
  // the document lock; the existing revision guard rejects concurrent edits.
  await fn(after);
  validateSnapshot(after, service.kind);
  return commit(
    service,
    id,
    who,
    { ...input, expectedRevision: prepared.revision },
    async (entry) => {
      const updates: Uint8Array[] = [];
      const capture = (update: Uint8Array) => {
        updates.push(update);
      };
      entry.doc.on("update", capture);
      try {
        writeSnapshot(entry.doc, prepared.before, after);
      } finally {
        entry.doc.off("update", capture);
      }
      // Capture only this transaction, rather than re-encoding the whole book
      // or its historical deletion set to produce a server-side edit.
      return updates.length ? Y.mergeUpdates(updates) : new Uint8Array([0, 0]);
    },
    persisted,
  );
}
