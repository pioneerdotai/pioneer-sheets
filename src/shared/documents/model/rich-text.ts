import * as Y from "yjs";
import diff from "fast-diff";
import { equal } from "./types";
import { readMap, syncMap } from "./values";
import { base64, unbase64 } from "./document";

export function attrs(body: any): Record<string, any>[] {
  const text = body.dataStream as string;
  // Reuse attributes across contiguous runs instead of allocating one object
  // per UTF-16 unit. Large documents usually contain far fewer styles than characters.
  const result: Record<string, any>[] = new Array(text.length).fill({});
  for (const run of body.textRuns ?? []) {
    const style = Object.fromEntries(
      Object.entries(run.ts ?? {}).map(([k, v]) => ["t:" + k, v]),
    );
    let prior: any, merged: any;
    for (let i = Math.max(0, run.st); i < Math.min(text.length, run.ed); i++) {
      const base = result[i];
      if (base !== prior) {
        prior = base;
        merged = { ...base, ...style };
      }
      result[i] = merged;
    }
  }
  for (const para of body.paragraphs ?? [])
    if (result[para.startIndex]) {
      result[para.startIndex] = { ...result[para.startIndex] };
      for (const [k, v] of Object.entries(para))
        if (k !== "startIndex") result[para.startIndex]["p:" + k] = v;
    }
  return result;
}

export const indexedMetadata = [
  "customBlocks",
  "customRanges",
  "customDecorations",
  "sectionBreaks",
  "tables",
];

export function anchorBodyMetadata(value: any) {
  if (value instanceof Y.Array) {
    for (const item of value.toArray()) anchorBodyMetadata(item);
    return;
  }
  if (!(value instanceof Y.Map)) return;
  const text = value.get("$text");
  if (text instanceof Y.Text)
    for (const key of indexedMetadata) {
      const items = value.get(key);
      if (!(items instanceof Y.Array)) continue;
      for (const item of items.toArray())
        if (item instanceof Y.Map) {
          const prior = item.get("$positions") ?? {};
          const positions = { ...prior };
          let changed = false;
          for (const field of ["startIndex", "endIndex"]) {
            const index = item.get(field);
            if (!Number.isInteger(index) || prior[field]?.index === index)
              continue;
            positions[field] = {
              index,
              relative: base64(
                Y.encodeRelativePosition(
                  Y.createRelativePositionFromTypeIndex(
                    text,
                    Math.max(0, Math.min(index, text.length)),
                  ),
                ),
              ),
            };
            changed = true;
          }
          if (changed) item.set("$positions", positions);
        }
    }
  for (const item of value.values()) anchorBodyMetadata(item);
}

export function readRich(map: Y.Map<any>): any {
  const text = map.get("$text") as Y.Text;
  const body = readMap(map);
  delete body.$text;
  for (const key of indexedMetadata)
    for (const item of body[key] ?? []) {
      const positions = item.$positions;
      delete item.$positions;
      for (const [field, anchor] of Object.entries(positions ?? {}) as any) {
        try {
          const absolute = Y.createAbsolutePositionFromRelativePosition(
            Y.decodeRelativePosition(unbase64(anchor.relative)),
            text.doc!,
          );
          if (absolute) item[field] = absolute.index;
        } catch {}
      }
    }
  body.dataStream = text.toString();
  body.textRuns = [];
  body.paragraphs = [];
  let offset = 0;
  for (const part of text.toDelta()) {
    const ts: any = {};
    const para: any = {};
    for (const [k, v] of Object.entries(part.attributes ?? {})) {
      if (k.startsWith("t:")) ts[k.slice(2)] = v;
      if (k.startsWith("p:")) para[k.slice(2)] = v;
    }
    const str = String(part.insert);
    if (Object.keys(ts).length)
      body.textRuns.push({ st: offset, ed: offset + str.length, ts });
    for (let i = 0; i < str.length; i++)
      if (str[i] === "\r")
        body.paragraphs.push({
          ...para,
          startIndex: offset + i,
          paragraphId: para.paragraphId ?? `p-${offset + i}`,
        });
    offset += str.length;
  }
  return body;
}

export function syncRich(map: Y.Map<any>, before: any, after: any) {
  const text = map.get("$text") as Y.Text;
  const old = before.dataStream ?? "";
  const next = after.dataStream ?? "";
  const nextAttrs = attrs(after);
  const edits = diff(old, next);
  let cursor = 0;
  let target = 0;
  for (const [op, str] of edits) {
    if (op === -1) text.delete(cursor, str.length);
    else if (op === 1) {
      for (let i = 0; i < str.length;) {
        let e = i + 1;
        while (
          e < str.length &&
          equal(nextAttrs[target + i], nextAttrs[target + e])
        )
          e++;
        text.insert(cursor + i, str.slice(i, e), nextAttrs[target + i]);
        i = e;
      }
      cursor += str.length;
      target += str.length;
    } else {
      cursor += str.length;
      target += str.length;
    }
  }
  // Apply only locally changed format properties; concurrent independent
  // formatting survives rather than replacing whole text-run arrays.
  const previousAttrs = attrs(before);
  let oldIndex = 0;
  let newIndex = 0;
  for (const [op, str] of edits) {
    if (op === -1) oldIndex += str.length;
    else if (op === 1) newIndex += str.length;
    else {
      const changesAt = (offset: number) => {
        const a = previousAttrs[oldIndex + offset] ?? {},
          b = nextAttrs[newIndex + offset] ?? {};
        const changes: any = {};
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
          if (!equal(a[key], b[key])) changes[key] = b[key] ?? null;
        return changes;
      };
      for (let n = 0; n < str.length;) {
        const changes = changesAt(n);
        let end = n + 1;
        while (end < str.length && equal(changes, changesAt(end))) end++;
        if (Object.keys(changes).length)
          text.format(newIndex + n, end - n, changes);
        n = end;
      }
      oldIndex += str.length;
      newIndex += str.length;
    }
  }
  const a = { ...before };
  const b = { ...after };
  for (const k of ["dataStream", "textRuns", "paragraphs"]) {
    delete a[k];
    delete b[k];
  }
  syncMap(map, a, b);
}
