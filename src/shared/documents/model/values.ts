import { newId } from "../../id";
import * as Y from "yjs";
import { equal, object } from "./types";
import { attrs, readRich, syncRich } from "./rich-text";
import { readSheet, syncSheet } from "./sheets";

export type ReadContext = Map<
  Y.Map<any>,
  { rows: Map<string, number>; cols: Map<string, number> }
>;

export function readValue(value: any, context: ReadContext = new Map()): any {
  if (value instanceof Y.Map && value.has("$resources"))
    return Object.entries(readMap(value, context))
      .filter(([k]) => k !== "$resources")
      .map(([name, value]: any) => ({
        name,
        data: typeof value === "string" ? value : JSON.stringify(value),
      }));
  if (value instanceof Y.Map)
    return value.has("$grid")
      ? readSheet(value, context)
      : value.has("$text")
        ? readRich(value)
        : readMap(value, context);
  if (value instanceof Y.Array)
    return value.toArray().map((item) => readValue(item, context));
  if (value instanceof Y.Text) return value.toString();
  return value;
}

export function readMap(map: Y.Map<any>, context: ReadContext = new Map()) {
  return Object.fromEntries(
    [...map.entries()].map(([k, v]) => [k, readValue(v, context)]),
  );
}

export function resourceMap(resources: any[]) {
  return Object.fromEntries(
    resources.map((r) => {
      let data: any;
      try {
        data = JSON.parse(r.data);
      } catch {
        data = r.data;
      }
      return [r.name, data];
    }),
  );
}

export function createValue(value: any): any {
  if (
    Array.isArray(value) &&
    value.length &&
    value.every(
      (x) =>
        object(x) && typeof x.name === "string" && typeof x.data === "string",
    )
  ) {
    const map = new Y.Map<any>();
    map.set("$resources", true);
    for (const [k, v] of Object.entries(resourceMap(value)))
      map.set(k, createValue(v));
    return map;
  }
  if (Array.isArray(value)) {
    const a = new Y.Array();
    a.insert(0, value.map(createValue));
    return a;
  }
  if (object(value)) {
    const m = new Y.Map();
    if (
      value.cellData &&
      Number.isInteger(value.rowCount) &&
      Number.isInteger(value.columnCount)
    ) {
      const grid = new Y.Map<any>();
      const rows = new Y.Array<string>();
      const cols = new Y.Array<string>();
      const cells = new Y.Map<any>();
      const rids = Array.from({ length: value.rowCount }, () => newId());
      const cids = Array.from({ length: value.columnCount }, () => newId());
      rows.insert(0, rids);
      cols.insert(0, cids);
      grid.set("rows", rows);
      grid.set("cols", cols);
      grid.set("cells", cells);
      m.set("$grid", grid);
      for (const [r, row] of Object.entries(value.cellData))
        for (const [c, cell] of Object.entries(row as any))
          if (rids[+r] && cids[+c])
            cells.set(rids[+r] + ":" + cids[+c], createValue(cell));
      for (const [k, v] of Object.entries(value))
        if (
          !["cellData", "rowCount", "columnCount"].includes(k) &&
          v !== undefined
        )
          m.set(k, createValue(v));
    } else if (typeof value.dataStream === "string") {
      const t = new Y.Text();
      m.set("$text", t);
      const a = attrs(value);
      for (let i = 0; i < value.dataStream.length;) {
        let end = i + 1;
        while (end < a.length && equal(a[i], a[end])) end++;
        t.insert(i, value.dataStream.slice(i, end), a[i]);
        i = end;
      }
      for (const [k, v] of Object.entries(value))
        if (!["dataStream", "textRuns", "paragraphs"].includes(k))
          m.set(k, createValue(v));
    } else
      for (const [k, v] of Object.entries(value))
        if (v !== undefined) m.set(k, createValue(v));
    return m;
  }
  return value;
}

export function syncMap(map: Y.Map<any>, before: any, after: any) {
  for (const key of new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])) {
    if (key === "$text" || equal(before?.[key], after?.[key])) continue;
    if (after?.[key] === undefined) {
      map.delete(key);
      continue;
    }
    const v = map.get(key);
    const a = before?.[key];
    const b = after[key];
    if (
      v instanceof Y.Map &&
      v.has("$resources") &&
      Array.isArray(a) &&
      Array.isArray(b)
    )
      syncMap(v, resourceMap(a), resourceMap(b));
    else if (v instanceof Y.Map && object(a) && object(b)) {
      if (v.has("$grid")) syncSheet(v, a, b);
      else if (v.has("$text") && typeof b.dataStream === "string")
        syncRich(v, a, b);
      else syncMap(v, a, b);
    } else if (v instanceof Y.Array && Array.isArray(a) && Array.isArray(b)) {
      let start = 0;
      while (start < a.length && start < b.length && equal(a[start], b[start]))
        start++;
      let endA = a.length,
        endB = b.length;
      while (endA > start && endB > start && equal(a[endA - 1], b[endB - 1])) {
        endA--;
        endB--;
      }
      if (endA > start) v.delete(start, endA - start);
      if (endB > start) v.insert(start, b.slice(start, endB).map(createValue));
    } else map.set(key, createValue(b));
  }
}
