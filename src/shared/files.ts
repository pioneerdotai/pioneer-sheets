import type { Snapshot } from "./documents/model";

export interface FileReference {
  fileId: string;
  version: number;
}

export function fileSource(fileId: string, version: number) {
  return "pioneer-file:" + fileId + ":" + version;
}

export function parseFileSource(value: unknown): FileReference | undefined {
  if (typeof value !== "string") return;
  const match = /^pioneer-file:([0-9a-f-]{36}):([1-9]\d*)$/.exec(value);
  if (match) return { fileId: match[1], version: Number(match[2]) };
}

export function collectFileReferences(snapshot: Snapshot) {
  const refs = new Map<string, FileReference>();
  const add = (ref: FileReference) =>
    refs.set(ref.fileId + ":" + ref.version, ref);
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const ref = parseFileSource(item);
      if (ref) add(ref);
      if (
        key === "fileId" &&
        typeof item === "string" &&
        Number.isInteger(value.version) &&
        value.version > 0 &&
        /^[0-9a-f-]{36}$/.test(item)
      )
        add({ fileId: item, version: value.version });
      else if (item && typeof item === "object") visit(item);
    }
  };
  visit(snapshot);
  for (const r of snapshot.resources ?? [])
    try {
      visit(JSON.parse(r.data));
    } catch {}
  return [...refs.values()];
}

export const ATTACHMENTS_RESOURCE = "PIONEER_ATTACHMENTS";

export function attachments(
  snapshot: Snapshot,
): Array<FileReference & { name?: string }> {
  const r = (snapshot.resources ?? []).find(
    (r: any) => r.name === ATTACHMENTS_RESOURCE,
  );
  try {
    return r ? JSON.parse(r.data) : [];
  } catch {
    return [];
  }
}
