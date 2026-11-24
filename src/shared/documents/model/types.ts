// The SDK stores Univer's public JSON model in CRDT containers. Document text is
// a rich Y.Text; formatting and paragraph marks travel with their characters.
export type Snapshot = Record<string, any>;

export type Kind = "sheet" | "doc";

export const LOCAL = "editor";

/** JSON model equality without serializing either document or depending on key order. */
export function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  let count = 0;
  for (const key of Object.keys(a)) {
    if (a[key] === undefined) continue;
    if (!Object.hasOwn(b, key) || !equal(a[key], b[key])) return false;
    count++;
  }
  for (const key of Object.keys(b)) if (b[key] !== undefined) count--;
  return count === 0;
}

export const object = (v: any) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
