import { join } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { ServiceError } from "../documents/error";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const MAX_CHUNK = 1024 * 1024;

export const MIME = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;

export function cleanFilename(name: string) {
  return (
    String(name)
      .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
      .trim()
      .slice(0, 240) || "file"
  );
}

export function checkedId(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id))
    throw new ServiceError(400, "INVALID_FILE_ID");
  return id;
}

export async function digestFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function blobPath(root: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("INVALID_BLOB_HASH");
  return join(root, "blobs", hash.slice(0, 2), hash);
}
