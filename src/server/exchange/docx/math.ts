import type { XmlNode } from "../package";
import { child, children, text, esc } from "../package";
import { value } from "./values";

export function mathMl(node: XmlNode): string {
  const name = node.name.split(":").pop()!,
    elements = node.children.filter(
      (c) => c.name !== "#text" && !c.name.endsWith("Pr"),
    );
  const group = (n: XmlNode | undefined) =>
    n
      ? n.children
          .filter((c) => !c.name.endsWith("Pr"))
          .map(mathMl)
          .join("")
      : "";
  if (name === "t") {
    const str = text(node);
    return (
      "<" +
      (/^[0-9.]+$/.test(str)
        ? "mn"
        : /^[+\-=<>×÷∑∫()[\]{}|]+$/.test(str)
          ? "mo"
          : "mi") +
      ">" +
      esc(str) +
      "</" +
      (/^[0-9.]+$/.test(str)
        ? "mn"
        : /^[+\-=<>×÷∑∫()[\]{}|]+$/.test(str)
          ? "mo"
          : "mi") +
      ">"
    );
  }
  if (name === "f")
    return (
      "<mfrac><mrow>" +
      group(child(node, "num")) +
      "</mrow><mrow>" +
      group(child(node, "den")) +
      "</mrow></mfrac>"
    );
  if (name === "sSup" || name === "sSub" || name === "sSubSup") {
    const tag = name === "sSup" ? "msup" : name === "sSub" ? "msub" : "msubsup";
    return (
      "<" +
      tag +
      "><mrow>" +
      group(child(node, "e")) +
      "</mrow>" +
      (name !== "sSup"
        ? "<mrow>" + group(child(node, "sub")) + "</mrow>"
        : "") +
      (name !== "sSub"
        ? "<mrow>" + group(child(node, "sup")) + "</mrow>"
        : "") +
      "</" +
      tag +
      ">"
    );
  }
  if (name === "rad") {
    const degree = child(node, "deg");
    return degree && text(degree)
      ? "<mroot><mrow>" +
          group(child(node, "e")) +
          "</mrow><mrow>" +
          group(degree) +
          "</mrow></mroot>"
      : "<msqrt>" + group(child(node, "e")) + "</msqrt>";
  }
  if (name === "d") {
    const pr = child(node, "dPr"),
      open = value(pr, "begChr") ?? "(",
      close = value(pr, "endChr") ?? ")";
    return (
      "<mrow><mo>" +
      esc(open) +
      "</mo>" +
      elements.map(mathMl).join("") +
      "<mo>" +
      esc(close) +
      "</mo></mrow>"
    );
  }
  if (name === "m")
    return (
      "<mtable>" +
      children(node, "mr")
        .map(
          (row) =>
            "<mtr>" +
            children(row, "e")
              .map((cell) => "<mtd>" + group(cell) + "</mtd>")
              .join("") +
            "</mtr>",
        )
        .join("") +
      "</mtable>"
    );
  if (name === "nary") {
    const symbol = value(child(node, "naryPr"), "chr") ?? "∫";
    return (
      "<mrow><munderover><mo>" +
      esc(symbol) +
      "</mo><mrow>" +
      group(child(node, "sub")) +
      "</mrow><mrow>" +
      group(child(node, "sup")) +
      "</mrow></munderover>" +
      group(child(node, "e")) +
      "</mrow>"
    );
  }
  return elements.map(mathMl).join("");
}
