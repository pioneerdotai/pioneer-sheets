import { equal, type Snapshot } from "../../shared/documents/model";

const viewFields = ["zoomRatio", "scrollTop", "scrollLeft"] as const;

/** Viewport navigation belongs to this view, not to shared document history. */
export function preserveView(before: Snapshot, after: Snapshot) {
  for (const [id, sheet] of Object.entries(after.sheets ?? {}) as any) {
    const previous = before.sheets?.[id];
    if (!previous) continue;
    for (const key of viewFields) {
      if (previous[key] === undefined) delete sheet[key];
      else sheet[key] = previous[key];
    }
  }
}

/** Native mutations patch cells. Explicit nulls also remove old formulas/styles. */
export function cellChanges(before: any, after: any) {
  const changes: Record<string, Record<string, any>> = {};
  for (const row of new Set([...Object.keys(before), ...Object.keys(after)]))
    for (const col of new Set([
      ...Object.keys(before[row] ?? {}),
      ...Object.keys(after[row] ?? {}),
    ])) {
      const previous = before[row]?.[col],
        next = after[row]?.[col];
      if (equal(previous, next)) continue;
      let value = next == null ? null : { ...next };
      if (value)
        for (const key of Object.keys(previous ?? {}))
          if (!Object.hasOwn(next, key)) value[key] = null;
      (changes[row] ??= {})[col] = value;
    }
  return changes;
}
