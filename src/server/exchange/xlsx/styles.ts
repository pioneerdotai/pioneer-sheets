import type { Snapshot } from "../../../shared/documents/model";

export const borderNames = [
  "",
  "thin",
  "hair",
  "dotted",
  "dashed",
  "dashDot",
  "dashDotDot",
  "double",
  "medium",
  "mediumDashed",
  "mediumDashDot",
  "mediumDashDotDot",
  "slantDashDot",
  "thick",
];

export const defaultTheme = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
  "0563C1",
  "954F72",
];

export function rgb(color: any, theme = defaultTheme): string | undefined {
  if (!color) return;
  let hex =
    color.argb?.slice(-6) ??
    (color.theme !== undefined ? theme[color.theme] : undefined) ??
    (color.indexed !== undefined
      ? [
          "000000",
          "FFFFFF",
          "FF0000",
          "00FF00",
          "0000FF",
          "FFFF00",
          "FF00FF",
          "00FFFF",
        ][color.indexed % 8]
      : undefined);
  if (!hex) return;
  if (color.tint) {
    const amount = color.tint;
    hex = hex
      .match(/../g)!
      .map((c: string) => {
        const v = parseInt(c, 16),
          value = amount < 0 ? v * (1 + amount) : v + (255 - v) * amount;
        return Math.round(value).toString(16).padStart(2, "0");
      })
      .join("");
  }
  return "#" + hex.toUpperCase();
}

export function fontIn(f: any, theme?: string[]) {
  return {
    ...(f?.name ? { ff: f.name } : {}),
    ...(f?.size ? { fs: f.size } : {}),
    ...(f?.bold !== undefined ? { bl: f.bold ? 1 : 0 } : {}),
    ...(f?.italic !== undefined ? { it: f.italic ? 1 : 0 } : {}),
    ...(f?.strike !== undefined ? { st: { s: f.strike ? 1 : 0 } } : {}),
    ...(f?.underline
      ? {
          ul: {
            s: 1,
            ...(String(f.underline).includes("double") ? { t: 1 } : {}),
          },
        }
      : {}),
    ...(rgb(f?.color, theme) ? { cl: { rgb: rgb(f.color, theme) } } : {}),
    ...(f?.vertAlign ? { va: f.vertAlign === "superscript" ? 1 : 2 } : {}),
  };
}

export function styleIn(style: any, theme?: string[]) {
  const result: any = fontIn(style?.font, theme),
    align = style?.alignment;
  if (align) {
    result.ht =
      ({ left: 1, center: 2, right: 3, justify: 4, distributed: 6 } as any)[
        align.horizontal
      ] ?? 0;
    result.vt = ({ top: 1, middle: 2, bottom: 3 } as any)[align.vertical] ?? 0;
    result.tb = align.wrapText ? 3 : 1;
    if (align.shrinkToFit) result.shrinkToFit = 1;
    if (align.indent) result.indent = align.indent;
    if (typeof align.textRotation === "number")
      result.tr = { a: align.textRotation };
  }
  const fill = style?.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const color = rgb(fill.fgColor, theme);
    if (color) result.bg = { rgb: color };
  }
  if (style?.border) {
    result.bd = {};
    for (const [from, to] of [
      ["top", "t"],
      ["bottom", "b"],
      ["left", "l"],
      ["right", "r"],
      ["diagonal", "tl_br"],
    ]) {
      const b = style.border[from];
      if (b)
        result.bd[to] = {
          s: Math.max(0, borderNames.indexOf(b.style)),
          cl: { rgb: rgb(b.color, theme) ?? "#000000" },
        };
    }
  }
  return result;
}

export function colorOut(value: any) {
  const raw = value?.rgb;
  if (!raw) return;
  let hex = raw.replace(/^#/, "");
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(raw);
  if (match)
    hex = match
      .slice(1, 4)
      .map((v: string) => Math.min(255, +v).toString(16).padStart(2, "0"))
      .join("");
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return /^[a-f0-9]{6,8}$/i.test(hex)
    ? { argb: "FF" + hex.slice(-6).toUpperCase() }
    : undefined;
}

export function styleOut(s: any) {
  const result: any = {
    font: {
      name: s?.ff ?? "Arial",
      size: s?.fs ?? 11,
      bold: s?.bl === 1,
      italic: s?.it === 1,
      strike: s?.st?.s === 1,
      ...(s?.ul?.s ? { underline: s.ul.t === 1 ? "double" : true } : {}),
      ...(colorOut(s?.cl) ? { color: colorOut(s.cl) } : {}),
    },
    alignment: {
      horizontal: (
        {
          1: "left",
          2: "center",
          3: "right",
          4: "justify",
          6: "distributed",
        } as any
      )[s?.ht],
      vertical: ({ 1: "top", 2: "middle", 3: "bottom" } as any)[s?.vt],
      wrapText: s?.tb === 3,
      shrinkToFit: !!s?.shrinkToFit,
      indent: s?.indent ?? 0,
      textRotation: s?.tr?.a ?? 0,
    },
  };
  if (s?.bg)
    result.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: colorOut(s.bg),
    };
  if (s?.bd) {
    result.border = {};
    for (const [from, to] of [
      ["t", "top"],
      ["b", "bottom"],
      ["l", "left"],
      ["r", "right"],
    ])
      if (s.bd[from])
        result.border[to] = {
          style: borderNames[s.bd[from].s] || "thin",
          color: colorOut(s.bd[from].cl),
        };
  }
  return result;
}

export function nativeStyle(snapshot: Snapshot, cell: any) {
  return typeof cell?.s === "string"
    ? (snapshot.styles?.[cell.s] ?? {})
    : (cell?.s ?? {});
}
