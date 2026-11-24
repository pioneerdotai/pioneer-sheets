import { and, eq, desc, isNull, isNotNull } from "drizzle-orm";
import { ServiceError } from "../documents/error";
import type { DatabaseReader } from "../db/database";
import type { IdentityReference } from "../../shared/types";
import {
  files,
  fileBlobs,
  fileVersions,
  fileRefs,
  fileLeases,
} from "../db/schema/files";
import type { FileService } from "./service";
import { cleanFilename } from "./validation";
import { checkedId } from "./validation";

type Service = Pick<
  FileService,
  "ready" | "service" | "require" | "versions" | "references"
>;

export async function require(
  service: Service,
  id: string,
  who: IdentityReference,
  write = false,
  version?: number,
  reader: DatabaseReader = service.service.storage.db,
) {
  await service.ready;
  checkedId(id);
  const joined = (
    await reader
      .select({ file: files, version: fileVersions, blob: fileBlobs })
      .from(files)
      .leftJoin(
        fileVersions,
        and(
          eq(fileVersions.fileId, files.id),
          eq(fileVersions.version, version ?? files.head),
        ),
      )
      .leftJoin(fileBlobs, eq(fileBlobs.hash, fileVersions.hash))
      .where(eq(files.id, id))
  )[0];
  if (!joined) throw new ServiceError(404, "FILE_NOT_FOUND");
  return accessibleFile(service, joined, who, write, reader);
}

async function accessibleFile(
  service: Service,
  joined: {
    file: typeof files.$inferSelect;
    version: typeof fileVersions.$inferSelect | null;
    blob: typeof fileBlobs.$inferSelect | null;
  },
  who: IdentityReference,
  write = false,
  reader: DatabaseReader = service.service.storage.db,
) {
  const { file: row, version: v, blob } = joined;
  if (!v) throw new ServiceError(404, "FILE_VERSION_NOT_FOUND");
  const id = row.id,
    selected = v.version;
  if (row.ownerId !== who.id && (write || v.createdBy !== who.id)) {
    let allowed = false;
    const refs = await reader
      .select()
      .from(fileRefs)
      .where(
        write
          ? eq(fileRefs.fileId, id)
          : and(eq(fileRefs.fileId, id), eq(fileRefs.version, selected)),
      );
    for (const ref of refs.filter((ref) => ref.scope !== "runtime"))
      try {
        await service.service.require(ref.documentId, who, write, false, reader);
        allowed = true;
        break;
      } catch {}
    if (!allowed) throw new ServiceError(403, "FILE_ACCESS_DENIED");
  }
  if (!blob) throw new ServiceError(500, "FILE_BLOB_MISSING");
  return {
    ...row,
    version: selected,
    hash: v.hash,
    mime: v.mime,
    size: blob.size,
    versionName: v.name,
    createdBy: v.createdBy,
  };
}

export async function list(
  service: Service,
  who: IdentityReference,
  query = "",
  trash = false,
  offset = 0,
  limit = 50,
) {
  await service.ready;
  const rows = await service.service.storage.db
    .select({ file: files, version: fileVersions, blob: fileBlobs })
    .from(files)
    .leftJoin(
      fileVersions,
      and(
        eq(fileVersions.fileId, files.id),
        eq(fileVersions.version, files.head),
      ),
    )
    .leftJoin(fileBlobs, eq(fileBlobs.hash, fileVersions.hash))
    .where(trash ? isNotNull(files.deletedAt) : isNull(files.deletedAt))
    .orderBy(desc(files.updatedAt));
  const accessible = [];
  const search = query.toLowerCase();
  for (const row of rows) {
    if (!row.file.name.toLowerCase().includes(search)) continue;
    try {
      accessible.push(await accessibleFile(service, row, who));
    } catch (error) {
      if (
        !(error instanceof ServiceError) ||
        ![403, 404].includes(error.status)
      )
        throw error;
    }
  }
  return {
    total: accessible.length,
    items: accessible.slice(offset, offset + Math.min(100, limit)),
    offset,
    hasMore: offset + limit < accessible.length,
  };
}

export async function versions(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  await service.ready;
  checkedId(id);
  const all = await service.service.storage.db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.fileId, id))
    .orderBy(desc(fileVersions.version));
  const accessible = [];
  for (const version of all)
    try {
      await service.require(id, who, false, version.version);
      accessible.push(version);
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 403) throw error;
    }
  if (!accessible.length) await service.require(id, who);
  return accessible;
}

export async function references(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  const versions = await service.versions(id, who),
    allowed = new Set(versions.map((v) => v.version));
  const refs = await service.service.storage.db
    .select()
    .from(fileRefs)
    .where(eq(fileRefs.fileId, id));
  const row = (
    await service.service.storage.db
      .select()
      .from(files)
      .where(eq(files.id, id))
  )[0];
  if (row.ownerId === who.id) return refs;
  const visible = [];
  for (const ref of refs.filter(
    (r) => r.scope !== "runtime" && allowed.has(r.version),
  ))
    try {
      await service.service.require(ref.documentId, who);
      visible.push(ref);
    } catch {}
  return visible;
}

export async function manage(
  service: Service,
  id: string,
  who: IdentityReference,
  action: "rename" | "trash" | "restore" | "purge",
  name?: string,
) {
  await service.require(id, who, true);
  return service.service.locked("file-write:" + id, async () => {
    const row = await service.require(id, who, true);
    if (action === "purge") {
      if (row.ownerId !== who.id)
        throw new ServiceError(403, "FILE_OWNER_REQUIRED");
      if (!row.deletedAt) throw new ServiceError(409, "TRASH_FILE_FIRST");
      const refs = await service.references(id, who);
      const leases = await service.service.storage.db
        .select()
        .from(fileLeases)
        .where(eq(fileLeases.fileId, id));
      if (leases.length)
        throw new ServiceError(409, "FILE_USED_BY_JOB: " + leases.length);
      if (refs.length)
        throw new ServiceError(409, "FILE_REFERENCED: " + refs.length);
      await service.service.storage.write(() =>
        service.service.storage.db.delete(files).where(eq(files.id, id)),
      );
      return { purged: true };
    }
    await service.service.storage.write(() =>
      service.service.storage.db
        .update(files)
        .set({
          ...(action === "rename"
            ? { name: cleanFilename(name ?? "") }
            : { deletedAt: action === "trash" ? Date.now() : null }),
          updatedAt: Date.now(),
        })
        .where(eq(files.id, id)),
    );
    return service.require(id, who);
  });
}
