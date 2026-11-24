import type { XmlNode } from "../package";
import { child, attr } from "../package";
import { value, flag, px, fontColors } from "./values";

export function runStyle(node: XmlNode | undefined) {
  if (!node) return {};
  const style: any = {};
  const fonts = child(node, "rFonts"),
    size = value(node, "sz"),
    color = value(node, "color"),
    highlight = value(node, "highlight"),
    shade = value(node, "shd", "fill");
  if (fonts)
    style.ff =
      attr(fonts, "ascii") ??
      attr(fonts, "hAnsi") ??
      attr(fonts, "eastAsia") ??
      "Arial";
  if (size !== undefined) style.fs = +size / 2;
  for (const [name, key] of [
    ["b", "bl"],
    ["i", "it"],
  ]) {
    const result = flag(node, name);
    if (result !== undefined) style[key] = result ? 1 : 0;
  }
  if (child(node, "u"))
    style.ul = {
      s: flag(node, "u") ? 1 : 0,
      ...(value(node, "u") === "double" ? { t: 1 } : {}),
    };
  if (child(node, "strike") || child(node, "dstrike"))
    style.st = { s: flag(node, "strike") || flag(node, "dstrike") ? 1 : 0 };
  if (color && /^[a-f0-9]{6}$/i.test(color)) style.cl = { rgb: "#" + color };
  if (highlight && fontColors[highlight])
    style.bg = { rgb: "#" + fontColors[highlight] };
  else if (shade && /^[a-f0-9]{6}$/i.test(shade))
    style.bg = { rgb: "#" + shade };
  const vertical = value(node, "vertAlign");
  if (vertical)
    style.va =
      vertical === "superscript" ? 1 : vertical === "subscript" ? 2 : 0;
  return style;
}

export function paragraphStyle(node: XmlNode | undefined) {
  const result: any = {};
  if (!node) return result;
  const align = value(node, "jc"),
    spacing = child(node, "spacing"),
    indent = child(node, "ind");
  if (align)
    result.horizontalAlign =
      (
        {
          left: 1,
          start: 1,
          center: 2,
          right: 3,
          end: 3,
          both: 4,
          distribute: 6,
        } as any
      )[align] ?? 1;
  if (spacing) {
    const above = attr(spacing, "before"),
      below = attr(spacing, "after"),
      line = attr(spacing, "line"),
      rule = attr(spacing, "lineRule");
    if (above !== undefined) result.spaceAbove = { v: px(above) };
    if (below !== undefined) result.spaceBelow = { v: px(below) };
    if (line !== undefined) {
      result.spacingRule = rule === "exact" ? 2 : rule === "atLeast" ? 1 : 0;
      result.lineSpacing = result.spacingRule === 0 ? +line / 240 : px(line);
    }
  }
  if (indent) {
    if (attr(indent, "left") ?? attr(indent, "start"))
      result.indentStart = {
        v: px(attr(indent, "left") ?? attr(indent, "start")),
      };
    if (attr(indent, "right") ?? attr(indent, "end"))
      result.indentEnd = {
        v: px(attr(indent, "right") ?? attr(indent, "end")),
      };
    if (attr(indent, "firstLine"))
      result.indentFirstLine = { v: px(attr(indent, "firstLine")) };
    if (attr(indent, "hanging"))
      result.hanging = { v: px(attr(indent, "hanging")) };
  }
  for (const name of [
    "keepNext",
    "keepLines",
    "pageBreakBefore",
    "widowControl",
    "contextualSpacing",
  ]) {
    const f = flag(node, name);
    if (f !== undefined) result[name] = f ? 1 : 0;
  }
  return result;
}
