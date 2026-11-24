import { equal, type Snapshot } from "./model/types";

export function documentStructure(data: Snapshot) {
  return {
    ...data,
    sheets: Object.fromEntries(
      Object.entries(data.sheets ?? {}).map(([id, sheet]: any) => {
        const { cellData, zoomRatio, scrollTop, scrollLeft, ...rest } = sheet;
        return [id, rest];
      }),
    ),
  };
}

// Formula cache values are derived data. Recalculation after undo must not
// become a fresh user edit that clears the redo stack. Copy only formula cells.
export function sameContent(before: Snapshot, after: Snapshot) {
  if (!before.sheets || !after.sheets) return equal(before, after);
  if (!equal(documentStructure(before), documentStructure(after))) return false;
  for (const id of Object.keys(after.sheets ?? {})) {
    const a = before.sheets[id].cellData ?? {},
      b = after.sheets[id].cellData ?? {};
    for (const row of new Set([...Object.keys(a), ...Object.keys(b)]))
      for (const col of new Set([
        ...Object.keys(a[row] ?? {}),
        ...Object.keys(b[row] ?? {}),
      ])) {
        let old = a[row]?.[col],
          next = b[row]?.[col];
        if (old?.f && old.f === next?.f) {
          old = { ...old, v: undefined, t: undefined };
          next = { ...next, v: undefined, t: undefined };
        }
        if (!equal(old, next)) return false;
      }
  }
  return true;
}
