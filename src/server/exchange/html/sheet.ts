import type { Snapshot } from "../../../shared/documents/model";
import { esc } from "../package";
import { color, textCss, number } from "./styles";

export function sheetHtml(snapshot: Snapshot, sheetSelector?: string) {
  const order = sheetSelector
    ? [
        snapshot.sheets[sheetSelector]
          ? sheetSelector
          : snapshot.sheetOrder.find(
              (id: string) => snapshot.sheets[id].name === sheetSelector,
            ),
      ]
    : snapshot.sheetOrder;
  if (order.some((id: any) => !id)) throw new Error("WORKSHEET_NOT_FOUND");
  let budget = 0;
  const contents = order
    .map((id: string, index: number) => {
      const sheet = snapshot.sheets[id];
      let drawings: any[] = [];
      try {
        drawings = Object.values(
          JSON.parse(
            (snapshot.resources ?? []).find(
              (r: any) => r.name === "SHEET_DRAWING_PLUGIN",
            )?.data ?? "{}",
          )[id]?.data ?? {},
        );
      } catch {}
      let rows = 0,
        cols = 0;
      for (const [r, row] of Object.entries(sheet.cellData ?? {}))
        for (const [c, cell] of Object.entries(row as any))
          if (cell && Object.keys(cell).length) {
            rows = Math.max(rows, +r + 1);
            cols = Math.max(cols, +c + 1);
          }
      for (const d of drawings) {
        rows = Math.max(rows, (d.sheetTransform?.to?.row ?? d.row ?? 0) + 2);
        cols = Math.max(
          cols,
          (d.sheetTransform?.to?.column ?? d.column ?? 0) + 2,
        );
      }
      budget += rows * cols;
      if (budget > 100000) throw new Error("PDF_CELL_LIMIT");
      const covered = new Set<string>(),
        merges = new Map<string, any>();
      for (const m of sheet.mergeData ?? []) {
        merges.set(m.startRow + ":" + m.startColumn, m);
        for (let r = m.startRow; r <= m.endRow; r++)
          for (let c = m.startColumn; c <= m.endColumn; c++)
            if (r !== m.startRow || c !== m.startColumn)
              covered.add(r + ":" + c);
      }
      const contentWidth = Array.from({ length: cols }, (_, c) =>
        sheet.columnData?.[c]?.hd
          ? 0
          : number(sheet.columnData?.[c]?.w, sheet.defaultColumnWidth ?? 80),
      ).reduce((a, b) => a + b, 0);
      const images = drawings
        .map((d) => {
          if (d.drawingType !== 0) return "";
          if (
            !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(
              d.source ?? "",
            )
          )
            throw new Error("UNRESOLVED_PDF_IMAGE");
          const t = d.transform ?? {};
          return (
            '<img src="' +
            esc(d.source) +
            '" alt="' +
            esc(d.title ?? "") +
            '" style="position:absolute;left:' +
            number(t.left) +
            "px;top:" +
            number(t.top) +
            "px;width:" +
            number(t.width, d.width ?? 100) +
            "px;height:" +
            number(t.height, d.height ?? 100) +
            'px">'
          );
        })
        .join("");
      return (
        "<section" +
        (index ? ' style="break-before:page"' : "") +
        "><h1>" +
        esc(sheet.name) +
        '</h1><div style="position:relative;width:' +
        contentWidth +
        "px;zoom:" +
        Math.min(1, 1032 / Math.max(1, contentWidth)) +
        '"><table><colgroup>' +
        Array.from(
          { length: cols },
          (_, c) =>
            '<col style="width:' +
            number(sheet.columnData?.[c]?.w, sheet.defaultColumnWidth ?? 80) +
            'px">',
        ).join("") +
        "</colgroup><tbody>" +
        Array.from({ length: rows }, (_, r) =>
          sheet.rowData?.[r]?.hd
            ? ""
            : '<tr style="height:' +
              number(sheet.rowData?.[r]?.h, sheet.defaultRowHeight ?? 20) +
              'px">' +
              Array.from({ length: cols }, (_, c) => {
                if (covered.has(r + ":" + c) || sheet.columnData?.[c]?.hd)
                  return "";
                const cell = sheet.cellData?.[r]?.[c],
                  style =
                    typeof cell?.s === "string"
                      ? snapshot.styles?.[cell.s]
                      : cell?.s,
                  merge = merges.get(r + ":" + c),
                  value =
                    cell?.pioneerDisplay ??
                    cell?.p?.body?.dataStream?.replace(/\r\n$/, "") ??
                    cell?.v ??
                    cell?.f ??
                    "";
                return (
                  "<td" +
                  (merge
                    ? ' colspan="' +
                      (merge.endColumn - c + 1) +
                      '" rowspan="' +
                      (merge.endRow - r + 1) +
                      '"'
                    : "") +
                  ' style="' +
                  textCss(style ?? {}) +
                  (style?.bg ? ";background:" + color(style.bg) : "") +
                  '">' +
                  esc(value) +
                  "</td>"
                );
              }).join("") +
              "</tr>",
        ).join("") +
        "</tbody></table>" +
        images +
        "</div></section>"
      );
    })
    .join("");
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    esc(snapshot.name) +
    "</title><style>@page{size:A4 landscape;margin:12mm}body{font:10pt Arial}h1{font-size:14pt}table{border-collapse:collapse;table-layout:fixed;width:100%}td{border:1px solid #bbb;padding:3px;white-space:pre-wrap;overflow-wrap:anywhere}tr{break-inside:avoid}</style></head><body>" +
    contents +
    "</body></html>"
  );
}
