import { randomUUID } from "node:crypto";
import { mkdir, open, stat, link, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { ServiceError } from "../documents/error";
import type { IdentityReference } from "../../shared/types";
import {
  files,
  fileBlobs,
  fileVersions,
  fileUploads,
  fileWrites,
} from "../db/schema/files";
import type { FileService } from "./service";
import { MAX_FILE_BYTES } from "./validation";
import { MAX_CHUNK } from "./validation";
import { MIME } from "./validation";
import { cleanFilename } from "./validation";
import { checkedId } from "./validation";
import { digestFile } from "./validation";
import { blobPath } from "./validation";

type Service = Pick<
  FileService,
  | "ready"
  | "require"
  | "root"
  | "service"
  | "uploadStatus"
  | "commitPath"
  | "begin"
  | "append"
  | "finish"
  | "cancelUpload"
>;

export async function begin(
  service: Service,
  who: IdentityReference,
  input: {
    name: string;
    size: number;
    mime?: string;
    fileId?: string;
    checksum?: string;
    requestId?: string;
  },
) {
  await service.ready;
  if (
    !Number.isSafeInteger(input.size) ||
    input.size < 0 ||
    input.size > MAX_FILE_BYTES
  )
    throw new ServiceError(413, "FILE_SIZE_LIMIT");
  if (input.checksum && !/^[a-f0-9]{64}$/.test(input.checksum))
    throw new ServiceError(400, "INVALID_CHECKSUM");
  if (input.fileId) await service.require(input.fileId, who, true);
  const id = randomUUID(),
    now = Date.now(),
    value = {
      id,
      ownerId: who.id,
      fileId: input.fileId ?? null,
      name: cleanFilename(input.name),
      mime:
        input.mime && MIME.test(input.mime)
          ? input.mime
          : "application/octet-stream",
      size: input.size,
      received: 0,
      checksum: input.checksum ?? null,
      requestKey: input.requestId?.slice(0, 200) ?? null,
      status: "uploading",
      createdAt: now,
      expiresAt: now + 86400000,
      result: null,
    };
  const handle = await open(join(service.root, "uploads", id), "wx", 0o600);
  await handle.close();
  try {
    await service.service.storage.write(() =>
      service.service.storage.db.insert(fileUploads).values(value),
    );
  } catch (error) {
    await unlink(join(service.root, "uploads", id));
    throw error;
  }
  return {
    uploadId: id,
    received: 0,
    size: input.size,
    expiresAt: value.expiresAt,
    maxChunkBytes: MAX_CHUNK,
  };
}

export async function uploadStatus(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  await service.ready;
  checkedId(id);
  const row = (
    await service.service.storage.db
      .select()
      .from(fileUploads)
      .where(and(eq(fileUploads.id, id), eq(fileUploads.ownerId, who.id)))
  )[0];
  if (!row) throw new ServiceError(404, "UPLOAD_NOT_FOUND");
  return row;
}

export async function append(
  service: Service,
  id: string,
  who: IdentityReference,
  offset: number,
  body: ReadableStream<Uint8Array> | null,
) {
  return service.service.locked("upload:" + id, async () => {
    const row = await service.uploadStatus(id, who);
    if (row.status !== "uploading" || row.expiresAt < Date.now())
      throw new ServiceError(409, "UPLOAD_NOT_ACTIVE");
    if (offset !== row.received)
      throw new ServiceError(409, "UPLOAD_OFFSET_MISMATCH: " + row.received);
    if (!body) throw new ServiceError(400, "UPLOAD_BODY_REQUIRED");
    const handle = await open(join(service.root, "uploads", id), "r+");
    let written = 0;
    const reader = body.getReader();
    try {
      const info = await handle.stat();
      if (info.size < row.received) throw new Error("UPLOAD_TRUNCATED");
      await handle.truncate(row.received);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.length;
        if (written > MAX_CHUNK || row.received + written > row.size)
          throw new ServiceError(413, "UPLOAD_CHUNK_OR_SIZE_LIMIT");
        let start = 0;
        while (start < value.length) {
          const result = await handle.write(
            value,
            start,
            value.length - start,
            row.received + written - value.length + start,
          );
          start += result.bytesWritten;
        }
      }
      await handle.sync();
      await service.service.storage.write(() =>
        service.service.storage.db
          .update(fileUploads)
          .set({ received: row.received + written })
          .where(eq(fileUploads.id, id)),
      );
      return {
        uploadId: id,
        received: row.received + written,
        size: row.size,
      };
    } catch (error) {
      await handle.truncate(row.received);
      try {
        await reader.cancel();
      } catch {}
      throw error;
    } finally {
      reader.releaseLock();
      await handle.close();
    }
  });
}

export async function commitPath(
  service: Service,
  who: IdentityReference,
  path: string,
  input: {
    name: string;
    mime: string;
    size: number;
    fileId?: string | null;
    requestId?: string | null;
    checksum?: string | null;
  },
) {
  const hash = await digestFile(path);
  if (input.checksum && hash !== input.checksum)
    throw new ServiceError(422, "FILE_CHECKSUM_MISMATCH");
  const operation = async () => {
    if (input.requestId) {
      const prior = (
        await service.service.storage.db
          .select()
          .from(fileWrites)
          .where(
            and(
              eq(fileWrites.ownerId, who.id),
              eq(fileWrites.requestKey, input.requestId),
            ),
          )
      )[0];
      if (prior)
        return service.require(prior.fileId, who, false, prior.version);
    }

    const target = blobPath(service.root, hash);
    await mkdir(resolve(target, ".."), { recursive: true });
    try {
      await link(path, target);
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
    }
    const existing = input.fileId
      ? await service.require(input.fileId, who, true)
      : undefined;
    const id = existing?.id ?? randomUUID(),
      version = (existing?.head ?? 0) + 1,
      now = Date.now();
    await service.service.storage.transaction(async (tx) => {
      await tx
        .insert(fileBlobs)
        .values({ hash, size: input.size, createdAt: now })
        .onConflictDoNothing();
      if (existing)
        await tx
          .update(files)
          .set({
            head: version,
            updatedAt: now,
            name: input.name,
            deletedAt: null,
          })
          .where(eq(files.id, id));
      else
        await tx.insert(files).values({
          id,
          ownerId: who.id,
          name: input.name,
          head: version,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          requestKey: input.requestId ?? null,
        });
      await tx.insert(fileVersions).values({
        fileId: id,
        version,
        hash,
        mime: input.mime,
        name: input.name,
        createdBy: who.id,
        createdAt: now,
      });
      if (input.requestId)
        await tx.insert(fileWrites).values({
          ownerId: who.id,
          requestKey: input.requestId,
          fileId: id,
          version,
        });
    });
    return service.require(id, who, false, version);
  };
  return service.service.locked("blob:" + hash, () =>
    service.service.locked(
      "file-write:" +
        (input.fileId ?? who.id + ":" + (input.requestId ?? randomUUID())),
      operation,
    ),
  );
}

export async function finish(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  return service.service.locked("upload:" + id, async () => {
    const row = await service.uploadStatus(id, who);
    if (row.status === "complete") return JSON.parse(row.result!);
    if (row.status !== "uploading" || row.expiresAt < Date.now())
      throw new ServiceError(409, "UPLOAD_NOT_ACTIVE");
    if (row.received !== row.size)
      throw new ServiceError(409, "UPLOAD_INCOMPLETE");
    const path = join(service.root, "uploads", id);
    const info = await stat(path);
    if (info.size !== row.size)
      throw new ServiceError(409, "UPLOAD_SIZE_MISMATCH");
    const result = await service.commitPath(who, path, {
      name: row.name,
      mime: row.mime,
      size: row.size,
      fileId: row.fileId,
      requestId: row.requestKey ?? "upload:" + id,
      checksum: row.checksum,
    });
    await service.service.storage.write(() =>
      service.service.storage.db
        .update(fileUploads)
        .set({ status: "complete", result: JSON.stringify(result) })
        .where(eq(fileUploads.id, id)),
    );
    await unlink(path).catch(() => {});
    return result;
  });
}

export async function cancelUpload(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  return service.service.locked("upload:" + id, async () => {
    const row = await service.uploadStatus(id, who);
    if (row.status === "complete")
      throw new ServiceError(409, "UPLOAD_ALREADY_COMPLETE");
    await service.service.storage.write(() =>
      service.service.storage.db
        .update(fileUploads)
        .set({ status: "cancelled" })
        .where(eq(fileUploads.id, id)),
    );
    await unlink(join(service.root, "uploads", id)).catch(() => {});
    return { cancelled: true };
  });
}

export async function put(
  service: Service,
  who: IdentityReference,
  input: {
    name: string;
    mime: string;
    data: Uint8Array;
    fileId?: string;
    requestId?: string;
  },
) {
  const u = await service.begin(who, { ...input, size: input.data.length });
  try {
    for (let offset = 0; offset < input.data.length; offset += MAX_CHUNK) {
      const data = input.data.slice(offset, offset + MAX_CHUNK);
      await service.append(
        u.uploadId,
        who,
        offset,
        new ReadableStream({
          start(c) {
            c.enqueue(data);
            c.close();
          },
        }),
      );
    }
    return await service.finish(u.uploadId, who);
  } catch (error) {
    await service.cancelUpload(u.uploadId, who).catch(() => {});
    throw error;
  }
}
