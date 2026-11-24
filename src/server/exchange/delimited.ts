import type { Snapshot } from "../../shared/documents/model";
import { randomUUID } from "node:crypto";

export function decodeText(bytes: Uint8Array, encoding?: string) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le", { fatal: true }).decode(
      bytes.subarray(2),
    );
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be", { fatal: true }).decode(
      bytes.subarray(2),
    );
  return new TextDecoder(encoding ?? "utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\ufeff/, "");
}

export function parseDelimited(source: string, delimiter: string) {
  if (delimiter.length !== 1) throw new Error("INVALID_DELIMITER");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"' && !cell && !closed) {
      quoted = true;
      continue;
    }
    if (closed && c !== delimiter && c !== "\r" && c !== "\n")
      throw new Error("INVALID_DELIMITED_QUOTE");
    if (c === delimiter) {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else cell += c;
    if (rows.length > 100000 || row.length > 16384)
      throw new Error("DELIMITED_DIMENSION_LIMIT");
  }
  if (quoted) throw new Error("UNCLOSED_DELIMITED_QUOTE");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function importDelimited(
  source: string,
  delimiter: string,
  title = "Imported spreadsheet",
): Snapshot {
  const rows = parseDelimited(source, delimiter),
    id = randomUUID(),
    sheetId = randomUUID();
  let count = 0;
  const cellData: any = {};
  let columns = 1;
  rows.forEach((row, r) => {
    columns = Math.max(columns, row.length);
    row.forEach((value, c) => {
      if (++count > 500000) throw new Error("CELL_LIMIT");
      if (value !== "") {
        cellData[r] ??= {};
        cellData[r][c] = { v: value, t: 1 };
      }
    });
  });
  return {
    id,
    name: title,
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: "Sheet1",
        rowCount: Math.max(100, rows.length),
        columnCount: Math.max(26, columns),
        cellData,
      },
    },
    styles: {},
  };
}

export function exportDelimited(
  snapshot: Snapshot,
  delimiter: string,
  sheetSelector?: string,
) {
  const id = sheetSelector
    ? snapshot.sheets[sheetSelector]
      ? sheetSelector
      : snapshot.sheetOrder.find(
          (id: string) => snapshot.sheets[id].name === sheetSelector,
        )
    : snapshot.sheetOrder[0];
  if (!id) throw new Error("WORKSHEET_NOT_FOUND");
  const sheet = snapshot.sheets[id],
    cells = sheet.cellData ?? {};
  let lastRow = -1,
    lastColumn = -1;
  for (const [r, row] of Object.entries(cells))
    for (const [c, cell] of Object.entries(row as any)) {
      if (cell && Object.keys(cell).length) {
        lastRow = Math.max(lastRow, +r);
        lastColumn = Math.max(lastColumn, +c);
      }
    }
  if ((lastRow + 1) * (lastColumn + 1) > 500000)
    throw new Error("DELIMITED_CELL_LIMIT");
  const quote = (value: any) => {
    const s = String(value ?? "");
    return s.includes(delimiter) || /["\r\n]/.test(s)
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  return Array.from({ length: lastRow + 1 }, (_, r) =>
    Array.from({ length: lastColumn + 1 }, (_, c) => {
      const cell = cells[r]?.[c];
      return quote(
        cell?.p?.body?.dataStream?.replace(/\r?\n?$/, "").replace(/\r$/, "") ??
          cell?.v ??
          cell?.f ??
          "",
      );
    }).join(delimiter),
  ).join("\r\n");
}
