import { columnIndex } from "../../../shared/coordinates";
import type { Snapshot } from "../../../shared/documents/model";
import { ServiceError } from "../error";

export function parseRange(input: string) {
  const match = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(input);
  if (!match) throw new ServiceError(400, "Range must use A1:B5 notation");
  const [r, c, re, ce] = [
    +match[2] - 1,
    columnIndex(match[1]),
    +(match[4] ?? match[2]) - 1,
    columnIndex(match[3] ?? match[1]),
  ];
  if (r < 0 || re < r || ce < c || (re - r + 1) * (ce - c + 1) > 100000)
    throw new ServiceError(400, "Invalid or oversized range");
  return { r, c, re, ce };
}

export function sheetFor(s: Snapshot, id?: string) {
  const key =
    id && s.sheets[id]
      ? id
      : id
        ? s.sheetOrder.find((k: string) => s.sheets[k].name === id)
        : s.sheetOrder[0];
  if (!key) throw new ServiceError(404, "Sheet not found");
  return s.sheets[key];
}
