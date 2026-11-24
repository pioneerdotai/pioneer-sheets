import { randomUUID } from "node:crypto";
import type { XmlNode } from "../package";
import {
  child,
  descendants,
  attr,
  text,
  serialize,
  relationships,
} from "../package";
import { mathMl } from "./math";
import type { ReadContext } from "./read-context";

export function image(
  context: Pick<ReadContext, "parts" | "warn" | "snapshot">,
  node: XmlNode,
  body: any,
  path: string,
  segment?: string,
) {
  const blip = descendants(node, "blip")[0],
    rid = attr(blip, "embed"),
    rel = relationships(context.parts, path).get(rid ?? "");
  if (!rel || rel.external || !context.parts[rel.target]) {
    context.warn(
      "DOCX_IMAGE_REFERENCE",
      "Image uses an unavailable or external source",
      path,
    );
    return;
  }
  const extent = descendants(node, "extent")[0],
    size = {
      width: +(attr(extent, "cx") ?? 952500) / 9525,
      height: +(attr(extent, "cy") ?? 952500) / 9525,
    },
    id = randomUUID(),
    data = context.parts[rel.target],
    ext = rel.target.split(".").pop()?.toLowerCase(),
    mime =
      ext === "jpg"
        ? "image/jpeg"
        : ext === "svg"
          ? "image/svg+xml"
          : "image/" + ext;
  const anchor = descendants(node, "anchor")[0],
    x =
      Number(text(child(descendants(node, "positionH")[0], "posOffset")) || 0) /
      9525,
    y =
      Number(text(child(descendants(node, "positionV")[0], "posOffset")) || 0) /
      9525;
  context.snapshot.drawings[id] = {
    drawingId: id,
    unitId: context.snapshot.id,
    subUnitId: context.snapshot.id,
    drawingType: 0,
    imageSourceType: "BASE64",
    source: "data:" + mime + ";base64," + Buffer.from(data).toString("base64"),
    transform: { ...size, left: 0, top: 0 },
    docTransform: {
      size,
      positionH: { relativeFrom: 0, posOffset: x },
      positionV: { relativeFrom: 1, posOffset: y },
      angle: 0,
    },
    layoutType: anchor
      ? descendants(anchor, "wrapSquare").length
        ? 3
        : descendants(anchor, "wrapTopAndBottom").length
          ? 6
          : 1
      : 0,
    title: attr(descendants(node, "docPr")[0], "name") ?? "",
    description: attr(descendants(node, "docPr")[0], "descr") ?? "",
    ...(anchor ? { pioneerOfficeAnchor: true } : {}),
  };
  context.snapshot.drawingsOrder.push(id);
  if (segment) {
    context.snapshot.headerFooterDrawingsOrder ??= [];
    context.snapshot.headerFooterDrawingsOrder.push(id);
  }
  body.customBlocks.push({ startIndex: body.dataStream.length, blockId: id });
  body.dataStream += "\b";
}

export function equation(
  context: Pick<ReadContext, "snapshot">,
  node: XmlNode,
  body: any,
) {
  const id = randomUUID(),
    mathML =
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="' +
      (node.name.endsWith("oMathPara") ? "block" : "inline") +
      '">' +
      mathMl(node) +
      "</math>";
  context.snapshot.drawings[id] = {
    drawingId: id,
    unitId: context.snapshot.id,
    subUnitId: context.snapshot.id,
    drawingType: 0,
    imageSourceType: "BASE64",
    source: "pioneer-math:" + id,
    transform: { width: 100, height: 30, left: 0, top: 0 },
    docTransform: {
      size: { width: 100, height: 30 },
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 1, posOffset: 0 },
      angle: 0,
    },
    layoutType: 0,
    pioneerMath: { mathML, omml: serialize(node) },
  };
  context.snapshot.drawingsOrder.push(id);
  body.customBlocks.push({ startIndex: body.dataStream.length, blockId: id });
  body.dataStream += "\b";
}
