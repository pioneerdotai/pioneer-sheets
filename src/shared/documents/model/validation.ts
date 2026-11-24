import { Snapshot, Kind, object } from "./types";

export function validateSnapshot(
  value: any,
  kind: Kind,
): asserts value is Snapshot {
  if (!object(value)) throw new Error("Invalid document");
  if (kind === "doc") {
    if (
      typeof value.body?.dataStream !== "string" ||
      !value.body.dataStream.endsWith("\r\n") ||
      !object(value.documentStyle)
    )
      throw new Error("Expected a Univer Docs document");
    if (value.body.dataStream.length > 2_000_000)
      throw new Error("Document is too large");
  } else {
    if (
      !Array.isArray(value.sheetOrder) ||
      !value.sheetOrder.length ||
      new Set(value.sheetOrder).size !== value.sheetOrder.length ||
      value.sheetOrder.length > 100 ||
      !object(value.sheets)
    )
      throw new Error("Expected a Univer Sheets workbook");
    for (const id of value.sheetOrder) {
      const s = value.sheets[id];
      if (
        typeof id !== "string" ||
        !object(s) ||
        typeof s.name !== "string" ||
        !(
          Number.isInteger(s.rowCount) &&
          s.rowCount > 0 &&
          s.rowCount <= 100000
        ) ||
        !(
          Number.isInteger(s.columnCount) &&
          s.columnCount > 0 &&
          s.columnCount <= 10000
        )
      )
        throw new Error("Invalid sheet");
    }
  }
  if (JSON.stringify(value).length > 20_000_000)
    throw new Error("Snapshot exceeds 20 MB");
}
