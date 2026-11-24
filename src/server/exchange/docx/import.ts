import * as read_drawings from "./read-drawings";
import * as read_section from "./read-section";
import * as read_story from "./read-story";
import type { ReadContext } from "./read-context";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../../../shared/documents/model";
import type {
  CodecOptions,
  Diagnostic,
  ImportResult,
} from "../../../shared/exchange";
import type { XmlNode } from "../package";
import {
  readPackage,
  xmlPart,
  child,
  children,
  descendants,
  attr,
} from "../package";
import { value } from "./values";
import { runStyle, paragraphStyle } from "./read-styles";

export function importDocx(
  bytes: Uint8Array,
  options: CodecOptions = {},
): ImportResult {
  const parts = readPackage(bytes);
  const trees = new Map<string, XmlNode>();
  const tree = (path: string) => {
    let value = trees.get(path);
    if (!value) {
      value = xmlPart(parts, path);
      trees.set(path, value);
    }
    return value;
  };
  if (!parts["word/document.xml"]) throw new Error("NOT_A_DOCX_FILE");
  const diagnostics: Diagnostic[] = [],
    unsupported = new Set<string>(),
    snapshot: Snapshot = {
      id: randomUUID(),
      title: options.title ?? "Imported document",
      body: null,
      documentStyle: {
        documentFlavor: 1,
        pageSize: { width: 794, height: 1123 },
        marginTop: 96,
        marginBottom: 96,
        marginLeft: 96,
        marginRight: 96,
        textStyle: { ff: "Arial", fs: 11 },
      },
      tableSource: {},
      drawings: {},
      drawingsOrder: [],
      headers: {},
      footers: {},
      lists: {},
      notes: {},
    },
    extras: any = {
      paragraphs: {},
      namespaces: {},
      settings: {},
      storyParts: {},
    };
  const styles = new Map<string, XmlNode>(),
    numbering = new Map<string, any>();
  let defaults: any = { ff: "Arial", fs: 11 },
    pDefaults: any = {};
  if (parts["word/styles.xml"]) {
    const root = child(tree("word/styles.xml"), "styles");
    const docDefaults = child(root, "docDefaults");
    defaults = {
      ...defaults,
      ...runStyle(child(child(docDefaults, "rPrDefault"), "rPr")),
    };
    pDefaults = paragraphStyle(child(child(docDefaults, "pPrDefault"), "pPr"));
    for (const s of children(root, "style")) styles.set(attr(s, "styleId")!, s);
  }
  snapshot.documentStyle.textStyle = defaults;
  const resolved = (
    id: string | undefined,
    seen = new Set<string>(),
  ): { text: any; paragraph: any } => {
    if (!id || seen.has(id) || !styles.has(id))
      return { text: {}, paragraph: {} };
    seen.add(id);
    const node = styles.get(id)!,
      parent = resolved(value(node, "basedOn"), seen);
    return {
      text: { ...parent.text, ...runStyle(child(node, "rPr")) },
      paragraph: { ...parent.paragraph, ...paragraphStyle(child(node, "pPr")) },
    };
  };
  if (parts["word/numbering.xml"]) {
    const root = child(tree("word/numbering.xml"), "numbering"),
      abstract = new Map(
        children(root, "abstractNum").map((n) => [attr(n, "abstractNumId"), n]),
      );
    for (const n of children(root, "num")) {
      const numId = attr(n, "numId")!,
        base = abstract.get(value(n, "abstractNumId")),
        levels = children(base, "lvl");
      const listType = levels.some((l) => value(l, "numFmt") === "bullet")
          ? "BULLET_LIST"
          : "ORDER_LIST",
        listId = "docx-list-" + numId;
      const list = {
        listType,
        nestingLevel: Array.from({ length: 9 }, (_, i) => {
          const level = levels.find((l) => Number(attr(l, "ilvl")) === i),
            format = value(level, "numFmt") ?? "decimal",
            glyph = value(level, "lvlText") ?? "%" + (i + 1) + ".";
          return {
            bulletAlignment: 0,
            glyphFormat: glyph.replace(/%(\d+)/g, (_, v) => "%" + (+v - 1)),
            glyphType:
              (
                {
                  bullet: 0,
                  decimal: 2,
                  decimalZero: 3,
                  upperLetter: 4,
                  lowerLetter: 5,
                  upperRoman: 6,
                  lowerRoman: 7,
                } as any
              )[format] ?? 2,
            ...(format === "bullet" ? { glyphSymbol: glyph } : {}),
            startNumber: +(value(level, "start") ?? 1),
            textStyle: runStyle(child(level, "rPr")),
            paragraphProperties: paragraphStyle(child(level, "pPr")),
          };
        }),
      };
      snapshot.lists[listId] = list;
      numbering.set(numId, { listId, listType });
    }
  }
  const noteRefs = new Set<string>(),
    headerIds = new Map<string, string>(),
    paragraphIndexes = new Map<string, Map<XmlNode, number>>();
  const warn = (code: string, message: string, location?: string) => {
    if (!diagnostics.some((d) => d.code === code && d.location === location))
      diagnostics.push({
        severity: "warning",
        code,
        message,
        location,
        preserved: true,
      });
    unsupported.add(code);
  };

  const context: ReadContext = {
    parts,
    warn,
    snapshot,
    headerIds,
    extras,
    tree,
    parseStory,
    paragraphIndexes,
    resolved,
    image,
    equation,
    noteRefs,
    pDefaults,
    styles,
    numbering,
    defaults,
    diagnostics,
    section,
    globalSection: 0,
  };
  function image(node: XmlNode, body: any, path: string, segment?: string) {
    return read_drawings.image(context, node, body, path, segment);
  }
  function equation(node: XmlNode, body: any) {
    return read_drawings.equation(context, node, body);
  }
  function section(node: XmlNode | undefined, path: string) {
    return read_section.section(context, node, path);
  }
  function parseStory(root: XmlNode, path: string, segment?: string) {
    return read_story.parseStory(context, root, path, segment);
  }
  const document = child(tree("word/document.xml"), "document")!;
  extras.namespaces = document.attrs;
  snapshot.body = parseStory(child(document, "body")!, "word/document.xml");
  for (const kind of ["footnote", "endnote"]) {
    const path = "word/" + kind + "s.xml";
    if (!parts[path]) continue;
    for (const note of descendants(tree(path), kind)) {
      const id = attr(note, "id") ?? "";
      if (id.startsWith("-") || attr(note, "type")) continue;
      const noteId = kind + ":" + id;
      snapshot.notes[noteId] = {
        noteId,
        type: kind,
        body: parseStory(note, path),
      };
    }
  }
  if (parts["word/settings.xml"]) {
    const settings = tree("word/settings.xml");
    if (descendants(settings, "evenAndOddHeaders").length)
      snapshot.documentStyle.evenAndOddHeaders = 1;
  }
  for (const path of Object.keys(parts))
    if (/word\/(charts|embeddings|activeX|vbaProject)/.test(path))
      warn(
        "DOCX_EMBEDDED_CONTENT",
        "Embedded/chart/active Office content remains in the source package",
        path,
      );
  diagnostics.push({
    severity: "info",
    code: "DOCX_SOURCE_RETAINED",
    message:
      "Original package is retained. Unchanged paragraphs can be exported using original XML.",
  });
  return {
    snapshot,
    diagnostics,
    unsupported: [...unsupported],
    extras,
  };
}
