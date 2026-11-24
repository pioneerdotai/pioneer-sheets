import { stat, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, lt, notExists } from "drizzle-orm";
import type { IdentityReference } from "../../shared/types";
import type { DatabaseTransaction } from "../db/database";
import type { Snapshot } from "../../shared/documents/model";
import {
  fileBlobs,
  fileVersions,
  fileRefs,
  fileUploads,
  fileLeases,
} from "../db/schema/files";
import {
  attachments,
  ATTACHMENTS_RESOURCE,
  collectFileReferences,
} from "../../shared/files";
import type { FileService } from "./service";
import { blobPath } from "./validation";

type Service = Pick<FileService, "require" | "service" | "ready" | "root">;

export async function attach(
  service: Service,
  documentId: string,
  who: IdentityReference,
  ref: { fileId: string; version?: number },
  remove = false,
) {
  const f = await service.require(ref.fileId, who, false, ref.version);
  return service.service.mutate(
    documentId,
    who,
    (data) => {
      const list = attachments(data).filter((r) => r.fileId !== f.id);
      if (!remove)
        list.push({ fileId: f.id, version: f.version, name: f.name });
      data.resources ??= [];
      const r = { name: ATTACHMENTS_RESOURCE, data: JSON.stringify(list) },
        index = data.resources.findIndex(
          (r: any) => r.name === ATTACHMENTS_RESOURCE,
        );
      if (index < 0) data.resources.push(r);
      else data.resources[index] = r;
    },
    remove ? "Detach attachment" : "Attach file",
  );
}

export async function pinInTransaction(
  service: Service,
  tx: DatabaseTransaction,
  data: Snapshot,
  who: IdentityReference,
  documentId: string,
  scope: string,
  scopeId: string,
) {
  const references = collectFileReferences(data);
  for (const ref of references)
    await service.require(ref.fileId, who, false, ref.version, tx);
  if (scope !== "revision")
    await tx
      .delete(fileRefs)
      .where(
        and(
          eq(fileRefs.documentId, documentId),
          eq(fileRefs.scope, scope),
          eq(fileRefs.scopeId, scopeId),
        ),
      );
  for (const ref of references)
    await tx
      .insert(fileRefs)
      .values({ ...ref, documentId, scope, scopeId, createdAt: Date.now() })
      .onConflictDoNothing();
}

export async function leaseInTransaction(
  service: Service,
  tx: DatabaseTransaction,
  who: IdentityReference,
  refs: Array<{ fileId: string; version: number }>,
  scope: string,
  scopeId: string,
) {
  for (const ref of refs) {
    await service.require(ref.fileId, who, false, ref.version, tx);
    await tx
      .insert(fileLeases)
      .values({ ...ref, ownerId: who.id, scope, scopeId })
      .onConflictDoNothing();
  }
}

export async function releaseLease(
  service: Service,
  scope: string,
  scopeId: string,
) {
  await service.ready;
  await service.service.storage.write(() =>
    service.service.storage.db
      .delete(fileLeases)
      .where(and(eq(fileLeases.scope, scope), eq(fileLeases.scopeId, scopeId))),
  );
}

export async function gc(service: Service, graceMs = 86400000) {
  await service.ready;
  const rows = await service.service.storage.db
    .select({ hash: fileBlobs.hash })
    .from(fileBlobs)
    .where(
      and(
        lt(fileBlobs.createdAt, Date.now() - graceMs),
        notExists(
          service.service.storage.db
            .select({ fileId: fileVersions.fileId })
            .from(fileVersions)
            .where(eq(fileVersions.hash, fileBlobs.hash)),
        ),
      ),
    );
  let removed = 0;
  for (const row of rows) {
    const hash = String(row.hash);
    await service.service.locked("blob:" + hash, () =>
      service.service.storage.transaction(async (tx) => {
        const refs = await tx
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.hash, hash));
        if (refs.length) return;
        await unlink(blobPath(service.root, hash)).catch((error: any) => {
          if (error.code !== "ENOENT") throw error;
        });
        await tx.delete(fileBlobs).where(eq(fileBlobs.hash, hash));
        removed++;
      }),
    );
  }
  for (const directory of await readdir(join(service.root, "blobs"), {
    withFileTypes: true,
  }))
    if (directory.isDirectory() && /^[a-f0-9]{2}$/.test(directory.name))
      for (const hash of await readdir(
        join(service.root, "blobs", directory.name),
      )) {
        if (!/^[a-f0-9]{64}$/.test(hash)) continue;
        const info = await stat(blobPath(service.root, hash));
        if (info.mtimeMs > Date.now() - graceMs) continue;
        await service.service.locked("blob:" + hash, async () => {
          const known = await service.service.storage.db
            .select()
            .from(fileBlobs)
            .where(eq(fileBlobs.hash, hash));
          if (!known.length) {
            await unlink(blobPath(service.root, hash)).catch(() => {});
            removed++;
          }
        });
      }
  const expired = await service.service.storage.db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.status, "uploading"));
  for (const u of expired)
    if (u.expiresAt < Date.now()) {
      await unlink(join(service.root, "uploads", u.id)).catch(() => {});
      await service.service.storage.write(() =>
        service.service.storage.db
          .update(fileUploads)
          .set({ status: "expired" })
          .where(eq(fileUploads.id, u.id)),
      );
    }
  return { removed };
}
