import { randomUUID } from "node:crypto";
import type { XmlNode } from "../package";
import { child, children, attr, relationships } from "../package";
import { value, flag, px } from "./values";
import type { ReadContext } from "./read-context";

export function section(
  context: Pick<
    ReadContext,
    "snapshot" | "parts" | "headerIds" | "extras" | "tree" | "parseStory"
  >,
  node: XmlNode | undefined,
  path: string,
) {
  const size = child(node, "pgSz"),
    margin = child(node, "pgMar"),
    config: any = { sectionId: randomUUID() };
  if (size)
    config.pageSize = {
      width: px(attr(size, "w") ?? 11906),
      height: px(attr(size, "h") ?? 16838),
    };
  for (const side of ["top", "bottom", "left", "right", "header", "footer"])
    if (attr(margin, side) !== undefined)
      config["margin" + side[0].toUpperCase() + side.slice(1)] = px(
        attr(margin, side),
      );
  const type = value(node, "type");
  if (type)
    config.sectionType =
      (
        {
          continuous: 1,
          nextColumn: 2,
          nextPage: 3,
          evenPage: 4,
          oddPage: 5,
        } as any
      )[type] ?? 3;
  const cols = child(node, "cols");
  if (cols) {
    const count = +(attr(cols, "num") ?? 1),
      gap = px(attr(cols, "space") ?? 720),
      width =
        (config.pageSize?.width ??
          context.snapshot.documentStyle.pageSize.width) -
        (config.marginLeft ?? context.snapshot.documentStyle.marginLeft) -
        (config.marginRight ?? context.snapshot.documentStyle.marginRight);
    config.columnProperties = children(cols, "col").length
      ? children(cols, "col").map((c) => ({
          width: px(attr(c, "w")),
          spaceAfter: px(attr(c, "space")),
        }))
      : Array.from({ length: Math.min(12, count) }, (_, i) => ({
          width: (width - gap * (count - 1)) / count,
          spaceAfter: i === count - 1 ? 0 : gap,
        }));
    config.columnSeparatorType = attr(cols, "sep") === "1" ? 2 : 1;
  }
  for (const kind of ["header", "footer"])
    for (const ref of children(node, kind + "Reference")) {
      const rel = relationships(context.parts, path).get(attr(ref, "id") ?? "");
      if (!rel || rel.external || !context.parts[rel.target]) continue;
      let id = context.headerIds.get(rel.target);
      if (!id) {
        id = randomUUID();
        context.headerIds.set(rel.target, id);
        context.extras.storyParts[id] = rel.target;
        const root = child(
            context.tree(rel.target),
            kind === "header" ? "hdr" : "ftr",
          ),
          data = context.parseStory(root!, rel.target, id);
        context.snapshot[kind === "header" ? "headers" : "footers"][id] = {
          [kind + "Id"]: id,
          body: data,
        };
      }
      const variant = attr(ref, "type") ?? "default";
      config[
        (variant === "first"
          ? "firstPage"
          : variant === "even"
            ? "evenPage"
            : "default") + (kind === "header" ? "HeaderId" : "FooterId")
      ] = id;
    }
  if (flag(node, "titlePg")) config.useFirstPageHeaderFooter = 1;
  return config;
}
