import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { ServiceError } from "../documents/error";
import type { IdentityReference } from "../../shared/types";
import type { Snapshot } from "../../shared/documents/model";
import { parseFileSource } from "../../shared/files";
import type { FileService } from "./service";
import { blobPath } from "./validation";

type Service = Pick<FileService, "require" | "read" | "root">;

export async function read(
  service: Service,
  id: string,
  who: IdentityReference,
  version?: number,
) {
  const info = await service.require(id, who, false, version);
  const data = await readFile(blobPath(service.root, info.hash));
  if (
    data.length !== info.size ||
    createHash("sha256").update(data).digest("hex") !== info.hash
  )
    throw new ServiceError(500, "FILE_INTEGRITY_FAILURE");
  return { ...info, data };
}

export async function materialize(
  service: Service,
  data: Snapshot,
  who: IdentityReference,
) {
  const copy = structuredClone(data),
    resolved = new Map<string, string>(),
    imageRefs = new Map<string, any>();
  const collect = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "source" && parseFileSource(item))
        imageRefs.set(String(item), parseFileSource(item));
      else if (item && typeof item === "object") collect(item);
    }
  };
  collect(copy);
  for (const r of copy.resources ?? [])
    try {
      collect(JSON.parse(r.data));
    } catch {}
  for (const [source, ref] of imageRefs) {
    const f = await service.read(ref.fileId, who, ref.version);
    resolved.set(
      source,
      "data:" + f.mime + ";base64," + f.data.toString("base64"),
    );
  }
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "source" && typeof item === "string" && resolved.has(item)) {
        value.pioneerFileSource = item;
        value[key] = resolved.get(item);
        value.imageSourceType = "BASE64";
      } else if (item && typeof item === "object") visit(item);
    }
  };
  visit(copy);
  for (const r of copy.resources ?? [])
    try {
      const value = JSON.parse(r.data);
      visit(value);
      r.data = JSON.stringify(value);
    } catch {}
  return copy;
}

export async function response(
  service: Service,
  id: string,
  who: IdentityReference,
  request: Request,
  version?: number,
) {
  const info = await service.require(id, who, false, version),
    etag = '"' + info.hash + '"',
    headers: Record<string, string> = {
      "Content-Type": info.mime,
      "Content-Length": String(info.size),
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Disposition":
        "attachment; filename*=UTF-8''" + encodeURIComponent(info.name),
    };
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  if (
    inline &&
    /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(info.mime)
  )
    headers["Content-Disposition"] =
      "inline; filename*=UTF-8''" + encodeURIComponent(info.name);
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (
    range &&
    (!request.headers.has("if-range") ||
      request.headers.get("if-range") === etag)
  ) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: {
          ...headers,
          "Content-Length": "0",
          "Content-Range": "bytes */" + info.size,
        },
      });
    if (!match[1]) {
      const suffix = Number(match[2]);
      start = Math.max(0, info.size - suffix);
    } else start = Number(match[1]);
    end = match[2] && match[1] ? Math.min(Number(match[2]), end) : end;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    )
      return new Response(null, {
        status: 416,
        headers: {
          ...headers,
          "Content-Length": "0",
          "Content-Range": "bytes */" + info.size,
        },
      });
    headers["Content-Range"] = "bytes " + start + "-" + end + "/" + info.size;
    headers["Content-Length"] = String(end - start + 1);
    status = 206;
  }
  if (request.method === "HEAD" || info.size === 0)
    return new Response(null, { status, headers });
  const stream = createReadStream(blobPath(service.root, info.hash), {
    start,
    end,
  });
  return new Response(Readable.toWeb(stream) as any, { status, headers });
}
