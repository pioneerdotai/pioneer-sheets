import type { XmlNode } from "../package";
import { child, attr } from "../package";

export const value = (
  node: XmlNode | undefined,
  name: string,
  attribute = "val",
) => attr(child(node, name), attribute);

export const flag = (node: XmlNode | undefined, name: string) => {
  const item = child(node, name);
  return item
    ? !["0", "false", "off", "none"].includes(attr(item, "val") ?? "1")
    : undefined;
};

export const px = (value: any) => Number(value ?? 0) / 15;

export const twips = (value: any) => Math.round(Number(value ?? 0) * 15);

export const fontColors: Record<string, string> = {
  black: "000000",
  blue: "0000FF",
  cyan: "00FFFF",
  green: "00FF00",
  magenta: "FF00FF",
  red: "FF0000",
  yellow: "FFFF00",
  white: "FFFFFF",
  darkBlue: "000080",
  darkCyan: "008080",
  darkGreen: "008000",
  darkMagenta: "800080",
  darkRed: "800000",
  darkYellow: "808000",
  darkGray: "808080",
  lightGray: "C0C0C0",
};

export function hex(color: any) {
  const raw = color?.rgb ?? color;
  if (typeof raw !== "string") return;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (rgb)
    return rgb
      .slice(1, 4)
      .map((c) => Math.max(0, Math.min(255, +c)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  const h = raw.replace("#", "");
  return /^[a-f0-9]{6}$/i.test(h) ? h.toUpperCase() : fontColors[raw];
}
