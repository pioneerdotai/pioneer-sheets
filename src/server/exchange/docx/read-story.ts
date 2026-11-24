import * as read_inline from "./read-inline";
import * as read_table from "./read-table";
import type { StoryContext } from "./story-context";
import { randomUUID } from "node:crypto";
import type { XmlNode } from "../package";
import { child, descendants, attr } from "../package";
import { value } from "./values";
import { paragraphStyle } from "./read-styles";
import type { ReadContext } from "./read-context";

export function parseStory(
  context: ReadContext,
  root: XmlNode,
  path: string,
  segment?: string,
) {
  const body: any = {
    dataStream: "",
    paragraphs: [],
    textRuns: [],
    sectionBreaks: [],
    tables: [],
    customBlocks: [],
    customRanges: [],
  };
  if (!context.paragraphIndexes.has(path))
    context.paragraphIndexes.set(
      path,
      new Map(descendants(context.tree(path), "p").map((p, i) => [p, i])),
    );
  const bookmarks = new Map<string, { start: number; name: string }>(),
    fields: Array<{ code: string; start: number; show: boolean }> = [];
  const append = (content: string, style: any) => {
    const st = body.dataStream.length;
    body.dataStream += content;
    if (content && Object.keys(style).length)
      body.textRuns.push({ st, ed: body.dataStream.length, ts: style });
  };
  const story: StoryContext = {
    context,
    inline,
    append,
    body,
    path,
    segment,
    bookmarks,
    fields,
    paragraph,
    table,
  };
  function inline(node: XmlNode, baseStyle: any, paragraphId: string) {
    return read_inline.inline(story, node, baseStyle, paragraphId);
  }
  function paragraph(node: XmlNode) {
    const pPr = child(node, "pPr"),
      styleId = value(pPr, "pStyle"),
      effective = context.resolved(styleId),
      style = {
        ...context.pDefaults,
        ...effective.paragraph,
        ...paragraphStyle(pPr),
      },
      pId = randomUUID();
    const styleName =
        attr(context.styles.get(styleId ?? ""), "styleId") ?? styleId ?? "",
      heading = /^Heading([1-9])$/i.exec(styleName);
    if (heading) style.namedStyleType = 3 + Math.min(5, +heading[1]);
    else if (/^Title$/i.test(styleName)) style.namedStyleType = 2;
    const num =
        child(pPr, "numPr") ??
        child(child(context.styles.get(styleId ?? ""), "pPr"), "numPr"),
      numId = value(num, "numId"),
      list = numId ? context.numbering.get(numId) : undefined;
    for (const c of node.children)
      if (c !== pPr && c.name !== "#text")
        inline(c, { ...context.defaults, ...effective.text }, pId);
    const startIndex = body.dataStream.length;
    body.dataStream += "\r";
    body.paragraphs.push({
      startIndex,
      paragraphId: pId,
      paragraphStyle: style,
      ...(list
        ? { bullet: { ...list, nestingLevel: +(value(num, "ilvl") ?? 0) } }
        : {}),
    });
    context.extras.paragraphs[pId] = {
      part: path,
      index: context.paragraphIndexes.get(path)?.get(node),
      styleId,
      opaque: context.diagnostics.some((d) => d.location === pId),
    };
    const sect = child(pPr, "sectPr");
    if (sect) {
      const config = context.section(sect, path);
      if (!context.globalSection++) {
        Object.assign(context.snapshot.documentStyle, config);
        delete context.snapshot.documentStyle.sectionId;
      }
      body.sectionBreaks.push({
        ...config,
        startIndex: body.dataStream.length,
      });
      body.dataStream += "\n";
    }
  }
  function table(node: XmlNode) {
    return read_table.table(story, node);
  }
  for (const node of root.children) {
    const name = node.name.split(":").pop();
    if (name === "p") paragraph(node);
    else if (name === "tbl") table(node);
    else if (name === "sectPr") {
      const config = context.section(node, path);
      if (!context.globalSection++) {
        Object.assign(context.snapshot.documentStyle, config);
        delete context.snapshot.documentStyle.sectionId;
      }
      if (!body.dataStream.endsWith("\r")) {
        body.paragraphs.push({
          startIndex: body.dataStream.length,
          paragraphId: randomUUID(),
        });
        body.dataStream += "\r";
      }
      body.sectionBreaks.push({
        ...config,
        startIndex: body.dataStream.length,
      });
      body.dataStream += "\n";
    } else if (node.name !== "#text") {
      context.warn(
        "DOCX_BODY_CONTENT",
        "A body element needs an editable mapping",
        path,
      );
      for (const p of descendants(node, "p")) paragraph(p);
    }
  }
  if (!body.dataStream.endsWith("\r\n")) {
    if (!body.dataStream.endsWith("\r")) {
      body.paragraphs.push({
        startIndex: body.dataStream.length,
        paragraphId: randomUUID(),
      });
      body.dataStream += "\r";
    }
    body.sectionBreaks.push({
      sectionId: randomUUID(),
      startIndex: body.dataStream.length,
    });
    body.dataStream += "\n";
  }
  return body;
}
