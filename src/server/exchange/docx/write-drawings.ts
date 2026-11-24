import { createHash } from "node:crypto";
import { esc } from "../package";
import { R } from "./namespaces";
import type { WriteContext } from "./write-context";

export function imageXml(
  context: Pick<
    WriteContext,
    | "noteIds"
    | "snapshot"
    | "diagnostics"
    | "parts"
    | "newContentTypes"
    | "addRel"
    | "serial"
  >,
  id: string,
  body: any,
  part: string,
) {
  const block = body.customBlocks?.find((b: any) => b.blockId === id);
  if (block?.noteType) {
    const noteId = context.noteIds.get(block.noteId);
    if (noteId !== undefined)
      return (
        "<w:r><w:" + block.noteType + 'Reference w:id="' + noteId + '"/></w:r>'
      );
  }
  const image = context.snapshot.drawings?.[id];
  if (!image) return "";
  if (image.pioneerMath?.omml) return image.pioneerMath.omml;
  const source = image.source,
    match = /^data:image\/(png|jpeg|jpg|gif|svg\+xml|webp);base64,(.*)$/s.exec(
      source ?? "",
    );
  if (!match) {
    context.diagnostics.push({
      severity: "error",
      code: "UNRESOLVED_DOCX_IMAGE",
      message: "Image bytes must be materialized",
      location: id,
    });
    return "";
  }
  const ext =
      match[1] === "jpeg" ? "jpg" : match[1] === "svg+xml" ? "svg" : match[1],
    data = Buffer.from(match[2], "base64"),
    name =
      "pioneer-" +
      createHash("sha256").update(data).digest("hex").slice(0, 24) +
      "." +
      ext,
    media = "word/media/" + name;
  context.parts[media] = data;
  context.newContentTypes.set(
    "/" + media,
    match[1] === "svg+xml" ? "image/svg+xml" : "image/" + match[1],
  );
  const rid = context.addRel(part, R + "/image", "media/" + name),
    size = image.docTransform?.size ??
      image.transform ?? { width: 100, height: 100 },
    cx = Math.round(size.width * 9525),
    cy = Math.round(size.height * 9525),
    rotation = Math.round((image.docTransform?.angle ?? 0) * 60000);
  const graphic =
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' +
    ++context.serial +
    '" name="' +
    esc(image.title ?? name) +
    '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' +
    rid +
    '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm' +
    (rotation ? ' rot="' + rotation + '"' : "") +
    '><a:off x="0" y="0"/><a:ext cx="' +
    cx +
    '" cy="' +
    cy +
    '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
  const extent =
    '<wp:extent cx="' +
    cx +
    '" cy="' +
    cy +
    '"/><wp:docPr id="' +
    ++context.serial +
    '" name="' +
    esc(image.title ?? name) +
    '" descr="' +
    esc(image.description ?? "") +
    '"/>';
  if (image.layoutType && image.layoutType !== 0) {
    const pos = image.docTransform ?? {},
      x = Math.round((pos.positionH?.posOffset ?? 0) * 9525),
      y = Math.round((pos.positionV?.posOffset ?? 0) * 9525),
      wrap =
        image.layoutType === 6
          ? "<wp:wrapTopAndBottom/>"
          : image.layoutType === 3
            ? '<wp:wrapSquare wrapText="bothSides"/>'
            : "<wp:wrapNone/>";
    return (
      '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="' +
      (image.behindDoc ? 1 : 0) +
      '" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' +
      x +
      '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>' +
      y +
      "</wp:posOffset></wp:positionV>" +
      extent +
      wrap +
      graphic +
      "</wp:anchor></w:drawing></w:r>"
    );
  }
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    extent +
    graphic +
    "</wp:inline></w:drawing></w:r>"
  );
}
