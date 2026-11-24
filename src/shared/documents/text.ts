import type { Kind, Snapshot } from "./model";

/** Readable export preserves sparse grid coordinates; JSON is the lossless format. */
export function readable(snapshot: Snapshot, kind: Kind) {
  if (kind === "doc")
    return snapshot.body.dataStream.replace(/\r/g, "\n").trimEnd();
  const quote = (value: any) => {
    const text = String(value ?? "");
    return /[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return snapshot.sheetOrder
    .map((id: string) => {
      const sheet = snapshot.sheets[id];
      const cells = sheet.cellData ?? {};
      const rows = Object.keys(cells).map(Number);
      const columns = Object.values(cells).flatMap((row: any) =>
        Object.keys(row).map(Number),
      );
      const height = Math.max(-1, ...rows) + 1,
        width = Math.max(-1, ...columns) + 1;
      if (height * width > 100000)
        throw new Error(
          "Text export is limited to 100,000 cells. Use JSON for a large sparse spreadsheet.",
        );
      return (
        sheet.name +
        "\n" +
        Array.from({ length: height }, (_, r) =>
          Array.from({ length: width }, (_, c) => {
            const cell = cells[r]?.[c];
            return quote(
              cell?.v ?? cell?.f ?? cell?.p?.body?.dataStream?.trimEnd(),
            );
          }).join("\t"),
        ).join("\n")
      );
    })
    .join("\n\n");
}
