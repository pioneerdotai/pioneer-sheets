import { R } from "./namespaces";
import { twips } from "./values";
import type { WriteContext } from "./write-context";

export function sectionXml(
  context: Pick<WriteContext, "snapshot" | "headerParts" | "addRel">,
  config: any,
  part: string,
) {
  const style = { ...context.snapshot.documentStyle, ...config },
    size = style.pageSize ?? { width: 794, height: 1123 },
    parts = [
      '<w:pgSz w:w="' +
        twips(size.width) +
        '" w:h="' +
        twips(size.height) +
        '"' +
        (size.width > size.height ? ' w:orient="landscape"' : "") +
        "/>",
      '<w:pgMar w:top="' +
        twips(style.marginTop ?? 72) +
        '" w:bottom="' +
        twips(style.marginBottom ?? 72) +
        '" w:left="' +
        twips(style.marginLeft ?? 72) +
        '" w:right="' +
        twips(style.marginRight ?? 72) +
        '" w:header="' +
        twips(style.marginHeader ?? 36) +
        '" w:footer="' +
        twips(style.marginFooter ?? 36) +
        '" w:gutter="0"/>',
    ];
  if (style.sectionType)
    parts.push(
      '<w:type w:val="' +
        (
          {
            1: "continuous",
            2: "nextColumn",
            3: "nextPage",
            4: "evenPage",
            5: "oddPage",
          } as any
        )[style.sectionType] +
        '"/>',
    );
  if (style.columnProperties?.length) {
    const cols = style.columnProperties;
    parts.push(
      '<w:cols w:num="' +
        cols.length +
        '" w:equalWidth="0"' +
        (style.columnSeparatorType === 2 ? ' w:sep="1"' : "") +
        ">" +
        cols
          .map(
            (c: any) =>
              '<w:col w:w="' +
              twips(c.width) +
              '" w:space="' +
              twips(c.spaceAfter ?? 0) +
              '"/>',
          )
          .join("") +
        "</w:cols>",
    );
  }
  for (const kind of ["header", "footer"])
    for (const variant of ["default", "first", "even"]) {
      const id =
        style[
          (variant === "first"
            ? "firstPage"
            : variant === "even"
              ? "evenPage"
              : "default") + (kind === "header" ? "HeaderId" : "FooterId")
        ];
      if (id && context.headerParts.has(id)) {
        const target = context.headerParts.get(id)!.split("/").pop()!,
          rid = context.addRel(part, R + "/" + kind, target);
        parts.push(
          "<w:" +
            kind +
            'Reference w:type="' +
            variant +
            '" r:id="' +
            rid +
            '"/>',
        );
      }
    }
  if (style.useFirstPageHeaderFooter) parts.push("<w:titlePg/>");
  return "<w:sectPr>" + parts.join("") + "</w:sectPr>";
}
