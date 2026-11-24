import type { Snapshot } from "../../shared/documents/model";
import { DataStreamTreeTokenType as T } from "@univerjs/core";

export interface ParagraphBlock {
  kind: "paragraph";
  start: number;
  end: number;
  paragraph: any;
}

export interface TableBlock {
  kind: "table";
  start: number;
  end: number;
  tableId: string;
  rows: Array<Array<{ start: number; end: number; blocks: DocBlock[] }>>;
}

export type DocBlock = ParagraphBlock | TableBlock;

export function docBlocks(
  body: any,
  start = 0,
  end = body.dataStream.length,
): DocBlock[] {
  const stream = body.dataStream,
    blocks: DocBlock[] = [];
  let i = start,
    paragraphStart = i;
  const push = (at: number) => {
    const paragraph = (body.paragraphs ?? []).find(
      (p: any) => p.startIndex === at,
    ) ?? { startIndex: at };
    blocks.push({
      kind: "paragraph",
      start: paragraphStart,
      end: at,
      paragraph,
    });
  };
  while (i < end) {
    if (stream[i] === T.TABLE_START) {
      if (
        i > paragraphStart &&
        stream.slice(paragraphStart, i).replace(/[\n\r]/g, "")
      )
        push(i);
      const table = body.tables?.find((t: any) => t.startIndex === i);
      const tableStart = i;
      const rows: TableBlock["rows"] = [];
      i++;
      while (i < end && stream[i] !== T.TABLE_END) {
        if (stream[i] === T.TABLE_ROW_START) {
          const cells = [];
          i++;
          while (i < end && stream[i] !== T.TABLE_ROW_END) {
            if (stream[i] === T.TABLE_CELL_START) {
              const cellStart = ++i;
              let nesting = 0;
              while (i < end) {
                if (stream[i] === T.TABLE_START) nesting++;
                else if (stream[i] === T.TABLE_END) nesting--;
                else if (stream[i] === T.TABLE_CELL_END && nesting === 0) break;
                i++;
              }
              cells.push({
                start: cellStart,
                end: i,
                blocks: docBlocks(body, cellStart, i),
              });
              i++;
            } else i++;
          }
          rows.push(cells);
        } else i++;
      }
      blocks.push({
        kind: "table",
        start: tableStart,
        end: i,
        tableId: table?.tableId ?? "",
        rows,
      });
      i++;
      paragraphStart = i;
      continue;
    }
    if (stream[i] === "\r") {
      push(i);
      paragraphStart = i + 1;
    } else if (stream[i] === "\n" && paragraphStart === i)
      paragraphStart = i + 1;
    i++;
  }
  if (
    paragraphStart < end &&
    stream.slice(paragraphStart, end).replace(/[\r\n]/g, "")
  )
    push(end);
  return blocks;
}

export function paragraphSegments(body: any, block: ParagraphBlock) {
  const points = [
    ...new Set([
      block.start,
      block.end,
      ...(body.textRuns ?? [])
        .flatMap((r: any) => [
          Math.max(block.start, r.st),
          Math.min(block.end, r.ed),
        ])
        .filter((n: number) => n >= block.start && n <= block.end),
      ...(body.customRanges ?? [])
        .flatMap((r: any) => [
          Math.max(block.start, r.startIndex),
          Math.min(block.end, r.endIndex + 1),
        ])
        .filter((n: number) => n >= block.start && n <= block.end),
      ...(body.customBlocks ?? [])
        .filter(
          (b: any) => b.startIndex >= block.start && b.startIndex < block.end,
        )
        .flatMap((b: any) => [b.startIndex, b.startIndex + 1]),
    ]),
  ].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => {
    const end = points[i + 1],
      style = Object.assign(
        {},
        ...(body.textRuns ?? [])
          .filter((r: any) => r.st <= start && r.ed >= end)
          .map((r: any) => r.ts),
      );
    const link = body.customRanges?.find(
      (r: any) =>
        r.startIndex <= start && r.endIndex >= end - 1 && r.properties?.url,
    );
    const drawing = body.customBlocks?.find((b: any) => b.startIndex === start);
    return {
      start,
      end,
      text: body.dataStream.slice(start, end),
      style,
      url: link?.properties?.url,
      drawingId: drawing?.blockId,
    };
  });
}

export function plainDoc(snapshot: Snapshot) {
  return (snapshot.body?.dataStream ?? "")
    .replace(/[\x00-\x08\x0b-\x1f]/g, (c: string) =>
      c === "\r" || c === "\n" ? "\n" : c === "\t" ? "\t" : "",
    )
    .trimEnd();
}
