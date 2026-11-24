import { randomUUID } from "node:crypto";
import type { XmlNode } from "../package";
import { child, descendants, attr, text, relationships } from "../package";
import { value } from "./values";
import { runStyle } from "./read-styles";
import type { StoryContext } from "./story-context";

export function inline(
  story: Pick<
    StoryContext,
    | "context"
    | "inline"
    | "append"
    | "body"
    | "path"
    | "segment"
    | "bookmarks"
    | "fields"
  >,
  node: XmlNode,
  baseStyle: any,
  paragraphId: string,
) {
  const name = node.name.split(":").pop()!;
  if (name === "r") {
    const rPr = child(node, "rPr"),
      rStyle = story.context.resolved(value(rPr, "rStyle"));
    const style = { ...baseStyle, ...rStyle.text, ...runStyle(rPr) };
    for (const c of node.children)
      if (c.name !== "#text" && c !== rPr) story.inline(c, style, paragraphId);
    return;
  }
  if (name === "t") {
    story.append(text(node), baseStyle);
    return;
  }
  if (name === "tab") {
    story.append("\t", baseStyle);
    return;
  }
  if (name === "br" || name === "cr") {
    story.append(
      attr(node, "type") === "page"
        ? "\f"
        : attr(node, "type") === "column"
          ? "\v"
          : "\n",
      baseStyle,
    );
    return;
  }
  if (name === "drawing" || name === "pict") {
    if (name === "pict") {
      story.context.warn(
        "DOCX_VML",
        "Legacy VML object is retained in source",
        paragraphId,
      );
      story.append("\uFFFC", baseStyle);
    } else {
      if (!descendants(node, "blip").length)
        story.context.warn(
          "DOCX_OPAQUE_DRAWING",
          "Drawing cannot be edited natively; original paragraph is retained",
          paragraphId,
        );
      story.context.image(node, story.body, story.path, story.segment);
    }
    return;
  }
  if (name === "oMath" || name === "oMathPara") {
    story.context.equation(node, story.body);
    return;
  }
  if (name === "hyperlink") {
    const start = story.body.dataStream.length,
      rel = relationships(story.context.parts, story.path).get(
        attr(node, "id") ?? "",
      ),
      url = attr(node, "anchor") ? "#" + attr(node, "anchor") : rel?.target;
    for (const c of node.children) story.inline(c, baseStyle, paragraphId);
    if (
      url &&
      /^(https?:|mailto:|tel:|#)/i.test(url) &&
      story.body.dataStream.length > start
    )
      story.body.customRanges.push({
        startIndex: start,
        endIndex: story.body.dataStream.length - 1,
        rangeId: randomUUID(),
        rangeType: 0,
        properties: { url },
      });
    else if (url)
      story.context.warn(
        "DOCX_UNSAFE_HYPERLINK",
        "Unsupported hyperlink scheme was omitted",
        paragraphId,
      );
    return;
  }
  if (name === "bookmarkStart") {
    story.bookmarks.set(attr(node, "id") ?? "", {
      start: story.body.dataStream.length,
      name: attr(node, "name") ?? "",
    });
    return;
  }
  if (name === "bookmarkEnd") {
    const b = story.bookmarks.get(attr(node, "id") ?? "");
    if (b)
      story.body.customRanges.push({
        startIndex: b.start,
        endIndex: Math.max(b.start, story.body.dataStream.length - 1),
        rangeId: randomUUID(),
        rangeType: 3,
        properties: { name: b.name },
      });
    return;
  }
  if (name === "fldSimple") {
    const start = story.body.dataStream.length;
    for (const c of node.children) story.inline(c, baseStyle, paragraphId);
    if (story.body.dataStream.length === start)
      story.append("\u200b", baseStyle);
    story.body.customRanges.push({
      startIndex: start,
      endIndex: story.body.dataStream.length - 1,
      rangeId: randomUUID(),
      rangeType: 1,
      properties: { docxInstruction: attr(node, "instr") ?? "" },
    });
    return;
  }
  if (name === "fldChar") {
    const type = attr(node, "fldCharType");
    if (type === "begin")
      story.fields.push({
        code: "",
        start: story.body.dataStream.length,
        show: false,
      });
    else if (type === "separate") {
      const f = story.fields.at(-1);
      if (f) {
        f.start = story.body.dataStream.length;
        f.show = true;
      }
    } else if (type === "end") {
      const f = story.fields.pop();
      if (f && story.body.dataStream.length > f.start)
        story.body.customRanges.push({
          startIndex: f.start,
          endIndex: story.body.dataStream.length - 1,
          rangeId: randomUUID(),
          rangeType: 1,
          properties: { docxInstruction: f.code },
        });
    }
    return;
  }
  if (name === "instrText") {
    if (story.fields.length) story.fields.at(-1)!.code += text(node);
    return;
  }
  if (name === "footnoteReference" || name === "endnoteReference") {
    const kind = name === "footnoteReference" ? "footnote" : "endnote",
      noteId = kind + ":" + attr(node, "id");
    story.context.noteRefs.add(noteId);
    const id = randomUUID();
    story.body.customBlocks.push({
      startIndex: story.body.dataStream.length,
      blockId: id,
      noteType: kind,
      noteId,
    });
    story.body.dataStream += "\b";
    return;
  }
  if (name === "footnoteRef" || name === "endnoteRef") return;
  if (name === "del" || name === "moveFrom") {
    story.context.warn(
      "DOCX_TRACK_CHANGES",
      "Tracked deletions are retained in the original package",
      paragraphId,
    );
    return;
  }
  if (name === "ins" || name === "moveTo")
    story.context.warn(
      "DOCX_TRACK_CHANGES",
      "Tracked changes are retained in the original package",
      paragraphId,
    );
  if (
    [
      "object",
      "altChunk",
      "sdt",
      "smartTag",
      "commentRangeStart",
      "commentRangeEnd",
      "commentReference",
    ].includes(name)
  )
    story.context.warn(
      "DOCX_OPAQUE_CONTENT",
      "Office-specific content remains in the source package",
      paragraphId,
    );
  if (!name.endsWith("Pr"))
    for (const c of node.children)
      if (c.name !== "#text") story.inline(c, baseStyle, paragraphId);
}
