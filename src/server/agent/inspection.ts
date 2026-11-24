import { resolveSheetId } from "../../shared/documents/sheet-selector";
import { cellAddress, columnIndex } from "../../shared/coordinates";
import type { Snapshot, Kind } from "../../shared/documents/model";

export interface InspectionQuery {
  kind:
    | "overview"
    | "workbook"
    | "worksheet"
    | "range"
    | "document"
    | "paragraph"
    | "search"
    | "features";
  sheet?: string;
  range?: string;
  paragraphId?: string;
  index?: number;
  segment?: string;
  feature?: string;
  query?: string;
  offset?: number;
  limit?: number;
}

function resourceData(s: Snapshot) {
  return Object.fromEntries(
    (s.resources ?? []).map((r: any) => {
      try {
        return [r.name, JSON.parse(r.data)];
      } catch {
        return [r.name, r.data];
      }
    }),
  );
}

function used(sheet: any) {
  const rows = Object.keys(sheet.cellData ?? {})
    .map(Number)
    .filter((r) =>
      Object.values(sheet.cellData[r]).some(
        (c: any) => c && Object.keys(c).length,
      ),
    );
  if (!rows.length) return null;
  const cols = rows.flatMap((r) => Object.keys(sheet.cellData[r]).map(Number));
  const r = rows.reduce((a, b) => Math.min(a, b), Infinity),
    re = rows.reduce((a, b) => Math.max(a, b), -1),
    c = cols.reduce((a, b) => Math.min(a, b), Infinity),
    ce = cols.reduce((a, b) => Math.max(a, b), -1);
  return {
    range: cellAddress(r, c) + ":" + cellAddress(re, ce),
    startRow: r,
    endRow: re,
    startColumn: c,
    endColumn: ce,
  };
}

function selectSheet(s: Snapshot, selector?: string) {
  return s.sheets[resolveSheetId(s, selector)];
}

function page<T>(items: T[], offset: number, limit: number) {
  return {
    total: items.length,
    offset,
    items: items.slice(offset, offset + limit),
    hasMore: offset + limit < items.length,
  };
}

function summaries(s: Snapshot) {
  const data = resourceData(s);
  return {
    tables: Object.keys(s.tableSource ?? {}).length,
    drawings: Object.keys(s.drawings ?? {}).length,
    resources: Object.entries(data).map(([name, value]: any) => ({
      name,
      entries: Array.isArray(value)
        ? value.length
        : value && typeof value === "object"
          ? Object.keys(value).length
          : 0,
    })),
  };
}

export function inspectSnapshot(s: Snapshot, kind: Kind, q: InspectionQuery) {
  const limit = Math.min(1000, Math.max(1, q.limit ?? 100)),
    offset = Math.max(0, q.offset ?? 0);
  if (!Number.isInteger(limit) || !Number.isInteger(offset))
    throw new Error("INVALID_PAGINATION");
  if (q.kind === "features") {
    const features: any = {
      ...resourceData(s),
      drawings: s.drawings ?? {},
      tables: s.tableSource ?? {},
      headers: s.headers ?? {},
      footers: s.footers ?? {},
      notes: s.notes ?? {},
    };
    if (!q.feature)
      return { features: Object.keys(features), summary: summaries(s) };
    if (!(q.feature in features)) throw new Error("FEATURE_NOT_FOUND");
    const data = features[q.feature];
    const items = Array.isArray(data)
      ? data
      : Object.entries(data ?? {}).map(([key, value]) => ({ key, value }));
    const result = page(items, offset, Math.min(limit, 50));
    if (JSON.stringify(result).length > 500000)
      throw new Error(
        "INSPECTION_TOO_LARGE: select a narrower feature or lower limit",
      );
    return result;
  }
  if (kind === "sheet") {
    if (["overview", "workbook"].includes(q.kind))
      return {
        id: s.id,
        name: s.name,
        worksheets: s.sheetOrder.map((id: string, index: number) => {
          const sheet = s.sheets[id];
          return {
            id,
            index,
            name: sheet.name,
            rows: sheet.rowCount,
            columns: sheet.columnCount,
            usedRange: used(sheet),
            mergedRanges: sheet.mergeData ?? [],
          };
        }),
        features: summaries(s),
      };
    if (q.kind === "search") {
      if (!q.query) throw new Error("SEARCH_QUERY_REQUIRED");
      const matches: any[] = [];
      const sheets = q.sheet
        ? [selectSheet(s, q.sheet)]
        : s.sheetOrder.map((id: string) => s.sheets[id]);
      search: for (const sheet of sheets)
        for (const [r, row] of Object.entries(sheet.cellData ?? {}))
          for (const [c, cell] of Object.entries(row as any)) {
            const value =
              (cell as any)?.v ?? (cell as any)?.p?.body?.dataStream ?? "";
            const formula = (cell as any)?.f ?? "";
            if (
              (String(value) + " " + formula)
                .toLowerCase()
                .includes(q.query.toLowerCase())
            )
              matches.push({
                sheetId: sheet.id,
                address: cellAddress(+r, +c),
                cell,
              });
            if (matches.length >= 5000) break search;
          }
      return {
        ...page(matches, offset, limit),
        truncated: matches.length >= 5000,
      };
    }
    const sheet = selectSheet(s, q.sheet);
    if (q.kind === "worksheet")
      return {
        ...sheet,
        cellData: undefined,
        usedRange: used(sheet),
        nonemptyRows: Object.keys(sheet.cellData ?? {}).length,
      };
    if (q.kind !== "range" || !q.range)
      throw new Error("INVALID_SHEET_SELECTOR");
    const m = /^\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/i.exec(
      q.range,
    );
    if (!m) throw new Error("INVALID_A1_RANGE");
    const r = +m[2] - 1,
      c = columnIndex(m[1]),
      re = +(m[4] ?? m[2]) - 1,
      ce = columnIndex(m[3] ?? m[1]);
    if (
      re < r ||
      ce < c ||
      re >= sheet.rowCount ||
      ce >= sheet.columnCount ||
      (re - r + 1) * (ce - c + 1) > 10000
    )
      throw new Error("RANGE_OUT_OF_BOUNDS_OR_TOO_LARGE");
    return {
      sheetId: sheet.id,
      range: q.range,
      startRow: r,
      startColumn: c,
      rows: re - r + 1,
      columns: ce - c + 1,
      cells: Array.from({ length: re - r + 1 }, (_, ri) =>
        Array.from({ length: ce - c + 1 }, (_, ci) => {
          const cell = sheet.cellData?.[r + ri]?.[c + ci];
          const style =
            typeof cell?.s === "string" ? s.styles?.[cell.s] : cell?.s;
          return {
            address: cellAddress(r + ri, c + ci),
            ...(cell ?? { v: null }),
            ...(style ? { resolvedStyle: style } : {}),
          };
        }),
      ),
    };
  }
  const body = q.segment
    ? (s.headers?.[q.segment]?.body ?? s.footers?.[q.segment]?.body)
    : s.body;
  if (!body) throw new Error("SEGMENT_NOT_FOUND");
  const paragraphs = (body.paragraphs ?? []).map(
    (p: any, index: number, all: any[]) => {
      const start = index ? all[index - 1].startIndex + 1 : 0;
      return {
        id: p.paragraphId,
        index,
        start,
        end: p.startIndex,
        text: body.dataStream.slice(start, p.startIndex),
        style: p.paragraphStyle ?? {},
        bullet: p.bullet ?? null,
      };
    },
  );
  if (["overview", "document"].includes(q.kind))
    return {
      id: s.id,
      title: s.title,
      documentFlavor: s.documentStyle?.documentFlavor ?? null,
      length: body.dataStream.length - 2,
      preview: body.dataStream.slice(0, 5000),
      paragraphs: page(paragraphs, offset, limit),
      pageStyle: s.documentStyle,
      features: summaries(s),
      headers: Object.keys(s.headers ?? {}),
      footers: Object.keys(s.footers ?? {}),
      segment: q.segment ?? "",
    };
  if (q.kind === "paragraph") {
    const p = q.paragraphId
      ? paragraphs.find((p: any) => p.id === q.paragraphId)
      : paragraphs[q.index ?? 0];
    if (!p) throw new Error("PARAGRAPH_NOT_FOUND");
    return {
      ...p,
      textRuns: (body.textRuns ?? []).filter(
        (r: any) => r.ed > p.start && r.st < p.end,
      ),
      customRanges: (body.customRanges ?? []).filter(
        (r: any) => r.endIndex >= p.start && r.startIndex <= p.end,
      ),
      customBlocks: (body.customBlocks ?? []).filter(
        (b: any) => b.startIndex >= p.start && b.startIndex <= p.end,
      ),
    };
  }
  if (q.kind === "search") {
    if (!q.query) throw new Error("SEARCH_QUERY_REQUIRED");
    const text = body.dataStream.toLowerCase(),
      needle = q.query.toLowerCase(),
      matches = [];
    let cursor = 0;
    while (matches.length < 5000) {
      const index = text.indexOf(needle, cursor);
      if (index < 0) break;
      matches.push({
        start: index,
        end: index + needle.length,
        preview: body.dataStream.slice(
          Math.max(0, index - 30),
          index + needle.length + 60,
        ),
      });
      cursor = index + Math.max(1, needle.length);
    }
    return {
      ...page(matches, offset, limit),
      truncated: matches.length >= 5000,
    };
  }
  throw new Error("INVALID_DOC_SELECTOR");
}
