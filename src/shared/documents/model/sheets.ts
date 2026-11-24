import { columnName } from "../../coordinates";
import { newId } from "../../id";
import * as Y from "yjs";
import { equal, object } from "./types";
import { readValue, createValue, syncMap, type ReadContext } from "./values";

function gridIndexes(grid: Y.Map<any>, context: ReadContext) {
  let indexes = context.get(grid);
  if (!indexes) {
    indexes = {
      rows: new Map(
        (grid.get("rows").toArray() as string[]).map((id, i) => [id, i]),
      ),
      cols: new Map(
        (grid.get("cols").toArray() as string[]).map((id, i) => [id, i]),
      ),
    };
    context.set(grid, indexes);
  }
  return indexes;
}

export function readSheet(
  map: Y.Map<any>,
  context: ReadContext = new Map(),
): any {
  const grid = map.get("$grid") as Y.Map<any>;
  const { rows: ri, cols: ci } = gridIndexes(grid, context);
  const result: any = {};
  for (const [k, v] of map.entries())
    if (k !== "$grid") result[k] = readValue(v, context);
  result.rowCount = ri.size;
  result.columnCount = ci.size;
  result.cellData = {};
  for (const [key, value] of grid.get("cells").entries()) {
    const split = key.indexOf(":");
    const r = ri.get(key.slice(0, split)),
      c = ci.get(key.slice(split + 1));
    if (r !== undefined && c !== undefined)
      (result.cellData[r] ??= {})[c] = readCell(value, map, context);
  }
  return result;
}

export function editAxis(map: Y.Map<any>, edit: any) {
  const grid = map.get("$grid") as Y.Map<any>;
  const axis = grid.get(
    edit.axis === "row" ? "rows" : "cols",
  ) as Y.Array<string>;
  if (edit.remove) {
    if (edit.index >= 0 && edit.index + edit.count <= axis.length)
      axis.delete(edit.index, edit.count);
  } else
    axis.insert(
      Math.min(edit.index, axis.length),
      Array.from({ length: edit.count }, () => newId()),
    );
}

export function syncSheet(map: Y.Map<any>, before: any, after: any) {
  const grid = map.get("$grid") as Y.Map<any>;
  const rows = grid.get("rows") as Y.Array<string>;
  const cols = grid.get("cols") as Y.Array<string>;
  const cells = grid.get("cells") as Y.Map<any>;
  // Dimensions not accompanied by structural commands extend/truncate at the end.
  for (const [axis, n] of [
    [rows, after.rowCount],
    [cols, after.columnCount],
  ] as [Y.Array<string>, number][]) {
    if (axis.length < n)
      axis.insert(
        axis.length,
        Array.from({ length: n - axis.length }, () => newId()),
      );
    else if (axis.length > n) axis.delete(n, axis.length - n);
  }
  const rids = rows.toArray(),
    cids = cols.toArray();
  // Compare against the grid after structural edits, so shifted cells are not
  // rewritten under a different identity and concurrent cell edits follow rows.
  const base =
    before.rowCount !== after.rowCount ||
    before.columnCount !== after.columnCount
      ? readSheet(map).cellData
      : (before.cellData ?? {});
  for (const r of new Set([
    ...Object.keys(base),
    ...Object.keys(after.cellData ?? {}),
  ]))
    for (const c of new Set([
      ...Object.keys(base[r] ?? {}),
      ...Object.keys(after.cellData?.[r] ?? {}),
    ])) {
      if (!rids[+r] || !cids[+c]) continue;
      const a = base[r]?.[c],
        b = after.cellData?.[r]?.[c];
      if (equal(a, b)) continue;
      const key = rids[+r] + ":" + cids[+c];
      const old = cells.get(key);
      if (b === undefined) cells.delete(key);
      else if (old instanceof Y.Map && object(a) && object(b))
        syncMap(old, a, b);
      else cells.set(key, createValue(b));
    }
  const a = { ...before },
    b = { ...after };
  for (const k of ["cellData", "rowCount", "columnCount"]) {
    delete a[k];
    delete b[k];
  }
  syncMap(map, a, b);
}

export function readCell(
  cell: any,
  sheet: Y.Map<any>,
  context: ReadContext = new Map(),
) {
  const result = readValue(cell, context);
  const anchors = result?.$formulaAnchors;
  if (result) delete result.$formulaAnchors;
  if (anchors && anchors.formula === result.f) {
    const sheets = sheet.doc?.getMap("unit").get("sheets") as Y.Map<any>;
    result.f = anchors.parts
      .map((part: any) => {
        if (typeof part === "string") return part;
        const grid = sheets.get(part.sheetId)?.get("$grid");
        if (!grid) return "#REF!";
        const indexes = gridIndexes(grid, context);
        const row = indexes.rows.get(part.rowId),
          col = indexes.cols.get(part.colId);
        return row === undefined || col === undefined
          ? "#REF!"
          : part.prefix +
              part.columnAbsolute +
              columnName(col) +
              part.rowAbsolute +
              (row + 1);
      })
      .join("");
  }
  return result;
}
