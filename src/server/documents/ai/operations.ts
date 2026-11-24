import { newId } from "../../../shared/id";
import type { Snapshot } from "../../../shared/documents/model";
import { ServiceError } from "../error";
import { parseRange } from "./ranges";
import { sheetFor } from "./ranges";
import { shiftDoc } from "./text";

export type Operation = { op: string; [key: string]: any };

export function applyOperation(
  s: Snapshot,
  operation: Operation,
  kind: "sheet" | "doc",
) {
  const o = operation;
  if (o.op === "rename") {
    s[kind === "sheet" ? "name" : "title"] = String(o.title).slice(0, 200);
    return;
  }
  if (o.op === "patch") {
    if (
      !Array.isArray(o.path) ||
      !o.path.length ||
      o.path.some((x: any) =>
        ["__proto__", "prototype", "constructor", "id"].includes(String(x)),
      )
    )
      throw new ServiceError(400, "Invalid path");
    let target = s;
    for (const part of o.path.slice(0, -1)) {
      if (target[part] === undefined) target[part] = {};
      target = target[part];
      if (!target || typeof target !== "object")
        throw new ServiceError(400, "Path does not exist");
    }
    if (o.remove) delete target[o.path.at(-1)];
    else target[o.path.at(-1)] = o.value;
    return;
  }
  if (kind === "sheet") {
    if (o.op === "add_sheet") {
      const id = newId();
      s.sheets[id] = {
        id,
        name: o.name ?? "New sheet",
        rowCount: 500,
        columnCount: 26,
        cellData: {},
        defaultRowHeight: 28,
        defaultColumnWidth: 120,
      };
      s.sheetOrder.push(id);
      return;
    }
    const sheet = sheetFor(s, o.sheet);
    const id = sheet.id;
    if (o.op === "remove_sheet") {
      if (s.sheetOrder.length < 2)
        throw new ServiceError(400, "Cannot delete the last sheet");
      delete s.sheets[id];
      s.sheetOrder = s.sheetOrder.filter((x: string) => x !== id);
      return;
    }
    if (o.op === "rename_sheet") {
      sheet.name = String(o.name).slice(0, 100);
      return;
    }
    if (o.op === "move_sheet") {
      s.sheetOrder = s.sheetOrder.filter((x: string) => x !== id);
      s.sheetOrder.splice(
        Math.max(0, Math.min(s.sheetOrder.length, o.index)),
        0,
        id,
      );
      return;
    }
    if (o.op === "freeze") {
      sheet.freeze = {
        startRow: o.rows ?? 0,
        startColumn: o.columns ?? 0,
        xSplit: o.columns ?? 0,
        ySplit: o.rows ?? 0,
      };
      return;
    }
    if (
      [
        "insert_rows",
        "delete_rows",
        "insert_columns",
        "delete_columns",
      ].includes(o.op)
    ) {
      const row = o.op.endsWith("rows");
      const insert = o.op.startsWith("insert");
      const index = Number(o.index),
        count = Number(o.count ?? 1);
      const max = row ? sheet.rowCount : sheet.columnCount;
      if (
        !Number.isInteger(index) ||
        !Number.isInteger(count) ||
        index < 0 ||
        count < 1 ||
        count > 1000 ||
        index > max ||
        (!insert && (index + count > max || count === max))
      )
        throw new ServiceError(400, "Invalid structural operation");
      const data: any = {};
      for (const [r, cols] of Object.entries(sheet.cellData ?? {}))
        for (const [c, cell] of Object.entries(cols as any)) {
          let a = +r,
            b = +c;
          const p = row ? a : b;
          if (!insert && p >= index && p < index + count) continue;
          const shifted = p >= index ? p + (insert ? count : -count) : p;
          if (row) a = shifted;
          else b = shifted;
          (data[a] ??= {})[b] = cell;
        }
      sheet.cellData = data;
      (s.$axisEdits ??= []).push({
        sheetId: id,
        axis: row ? "row" : "column",
        index,
        count,
        remove: !insert,
      });
      sheet[row ? "rowCount" : "columnCount"] += insert ? count : -count;
      return;
    }
    if (o.op === "resize") {
      const data = (sheet[o.axis === "row" ? "rowData" : "columnData"] ??= {});
      data[o.index] = {
        ...data[o.index],
        [o.axis === "row" ? "h" : "w"]: Math.max(10, Math.min(2000, o.size)),
      };
      return;
    }
    if (o.op === "sort") {
      const range = parseRange(o.range);
      const rows = [];
      for (let r = range.r; r <= range.re; r++)
        rows.push(
          Array.from(
            { length: range.ce - range.c + 1 },
            (_, i) => sheet.cellData?.[r]?.[range.c + i] ?? null,
          ),
        );
      const col = Math.max(0, Math.min(range.ce - range.c, o.column ?? 0));
      rows.sort((a, b) => {
        const av = a[col]?.v ?? "",
          bv = b[col]?.v ?? "";
        return (
          (typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv))) * (o.descending ? -1 : 1)
        );
      });
      o.values = rows;
      o.op = "set_cells";
    }
    const range = parseRange(o.range ?? "A1");
    if (range.re >= sheet.rowCount || range.ce >= sheet.columnCount)
      throw new ServiceError(400, "Range is outside the sheet");
    if (o.op === "merge") {
      sheet.mergeData ??= [];
      sheet.mergeData.push({
        startRow: range.r,
        endRow: range.re,
        startColumn: range.c,
        endColumn: range.ce,
      });
      return;
    }
    if (o.op === "unmerge") {
      sheet.mergeData = (sheet.mergeData ?? []).filter(
        (m: any) =>
          m.endRow < range.r ||
          m.startRow > range.re ||
          m.endColumn < range.c ||
          m.startColumn > range.ce,
      );
      return;
    }
    if (!["set_cells", "format_cells", "clear_cells"].includes(o.op))
      throw new ServiceError(400, `Unknown operation ${o.op}`);
    sheet.cellData ??= {};
    if (o.op === "set_cells" && !Array.isArray(o.values))
      throw new ServiceError(400, "values must be a two-dimensional array");
    for (let r = range.r; r <= range.re; r++)
      for (let c = range.c; c <= range.ce; c++) {
        const row = (sheet.cellData[r] ??= {});
        if (o.op === "clear_cells") {
          delete row[c];
          continue;
        }
        if (o.op === "format_cells") {
          const cell = (row[c] ??= {});
          const old =
            typeof cell.s === "string"
              ? (s.styles?.[cell.s] ?? {})
              : (cell.s ?? {});
          cell.s = { ...old, ...o.style };
          continue;
        }
        const v = o.values[r - range.r]?.[c - range.c];
        if (v === undefined) continue;
        if (v === null) {
          delete row[c];
          continue;
        }
        const style = row[c]?.s;
        row[c] =
          typeof v === "object"
            ? v
            : typeof v === "string" && v.startsWith("=")
              ? { f: v }
              : { v };
        if (style && !row[c].s) row[c].s = style;
      }
  } else {
    const body = o.segment
      ? (s.headers?.[o.segment]?.body ?? s.footers?.[o.segment]?.body)
      : s.body;
    if (!body) throw new ServiceError(404, "Segment not found");
    if (o.op === "insert_text") {
      shiftDoc(
        body,
        o.index,
        o.index,
        String(o.text ?? "").replace(/\r?\n/g, "\r"),
        o.style,
      );
      return;
    }
    if (o.op === "replace_text") {
      shiftDoc(
        body,
        o.start,
        o.end,
        String(o.text ?? "").replace(/\r?\n/g, "\r"),
        o.style,
      );
      return;
    }
    if (o.op === "delete_text") {
      shiftDoc(body, o.start, o.end, "");
      return;
    }
    if (o.op === "find_replace") {
      if (!o.find) throw new ServiceError(400, "Search text is empty");
      let index = o.all
        ? body.dataStream.lastIndexOf(o.find)
        : body.dataStream.indexOf(o.find);
      let count = 0;
      while (index >= 0) {
        shiftDoc(body, index, index + o.find.length, String(o.replace ?? ""));
        count++;
        if (!o.all || index === 0) break;
        if (count >= 10000) throw new ServiceError(400, "Too many matches");
        index = body.dataStream.lastIndexOf(o.find, index - 1);
      }
      return;
    }
    if (o.op === "format_text") {
      const start = Number(o.start),
        end = Number(o.end);
      if (start < 0 || end > body.dataStream.length - 2 || end <= start)
        throw new ServiceError(400, "Invalid text range");
      const bounds = new Set<number>([start, end]);
      for (const r of body.textRuns ?? []) {
        bounds.add(r.st);
        bounds.add(r.ed);
      }
      const points = [...bounds].sort((a, b) => a - b);
      const runs = [];
      for (let i = 0; i < points.length - 1; i++) {
        const st = points[i],
          ed = points[i + 1];
        const ts = Object.assign(
          {},
          ...(body.textRuns ?? [])
            .filter((r: any) => r.st <= st && r.ed >= ed)
            .map((r: any) => r.ts),
          ...(st >= start && ed <= end ? [o.style] : []),
        );
        if (Object.keys(ts).length) runs.push({ st, ed, ts });
      }
      body.textRuns = runs;
      return;
    }
    if (o.op === "format_paragraph") {
      for (const p of body.paragraphs ?? [])
        if (p.startIndex >= o.start && p.startIndex <= o.end)
          p.paragraphStyle = { ...p.paragraphStyle, ...o.style };
      return;
    }
    if (o.op === "page_setup") {
      s.documentStyle = { ...s.documentStyle, ...o.style };
      return;
    }
    throw new ServiceError(400, `Unknown operation ${o.op}`);
  }
}
