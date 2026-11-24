import { createHash } from "node:crypto";
import { fileSource, parseFileSource } from "../../shared/files";
import { type Snapshot } from "../../shared/documents/model";
import { type IdentityReference } from "../../shared/types";
import type { OfficeService } from "../documents/service";
import type { FileService } from "../files/service";
import type { RenderRuntime } from "../agent/rendering";

export interface AssetContext {
  service: OfficeService;
  files: FileService;
  renderer: RenderRuntime;
}

export async function externalize(
  context: AssetContext,
  snapshot: Snapshot,
  who: IdentityReference,
  jobId: string,
) {
  const sources = new Map<string, any>(),
    visit = (value: any) => {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (
          key === "source" &&
          typeof item === "string" &&
          item.startsWith("data:image/")
        )
          sources.set(item, null);
        else if (item && typeof item === "object") visit(item);
      }
    };
  visit(snapshot);
  const resources: any[] = [];
  for (const r of snapshot.resources ?? [])
    try {
      const data = JSON.parse(r.data);
      resources.push({ r, data });
      visit(data);
    } catch {}
  for (const source of sources.keys()) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(source);
    if (!match) throw new Error("INVALID_EMBEDDED_IMAGE");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 20_000_000) throw new Error("IMAGE_SIZE_LIMIT");
    const hash = createHash("sha256").update(bytes).digest("hex"),
      file = await context.files.put(who, {
        name:
          "Image " +
          hash.slice(0, 8) +
          "." +
          match[1].split("/")[1].replace("svg+xml", "svg"),
        mime: match[1],
        data: bytes,
        requestId: "exchange-image:" + jobId + ":" + hash,
      });
    sources.set(source, fileSource(file.id, file.version));
    await context.service.storage.transaction((tx) =>
      context.files.leaseInTransaction(
        tx,
        who,
        [{ fileId: file.id, version: file.version }],
        "exchange",
        jobId,
      ),
    );
  }
  const replace = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "source" && typeof item === "string" && sources.has(item)) {
        value[key] = sources.get(item);
        value.imageSourceType = "UUID";
      } else if (item && typeof item === "object") replace(item);
    }
  };
  replace(snapshot);
  for (const { r, data } of resources) {
    replace(data);
    r.data = JSON.stringify(data);
  }
  return snapshot;
}

export function remap(
  snapshot: Snapshot,
  map: Map<string, string>,
) {
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && map.has(item)) value[key] = map.get(item);
      else if (key === "fileId" && typeof item === "string" && value.version) {
        const to = map.get(fileSource(item, value.version)),
          ref = to ? parseFileSource(to) : null;
        if (ref) {
          value.fileId = ref.fileId;
          value.version = ref.version;
        }
      } else if (item && typeof item === "object") visit(item);
    }
  };
  visit(snapshot);
  for (const r of snapshot.resources ?? [])
    try {
      const data = JSON.parse(r.data);
      visit(data);
      r.data = JSON.stringify(data);
    } catch {}
}
