import { calculateSnapshot } from "./calculation";
import type { IdentityReference } from "../../shared/types";
import { ServiceError } from "./error";
import type { OfficeService } from "./service";
import { parseRange } from "./ai/ranges";
import { sheetFor } from "./ai/ranges";

export async function inspect(
  service: OfficeService,
  id: string,
  who: IdentityReference,
  options: {
    sheet?: string;
    range?: string;
    start?: number;
    end?: number;
    query?: string;
  } = {},
) {
  const unit = await service.get(id, who);
  const s =
    service.kind === "sheet" && options.range
      ? await calculateSnapshot(unit.snapshot)
      : unit.snapshot;
  if (service.kind === "sheet") {
    if (options.query) {
      const matches: any[] = [];
      const query = options.query.toLowerCase();
      search: for (const key of s.sheetOrder) {
        const sh = s.sheets[key];
        for (const [r, row] of Object.entries(sh.cellData ?? {}))
          for (const [c, cell] of Object.entries(row as any)) {
            const value = (cell as any)?.f ?? (cell as any)?.v ?? "";
            if (String(value).toLowerCase().includes(query)) {
              matches.push({ sheetId: key, row: +r, column: +c, cell });
              if (matches.length === 500) break search;
            }
          }
      }
      return { id, revision: unit.revision, matches };
    }
    if (options.range) {
      const sheet = sheetFor(s, options.sheet);
      const a = parseRange(options.range);
      return {
        id,
        revision: unit.revision,
        sheet: sheet.id,
        range: options.range,
        values: Array.from({ length: a.re - a.r + 1 }, (_, r) =>
          Array.from(
            { length: a.ce - a.c + 1 },
            (_, c) => sheet.cellData?.[a.r + r]?.[a.c + c] ?? null,
          ),
        ),
      };
    }
    return {
      id,
      title: unit.title,
      revision: unit.revision,
      sheets: s.sheetOrder.map((key: string) => {
        const sheet = s.sheets[key];
        return {
          id: key,
          name: sheet.name,
          rows: sheet.rowCount,
          columns: sheet.columnCount,
          nonemptyRows: Object.keys(sheet.cellData ?? {}).length,
        };
      }),
    };
  }
  const text = s.body.dataStream.slice(0, -2);
  if (options.start !== undefined) {
    const start = Number(options.start),
      end = options.end === undefined ? start + 5000 : Number(options.end);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start
    )
      throw new ServiceError(400, "Invalid text range");
    const boundedEnd = Math.min(end, start + 10000);
    return {
      id,
      revision: unit.revision,
      start,
      end: Math.min(text.length, boundedEnd),
      text: text.slice(start, boundedEnd),
      textRuns: (s.body.textRuns ?? [])
        .filter((r: any) => r.ed > start && r.st < boundedEnd)
        .slice(0, 1000),
      paragraphs: (s.body.paragraphs ?? [])
        .filter((p: any) => p.startIndex >= start && p.startIndex <= boundedEnd)
        .slice(0, 1000),
    };
  }
  return {
    id,
    title: unit.title,
    revision: unit.revision,
    length: text.length,
    preview: text.slice(0, 10000),
    paragraphCount: s.body.paragraphs.length,
    paragraphs: s.body.paragraphs
      .slice(0, 1000)
      .map((p: any, i: number, all: any[]) => ({
        id: p.paragraphId,
        start: i ? all[i - 1].startIndex + 1 : 0,
        end: p.startIndex,
        style: p.paragraphStyle,
      })),
    ...(options.query
      ? {
          matches: (() => {
            const matches = [];
            const pattern = new RegExp(
              options.query!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "g",
            );
            for (const match of text.matchAll(pattern)) {
              matches.push({
                start: match.index,
                end: match.index + match[0].length,
              });
              if (matches.length === 500) break;
            }
            return matches;
          })(),
        }
      : {}),
  };
}
