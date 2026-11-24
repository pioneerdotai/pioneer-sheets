import type { Snapshot } from "../../../shared/documents/model";
import { docBlocks, paragraphSegments, type DocBlock } from "../doc-model";
import { esc } from "../package";
import { color, textCss, number } from "./styles";
import { safeMath } from "./math";

export function docHtml(snapshot: Snapshot, fragment = false) {
  const style = snapshot.documentStyle ?? {},
    size = style.pageSize ?? { width: 794, height: 1123 },
    paragraphs = (body: any, blocks: DocBlock[]): string =>
      blocks
        .map((block) => {
          if (block.kind === "table") {
            const table = snapshot.tableSource?.[block.tableId] ?? {},
              width = number(
                table.size?.width,
                Math.max(
                  10,
                  size.width -
                    number(style.marginLeft) -
                    number(style.marginRight),
                ),
              );
            return (
              '<table style="border-collapse:collapse;table-layout:fixed;width:' +
              width +
              'px"><colgroup>' +
              (table.tableColumns ?? [])
                .map(
                  (c: any) =>
                    '<col style="width:' + number(c.size?.width, 100) + 'px">',
                )
                .join("") +
              "</colgroup><tbody>" +
              block.rows
                .map(
                  (row, r) =>
                    "<tr>" +
                    row
                      .map((cell, c) => {
                        const config =
                            table.tableRows?.[r]?.tableCells?.[c] ?? {},
                          cellStyle =
                            "border:1px solid #aaa;padding:5px 10px;" +
                            (color(config.backgroundColor)
                              ? "background:" +
                                color(config.backgroundColor) +
                                ";"
                              : "");
                        return (
                          "<td" +
                          (config.columnSpan
                            ? ' colspan="' + config.columnSpan + '"'
                            : "") +
                          (config.rowSpan
                            ? ' rowspan="' + config.rowSpan + '"'
                            : "") +
                          ' style="' +
                          cellStyle +
                          '">' +
                          paragraphs(body, cell.blocks) +
                          "</td>"
                        );
                      })
                      .join("") +
                    "</tr>",
                )
                .join("") +
              "</tbody></table>"
            );
          }
          const p = block.paragraph,
            ps = p.paragraphStyle ?? {},
            heading =
              ps.namedStyleType >= 4 && ps.namedStyleType <= 8
                ? "h" + (ps.namedStyleType - 3)
                : "p",
            css = [
              "margin-top:" + number(ps.spaceAbove) + "px",
              "margin-bottom:" + number(ps.spaceBelow, 8) + "px",
              ps.horizontalAlign
                ? "text-align:" +
                  (
                    {
                      1: "left",
                      2: "center",
                      3: "right",
                      4: "justify",
                      5: "justify",
                    } as any
                  )[ps.horizontalAlign]
                : "",
              ps.pageBreakBefore ? "break-before:page" : "",
              ps.keepNext ? "break-after:avoid" : "",
              ps.keepLines ? "break-inside:avoid" : "",
              ps.indentStart
                ? "margin-left:" + number(ps.indentStart) + "px"
                : "",
              ps.indentEnd ? "margin-right:" + number(ps.indentEnd) + "px" : "",
              ps.indentFirstLine
                ? "text-indent:" + number(ps.indentFirstLine) + "px"
                : "",
            ]
              .filter(Boolean)
              .join(";");
          let html = paragraphSegments(body, block)
            .map((segment) => {
              if (segment.drawingId) {
                const image = snapshot.drawings?.[segment.drawingId];
                if (!image) {
                  const note = body.customBlocks?.find(
                    (b: any) => b.blockId === segment.drawingId,
                  );
                  if (note?.noteId)
                    return (
                      '<sup><a href="#note-' +
                      esc(note.noteId) +
                      '">' +
                      esc(note.noteId.split(":").pop()) +
                      "</a></sup>"
                    );
                  return "";
                }
                const transform =
                    image.docTransform?.size ?? image.transform ?? {},
                  width = number(transform.width, 100),
                  height = number(transform.height, 100);
                if (image.pioneerMath?.mathML)
                  return (
                    '<span class="math">' +
                    safeMath(image.pioneerMath.mathML) +
                    "</span>"
                  );
                if (
                  !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(
                    image.source ?? "",
                  )
                )
                  throw new Error("UNRESOLVED_EXPORT_IMAGE");
                return (
                  '<img alt="' +
                  esc(image.description ?? image.title ?? "") +
                  '" src="' +
                  esc(image.source) +
                  '" style="width:' +
                  width +
                  "px;height:" +
                  height +
                  'px;max-width:100%">'
                );
              }
              let value = esc(segment.text)
                .replace(/\f/g, '<br style="break-after:page">')
                .replace(/\v/g, "<br>")
                .replace(/\n/g, "<br>")
                .replace(/\t/g, "&#9;");
              if (segment.url && /^(https?:|mailto:|tel:|#)/i.test(segment.url))
                value = '<a href="' + esc(segment.url) + '">' + value + "</a>";
              return (
                '<span style="' +
                textCss({ ...style.textStyle, ...segment.style }) +
                '">' +
                value +
                "</span>"
              );
            })
            .join("");
          if (p.bullet) {
            const marker = p.bullet.listType === "ORDER_LIST" ? "1." : "•";
            html = '<span aria-hidden="true">' + marker + " </span>" + html;
          }
          return (
            "<" +
            heading +
            ' style="' +
            css +
            '">' +
            (html || "<br>") +
            "</" +
            heading +
            ">"
          );
        })
        .join("");
  const body =
    paragraphs(snapshot.body, docBlocks(snapshot.body)) +
    Object.values(snapshot.notes ?? {})
      .map(
        (note: any) =>
          '<aside id="note-' +
          esc(note.noteId) +
          '"><sup>' +
          esc(note.noteId.split(":").pop()) +
          "</sup> " +
          paragraphs(note.body, docBlocks(note.body)) +
          "</aside>",
      )
      .join("");
  if (fragment) return body;
  const fonts = (snapshot.resources ?? []).find(
    (r: any) => r.name === "PIONEER_FONT_BUNDLE",
  );
  let fontCss = "";
  try {
    fontCss =
      JSON.parse(fonts?.data ?? "{}")
        .faces?.filter(
          (f: any) =>
            typeof f.data === "string" && /^[a-zA-Z0-9+/=]+$/.test(f.data),
        )
        .map(
          (f: any) =>
            '@font-face{font-family:"' +
            String(f.family).replace(/["<>;]/g, "") +
            '";src:url(data:font/ttf;base64,' +
            f.data +
            ");font-weight:" +
            String(f.weight).replace(/[^a-z0-9]/gi, "") +
            ";font-style:" +
            String(f.style).replace(/[^a-z]/gi, "") +
            "}",
        )
        .join("") ?? "";
  } catch {}
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    esc(snapshot.title) +
    "</title><style>" +
    fontCss +
    "@page{size:" +
    number(size.width, 794) +
    "px " +
    number(size.height, 1123) +
    "px;margin:" +
    number(style.marginTop, 56) +
    "px " +
    number(style.marginRight, 56) +
    "px " +
    number(style.marginBottom, 56) +
    "px " +
    number(style.marginLeft, 56) +
    "px}body{" +
    textCss(style.textStyle ?? { ff: "Arial", fs: 11 }) +
    "}img{vertical-align:middle}p,h1,h2,h3,h4,h5{white-space:pre-wrap;overflow-wrap:break-word}table p{margin:0}a{color:#0563c1}header,footer{font-size:9pt;color:#666}header{margin-bottom:12px}footer{margin-top:12px}</style></head><body>" +
    Object.values(snapshot.headers ?? {})
      .slice(0, 1)
      .map(
        (h: any) =>
          "<header>" + paragraphs(h.body, docBlocks(h.body)) + "</header>",
      )
      .join("") +
    body +
    Object.values(snapshot.footers ?? {})
      .slice(0, 1)
      .map(
        (h: any) =>
          "<footer>" + paragraphs(h.body, docBlocks(h.body)) + "</footer>",
      )
      .join("") +
    "</body></html>"
  );
}

export function docMarkdown(snapshot: Snapshot) {
  function blocks(body: any, items: DocBlock[]): string {
    return items
      .map((b) => {
        if (b.kind === "table") {
          const rows = b.rows.map(
            (row) =>
              "| " +
              row
                .map((cell) =>
                  blocks(body, cell.blocks).trim().replace(/\n/g, "<br>"),
                )
                .join(" | ") +
              " |",
          );
          if (rows.length)
            rows.splice(
              1,
              0,
              "| " + b.rows[0].map(() => "---").join(" | ") + " |",
            );
          return rows.join("\n") + "\n\n";
        }
        const p = b.paragraph,
          ps = p.paragraphStyle ?? {};
        let line = paragraphSegments(body, b)
          .map((s) => {
            if (s.drawingId) {
              const drawing = snapshot.drawings?.[s.drawingId];
              return drawing?.pioneerMath?.mathML
                ? safeMath(drawing.pioneerMath.mathML)
                : drawing
                  ? "![" + (drawing.title ?? "") + "](" + drawing.source + ")"
                  : "";
            }
            let value = s.text.replace(/([\\*_[\]<>])/g, "\\$1");
            if (s.style.bl) value = "**" + value + "**";
            if (s.style.it) value = "*" + value + "*";
            if (s.url) value = "[" + value + "](" + s.url + ")";
            return value;
          })
          .join("");
        if (ps.namedStyleType >= 4 && ps.namedStyleType <= 8)
          line = "#".repeat(ps.namedStyleType - 3) + " " + line;
        if (p.bullet)
          line =
            "  ".repeat(p.bullet.nestingLevel ?? 0) +
            (p.bullet.listType === "ORDER_LIST" ? "1. " : "- ") +
            line;
        return line + "\n\n";
      })
      .join("");
  }
  return blocks(snapshot.body, docBlocks(snapshot.body));
}
