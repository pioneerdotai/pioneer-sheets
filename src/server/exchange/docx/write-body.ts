import { xmlPart, xml, child, descendants, esc, serialize } from "../package";
import { docBlocks, paragraphSegments, type DocBlock } from "../doc-model";
import { R } from "./namespaces";
import { twips, hex } from "./values";
import { paragraphFingerprint } from "./paragraphs";
import { paragraphProperties, textRun } from "./write-styles";
import type { WriteContext } from "./write-context";

export function rawParagraph(
  context: Pick<WriteContext, "originalParts" | "originalTrees">,
  info: any,
) {
  if (!info || !context.originalParts[info.part]) return;
  if (!context.originalTrees.has(info.part))
    context.originalTrees.set(
      info.part,
      descendants(xmlPart(context.originalParts, info.part), "p"),
    );
  return context.originalTrees.get(info.part)?.[info.index];
}

export function bodyXml(
  context: Pick<
    WriteContext,
    | "snapshot"
    | "originalParagraphs"
    | "rawParagraph"
    | "sectionXml"
    | "options"
    | "diagnostics"
    | "numberIds"
    | "imageXml"
    | "addRel"
    | "serial"
  >,
  body: any,
  part: string,
  main = false,
) {
  const blockXml = (block: DocBlock): string => {
    if (block.kind === "table") {
      const table = context.snapshot.tableSource?.[block.tableId] ?? {},
        width = Number(table.size?.width?.v ?? 600),
        cols = table.tableColumns ?? [];
      const rows = block.rows
        .map(
          (row, r) =>
            "<w:tr>" +
            row
              .map((cell, c) => {
                const config = table.tableRows?.[r]?.tableCells?.[c] ?? {},
                  span = config.columnSpan ?? 1,
                  width = cols
                    .slice(c, c + span)
                    .reduce(
                      (n: number, col: any) =>
                        n + Number(col.size?.width?.v ?? 100),
                      0,
                    ),
                  cellPr = ['<w:tcW w:type="dxa" w:w="' + twips(width) + '"/>'];
                if (span > 1) cellPr.push('<w:gridSpan w:val="' + span + '"/>');
                if (config.rowSpan > 1)
                  cellPr.push('<w:vMerge w:val="restart"/>');
                if (config.pioneerVerticalMerge)
                  cellPr.push(
                    "<w:vMerge" +
                      (config.pioneerVerticalMerge === "restart"
                        ? ' w:val="restart"'
                        : "") +
                      "/>",
                  );
                if (hex(config.backgroundColor))
                  cellPr.push(
                    '<w:shd w:fill="' + hex(config.backgroundColor) + '"/>',
                  );
                const borders = ["top", "bottom", "left", "right"]
                  .map((side) => {
                    const b =
                      config["border" + side[0].toUpperCase() + side.slice(1)];
                    return b
                      ? "<w:" +
                          side +
                          ' w:val="' +
                          (b.dashStyle === 2 ? "dashed" : "single") +
                          '" w:sz="' +
                          Math.max(1, Math.round(Number(b.width?.v ?? 1) * 6)) +
                          '" w:color="' +
                          (hex(b.color) ?? "000000") +
                          '"/>'
                      : "";
                  })
                  .join("");
                if (borders)
                  cellPr.push("<w:tcBorders>" + borders + "</w:tcBorders>");
                if (config.margin)
                  cellPr.push(
                    "<w:tcMar>" +
                      ["top", "bottom", "start", "end"]
                        .map(
                          (side) =>
                            "<w:" +
                            side +
                            ' w:w="' +
                            twips(config.margin[side]?.v ?? 0) +
                            '" w:type="dxa"/>',
                        )
                        .join("") +
                      "</w:tcMar>",
                  );
                return (
                  "<w:tc><w:tcPr>" +
                  cellPr.join("") +
                  "</w:tcPr>" +
                  cell.blocks.map(blockXml).join("") +
                  "</w:tc>"
                );
              })
              .join("") +
            "</w:tr>",
        )
        .join("");
      return (
        '<w:tbl><w:tblPr><w:tblW w:w="' +
        twips(width) +
        '" w:type="dxa"/><w:tblBorders>' +
        ["top", "left", "bottom", "right", "insideH", "insideV"]
          .map(
            (side) =>
              "<w:" + side + ' w:val="single" w:sz="4" w:color="B0B0B0"/>',
          )
          .join("") +
        "</w:tblBorders></w:tblPr><w:tblGrid>" +
        cols
          .map(
            (c: any) =>
              '<w:gridCol w:w="' + twips(c.size?.width?.v ?? 100) + '"/>',
          )
          .join("") +
        "</w:tblGrid>" +
        rows +
        "</w:tbl>"
      );
    }
    const info = context.originalParagraphs[block.paragraph.paragraphId],
      raw = context.rawParagraph(info),
      same =
        info?.fingerprint ===
        paragraphFingerprint(context.snapshot, body, block);
    if (raw && same) {
      const copy = structuredClone(raw),
        pr = child(copy, "pPr"),
        section = (body.sectionBreaks ?? []).find(
          (s: any) =>
            s.startIndex === block.end + 1 &&
            s.startIndex < body.dataStream.length - 1,
        );
      if (main && child(pr, "sectPr") && section) {
        pr!.children = pr!.children.filter((n) => !n.name.endsWith("sectPr"));
        pr!.children.push(
          child(xml(context.sectionXml(section, part)), "sectPr")!,
        );
      }
      return serialize(copy);
    }
    if (raw && info.opaque && !context.options.allowLossy)
      throw new Error(
        "DOCX_OPAQUE_PARAGRAPH_EDIT: " + block.paragraph.paragraphId,
      );
    if (raw && info.opaque)
      context.diagnostics.push({
        severity: "warning",
        code: "DOCX_OPAQUE_PARAGRAPH_REBUILT",
        message:
          "Edited paragraph contains source-only content. Source package remains retained.",
        location: block.paragraph.paragraphId,
        preserved: true,
      });
    const section = (body.sectionBreaks ?? []).find(
        (s: any) =>
          s.startIndex === block.end + 1 &&
          s.startIndex < body.dataStream.length - 1,
      ),
      p = block.paragraph,
      num = p.bullet ? context.numberIds.get(p.bullet.listId) : undefined;
    const runs = paragraphSegments(body, block)
      .map((segment) => {
        if (segment.drawingId)
          return context.imageXml(segment.drawingId, body, part);
        let content = textRun(segment.text, {
          ...context.snapshot.documentStyle?.textStyle,
          ...segment.style,
        });
        if (segment.url && /^(https?:|mailto:|tel:|#)/i.test(segment.url)) {
          if (segment.url.startsWith("#"))
            content =
              '<w:hyperlink w:anchor="' +
              esc(segment.url.slice(1)) +
              '">' +
              content +
              "</w:hyperlink>";
          else
            content =
              '<w:hyperlink r:id="' +
              context.addRel(part, R + "/hyperlink", segment.url, true) +
              '">' +
              content +
              "</w:hyperlink>";
        }
        const fields = (body.customRanges ?? []).filter(
          (r: any) =>
            r.startIndex === segment.start && r.properties?.docxInstruction,
        );
        for (const f of fields)
          content =
            '<w:fldSimple w:instr="' +
            esc(f.properties.docxInstruction) +
            '">' +
            content;
        for (const f of body.customRanges ?? [])
          if (f.properties?.docxInstruction && f.endIndex === segment.end - 1)
            content += "</w:fldSimple>";
        for (const b of body.customRanges ?? [])
          if (b.properties?.name) {
            const bid =
              String(b.rangeId)
                .replace(/[^0-9]/g, "")
                .slice(0, 8) || String(++context.serial);
            if (b.startIndex === segment.start)
              content =
                '<w:bookmarkStart w:id="' +
                bid +
                '" w:name="' +
                esc(b.properties.name) +
                '"/>' +
                content;
            if (b.endIndex === segment.end - 1)
              content += '<w:bookmarkEnd w:id="' + bid + '"/>';
          }
        return content;
      })
      .join("");
    return (
      "<w:p>" +
      paragraphProperties(
        p,
        main && section ? context.sectionXml(section, part) : "",
        info?.styleId,
        num,
      ) +
      runs +
      "</w:p>"
    );
  };
  return (
    docBlocks(body).map(blockXml).join("") +
    (main
      ? context.sectionXml(
          (body.sectionBreaks ?? []).find(
            (s: any) => s.startIndex === body.dataStream.length - 1,
          ) ?? {},
          part,
        )
      : "")
  );
}
