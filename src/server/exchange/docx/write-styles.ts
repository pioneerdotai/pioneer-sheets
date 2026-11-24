import { esc } from "../package";
import { twips, hex } from "./values";

export function runProperties(style: any) {
  const p = [];
  if (style.ff)
    p.push(
      '<w:rFonts w:ascii="' +
        esc(style.ff) +
        '" w:hAnsi="' +
        esc(style.ff) +
        '"/>',
    );
  if (style.fs)
    p.push(
      '<w:sz w:val="' +
        Math.round(style.fs * 2) +
        '"/><w:szCs w:val="' +
        Math.round(style.fs * 2) +
        '"/>',
    );
  if (style.bl !== undefined)
    p.push('<w:b w:val="' + (style.bl ? 1 : 0) + '"/>');
  if (style.it !== undefined)
    p.push('<w:i w:val="' + (style.it ? 1 : 0) + '"/>');
  if (style.ul?.s)
    p.push('<w:u w:val="' + (style.ul.t === 1 ? "double" : "single") + '"/>');
  if (style.st?.s) p.push("<w:strike/>");
  if (hex(style.cl)) p.push('<w:color w:val="' + hex(style.cl) + '"/>');
  if (hex(style.bg)) p.push('<w:shd w:fill="' + hex(style.bg) + '"/>');
  if (style.va)
    p.push(
      '<w:vertAlign w:val="' +
        (style.va === 1 ? "superscript" : "subscript") +
        '"/>',
    );
  return p.length ? "<w:rPr>" + p.join("") + "</w:rPr>" : "";
}

export function paragraphProperties(
  p: any,
  sectionXml = "",
  styleId?: string,
  numId?: number,
) {
  const style = p.paragraphStyle ?? {},
    parts = [];
  if (styleId) parts.push('<w:pStyle w:val="' + esc(styleId) + '"/>');
  else if (style.namedStyleType >= 4 && style.namedStyleType <= 8)
    parts.push('<w:pStyle w:val="Heading' + (style.namedStyleType - 3) + '"/>');
  if (style.horizontalAlign)
    parts.push(
      '<w:jc w:val="' +
        (
          {
            1: "left",
            2: "center",
            3: "right",
            4: "both",
            5: "both",
            6: "distribute",
          } as any
        )[style.horizontalAlign] +
        '"/>',
    );
  const unit = (v: any) => Number(v?.v ?? v ?? 0);
  if (style.spaceAbove || style.spaceBelow || style.lineSpacing)
    parts.push(
      "<w:spacing" +
        (style.spaceAbove
          ? ' w:before="' + twips(unit(style.spaceAbove)) + '"'
          : "") +
        (style.spaceBelow
          ? ' w:after="' + twips(unit(style.spaceBelow)) + '"'
          : "") +
        (style.lineSpacing
          ? ' w:line="' +
            Math.round(
              style.spacingRule
                ? unit(style.lineSpacing) * 15
                : unit(style.lineSpacing) * 240,
            ) +
            '" w:lineRule="' +
            (style.spacingRule === 2
              ? "exact"
              : style.spacingRule === 1
                ? "atLeast"
                : "auto") +
            '"'
          : "") +
        "/>",
    );
  if (
    style.indentStart ||
    style.indentEnd ||
    style.indentFirstLine ||
    style.hanging
  )
    parts.push(
      "<w:ind" +
        (style.indentStart
          ? ' w:left="' + twips(unit(style.indentStart)) + '"'
          : "") +
        (style.indentEnd
          ? ' w:right="' + twips(unit(style.indentEnd)) + '"'
          : "") +
        (style.indentFirstLine
          ? ' w:firstLine="' + twips(unit(style.indentFirstLine)) + '"'
          : "") +
        (style.hanging
          ? ' w:hanging="' + twips(unit(style.hanging)) + '"'
          : "") +
        "/>",
    );
  for (const name of [
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "widowControl",
    "contextualSpacing",
  ])
    if (style[name] !== undefined)
      parts.push("<w:" + name + ' w:val="' + (style[name] ? 1 : 0) + '"/>');
  if (p.bullet && numId !== undefined)
    parts.push(
      '<w:numPr><w:ilvl w:val="' +
        (p.bullet.nestingLevel ?? 0) +
        '"/><w:numId w:val="' +
        numId +
        '"/></w:numPr>',
    );
  if (sectionXml) parts.push(sectionXml);
  return parts.length ? "<w:pPr>" + parts.join("") + "</w:pPr>" : "";
}

export function textRun(value: string, style: any) {
  const content = value
    .split(/([\t\n\f\v])/)
    .map((part) =>
      part === "\t"
        ? "<w:tab/>"
        : part === "\f"
          ? '<w:br w:type="page"/>'
          : part === "\v"
            ? '<w:br w:type="column"/>'
            : part === "\n"
              ? "<w:br/>"
              : part
                ? '<w:t xml:space="preserve">' +
                  esc(part.replace(/\u200b/g, "")) +
                  "</w:t>"
                : "",
    )
    .join("");
  return "<w:r>" + runProperties(style) + content + "</w:r>";
}
