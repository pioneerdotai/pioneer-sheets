import * as write_relationships from "./write-relationships";
import * as write_section from "./write-section";
import * as write_drawings from "./write-drawings";
import * as write_body from "./write-body";
import type { WriteContext } from "./write-context";
import type { Snapshot } from "../../../shared/documents/model";
import type {
  CodecOptions,
  Diagnostic,
  ExportResult,
} from "../../../shared/exchange";
import type { XmlNode } from "../package";
import type { Package } from "../package";
import {
  readPackage,
  writePackage,
  xmlPart,
  xml,
  child,
  children,
  descendants,
  attr,
  esc,
  serialize,
  putXml,
  exchangeMetadata,
} from "../package";
import { R, NS } from "./namespaces";
import { runProperties } from "./write-styles";

export function exportDocx(
  snapshot: Snapshot,
  options: CodecOptions = {},
  original?: Uint8Array,
): ExportResult {
  const originalParts = original ? readPackage(original) : {},
    parts: Package = { ...originalParts },
    diagnostics: Diagnostic[] = [],
    meta = exchangeMetadata(snapshot),
    originalParagraphs = meta?.extras?.paragraphs ?? {};
  const relationshipsByPart = new Map<
      string,
      Array<{ Id: string; Type: string; Target: string; TargetMode?: string }>
    >(),
    newContentTypes = new Map<string, string>(),
    numberIds = new Map<string, number>();
  let serial = 100000;
  if (originalParts["word/numbering.xml"])
    for (const node of [
      ...descendants(xmlPart(originalParts, "word/numbering.xml"), "num"),
      ...descendants(
        xmlPart(originalParts, "word/numbering.xml"),
        "abstractNum",
      ),
    ])
      serial = Math.max(
        serial,
        Number(attr(node, "numId") ?? attr(node, "abstractNumId") ?? 0) + 100,
      );

  function addRel(
    part: string,
    type: string,
    target: string,
    external = false,
  ) {
    return write_relationships.addRel(context, part, type, target, external);
  }
  function writeRelationships(part: string) {
    return write_relationships.writeRelationships(context, part);
  }
  function sectionXml(config: any, part: string) {
    return write_section.sectionXml(context, config, part);
  }
  const headerParts = new Map<string, string>();
  for (const kind of ["header", "footer"])
    for (const id of Object.keys(
      snapshot[kind === "header" ? "headers" : "footers"] ?? {},
    ))
      headerParts.set(
        id,
        meta?.extras?.storyParts?.[id] ??
          "word/" + kind + "Pioneer" + ++serial + ".xml",
      );
  function imageXml(id: string, body: any, part: string) {
    return write_drawings.imageXml(context, id, body, part);
  }
  const originalTrees = new Map<string, XmlNode[]>();
  function rawParagraph(info: any) {
    return write_body.rawParagraph(context, info);
  }
  const noteIds = new Map<string, number>();
  let nextNoteId = 1;
  for (const id of Object.keys(snapshot.notes ?? {})) {
    const original = /^(?:footnote|endnote):(\d+)$/.exec(id);
    const n = original ? Number(original[1]) : nextNoteId++;
    noteIds.set(id, n);
    nextNoteId = Math.max(nextNoteId, n + 1);
  }
  function bodyXml(body: any, part: string, main = false) {
    return write_body.bodyXml(context, body, part, main);
  }
  const context: WriteContext = {
    relationshipsByPart,
    originalParts,
    serial,
    parts,
    snapshot,
    headerParts,
    addRel,
    noteIds,
    diagnostics,
    newContentTypes,
    originalTrees,
    originalParagraphs,
    rawParagraph,
    sectionXml,
    options,
    numberIds,
    imageXml,
  };
  let numbering = "";
  for (const [listId, list] of Object.entries(snapshot.lists ?? {}) as any) {
    const id = ++context.serial;
    numberIds.set(listId, id);
    numbering +=
      '<w:abstractNum w:abstractNumId="' +
      id +
      '">' +
      (list.nestingLevel ?? [])
        .map(
          (level: any, i: number) =>
            '<w:lvl w:ilvl="' +
            i +
            '"><w:start w:val="' +
            (level.startNumber ?? 1) +
            '"/><w:numFmt w:val="' +
            (
              {
                0: "bullet",
                1: "none",
                2: "decimal",
                3: "decimalZero",
                4: "upperLetter",
                5: "lowerLetter",
                6: "upperRoman",
                7: "lowerRoman",
              } as any
            )[level.glyphType ?? 2] +
            '"/><w:lvlText w:val="' +
            esc(
              level.glyphSymbol ??
                level.glyphFormat?.replace(
                  /%(\d+)/g,
                  (_: any, n: string) => "%" + (+n + 1),
                ) ??
                "%" + (i + 1) + ".",
            ) +
            '"/>' +
            runProperties(level.textStyle ?? {}) +
            "</w:lvl>",
        )
        .join("") +
      '</w:abstractNum><w:num w:numId="' +
      id +
      '"><w:abstractNumId w:val="' +
      id +
      '"/></w:num>';
  }
  if (numbering) {
    const old = parts["word/numbering.xml"]
      ? serialize(xmlPart(parts, "word/numbering.xml"))
      : null;
    putXml(
      parts,
      "word/numbering.xml",
      old
        ? old.replace(/<\/w:numbering>/, numbering + "</w:numbering>")
        : "<w:numbering" + NS + ">" + numbering + "</w:numbering>",
    );
    newContentTypes.set(
      "/word/numbering.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
    );
    addRel("word/document.xml", R + "/numbering", "numbering.xml");
  }
  for (const kind of ["header", "footer"])
    for (const [id, data] of Object.entries(
      snapshot[kind === "header" ? "headers" : "footers"] ?? {},
    ) as any) {
      const path = headerParts.get(id)!;
      putXml(
        parts,
        path,
        "<w:" +
          (kind === "header" ? "hdr" : "ftr") +
          NS +
          ">" +
          bodyXml(data.body, path) +
          "</w:" +
          (kind === "header" ? "hdr" : "ftr") +
          ">",
      );
      newContentTypes.set(
        "/" + path,
        "application/vnd.openxmlformats-officedocument.wordprocessingml." +
          kind +
          "+xml",
      );
    }
  for (const kind of ["footnote", "endnote"]) {
    const list = Object.values(snapshot.notes ?? {}).filter(
      (n: any) => n.type === kind,
    ) as any[];
    if (list.length) {
      const path = "word/" + kind + "s.xml";
      putXml(
        parts,
        path,
        "<w:" +
          kind +
          "s" +
          NS +
          "><w:" +
          kind +
          ' w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:' +
          kind +
          "><w:" +
          kind +
          ' w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:' +
          kind +
          ">" +
          list
            .map(
              (note) =>
                "<w:" +
                kind +
                ' w:id="' +
                noteIds.get(note.noteId) +
                '">' +
                bodyXml(note.body, path) +
                "</w:" +
                kind +
                ">",
            )
            .join("") +
          "</w:" +
          kind +
          "s>",
      );
      newContentTypes.set(
        "/" + path,
        "application/vnd.openxmlformats-officedocument.wordprocessingml." +
          kind +
          "s+xml",
      );
      addRel("word/document.xml", R + "/" + kind + "s", kind + "s.xml");
    }
  }
  const extrasNs = Object.entries(meta?.extras?.namespaces ?? {})
    .filter(
      ([key]) => key.startsWith("xmlns:") && !NS.includes(" " + key + "="),
    )
    .map(([key, value]) => " " + key + '="' + esc(value) + '"')
    .join("");
  putXml(
    parts,
    "word/document.xml",
    "<w:document" +
      NS +
      extrasNs +
      "><w:body>" +
      bodyXml(snapshot.body, "word/document.xml", true) +
      "</w:body></w:document>",
  );
  newContentTypes.set(
    "/word/document.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  );
  if (!parts["word/styles.xml"])
    putXml(
      parts,
      "word/styles.xml",
      "<w:styles" +
        NS +
        "><w:docDefaults><w:rPrDefault>" +
        runProperties(
          snapshot.documentStyle?.textStyle ?? { ff: "Arial", fs: 11 },
        ) +
        "</w:rPrDefault></w:docDefaults>" +
        Array.from(
          { length: 5 },
          (_, i) =>
            '<w:style w:type="paragraph" w:styleId="Heading' +
            (i + 1) +
            '"><w:name w:val="heading ' +
            (i + 1) +
            '"/><w:pPr><w:outlineLvl w:val="' +
            i +
            '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' +
            (36 - i * 2) +
            '"/></w:rPr></w:style>',
        ).join("") +
        "</w:styles>",
    );
  if (originalParts["word/styles.xml"]) {
    const root = xmlPart(parts, "word/styles.xml"),
      styles = child(root, "styles")!,
      known = new Set(children(styles, "style").map((s) => attr(s, "styleId")));
    for (let i = 1; i <= 5; i++)
      if (!known.has("Heading" + i))
        styles.children.push(
          child(
            xml(
              '<w:style w:type="paragraph" w:styleId="Heading' +
                i +
                '"><w:name w:val="heading ' +
                i +
                '"/><w:pPr><w:outlineLvl w:val="' +
                (i - 1) +
                '"/></w:pPr></w:style>',
            ),
            "style",
          )!,
        );
    putXml(parts, "word/styles.xml", serialize(root));
  }
  newContentTypes.set(
    "/word/styles.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  );
  addRel("word/document.xml", R + "/styles", "styles.xml");
  if (!parts["word/settings.xml"])
    putXml(
      parts,
      "word/settings.xml",
      "<w:settings" +
        NS +
        '><w:updateFields w:val="true"/>' +
        (snapshot.documentStyle.evenAndOddHeaders
          ? "<w:evenAndOddHeaders/>"
          : "") +
        "</w:settings>",
    );
  newContentTypes.set(
    "/word/settings.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  );
  addRel("word/document.xml", R + "/settings", "settings.xml");
  putXml(
    parts,
    "docProps/core.xml",
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' +
      esc(snapshot.title) +
      "</dc:title><dc:creator>Pioneer</dc:creator></cp:coreProperties>",
  );
  newContentTypes.set(
    "/docProps/core.xml",
    "application/vnd.openxmlformats-package.core-properties+xml",
  );
  addRel("_root", R + "/officeDocument", "word/document.xml");
  addRel(
    "_root",
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    "docProps/core.xml",
  );
  for (const part of relationshipsByPart.keys())
    if (part !== "_root") writeRelationships(part);
  const rootRels = relationshipsByPart.get("_root")!;
  putXml(
    parts,
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rootRels
        .map(
          (r) =>
            '<Relationship Id="' +
            r.Id +
            '" Type="' +
            r.Type +
            '" Target="' +
            r.Target +
            '"/>',
        )
        .join("") +
      "</Relationships>",
  );
  const oldTypes = parts["[Content_Types].xml"]
      ? child(xmlPart(parts, "[Content_Types].xml"), "Types")
      : undefined,
    defaults = new Map<string, string>([
      ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
      ["xml", "application/xml"],
    ]),
    overrides = new Map<string, string>();
  for (const node of children(oldTypes, "Default"))
    defaults.set(attr(node, "Extension")!, attr(node, "ContentType")!);
  for (const node of children(oldTypes, "Override"))
    overrides.set(attr(node, "PartName")!, attr(node, "ContentType")!);
  for (const [key, value] of newContentTypes) overrides.set(key, value);
  putXml(
    parts,
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      [...defaults]
        .map(
          ([ext, mime]) =>
            '<Default Extension="' +
            esc(ext) +
            '" ContentType="' +
            esc(mime) +
            '"/>',
        )
        .join("") +
      [...overrides]
        .map(
          ([path, mime]) =>
            '<Override PartName="' +
            esc(path) +
            '" ContentType="' +
            esc(mime) +
            '"/>',
        )
        .join("") +
      "</Types>",
  );
  if (diagnostics.some((d) => d.severity === "error"))
    throw new Error("DOCX_EXPORT_ERROR: " + JSON.stringify(diagnostics));
  return {
    data: writePackage(parts),
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    diagnostics,
  };
}
