import type { XmlNode } from "../package";
import { esc, xml, localName } from "../package";

export function safeMath(source: string) {
  const tags = new Set([
    "math",
    "mrow",
    "mi",
    "mn",
    "mo",
    "mtext",
    "ms",
    "mspace",
    "mfrac",
    "msqrt",
    "mroot",
    "msup",
    "msub",
    "msubsup",
    "mover",
    "munder",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mstyle",
    "mpadded",
    "mphantom",
    "menclose",
    "semantics",
  ]);
  const attrs = new Set([
    "display",
    "mathvariant",
    "stretchy",
    "fence",
    "separator",
    "form",
    "accent",
    "accentunder",
    "rowalign",
    "columnalign",
    "rowspacing",
    "columnspacing",
    "linethickness",
    "notation",
  ]);
  const render = (node: XmlNode): string => {
    if (node.name === "#text") return esc(node.text);
    if (node.name === "#document") return node.children.map(render).join("");
    const name = localName(node.name);
    if (!tags.has(name)) return "";
    return (
      "<" +
      name +
      (name === "math" ? ' xmlns="http://www.w3.org/1998/Math/MathML"' : "") +
      Object.entries(node.attrs)
        .filter(([k]) => attrs.has(k))
        .map(([k, v]) => " " + k + '="' + esc(v) + '"')
        .join("") +
      ">" +
      node.children.map(render).join("") +
      "</" +
      name +
      ">"
    );
  };
  return render(xml(source));
}
