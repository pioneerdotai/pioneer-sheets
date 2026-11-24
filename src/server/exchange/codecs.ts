import { marked } from "marked";
import type { Kind, Snapshot } from "../../shared/documents/model";
import {
  validateSnapshot,
  createModel,
  snapshot as modelSnapshot,
} from "../../shared/documents/model";
import { importXlsx, exportXlsx } from "./xlsx";
import { importDocx, exportDocx, recordParagraphFingerprints } from "./docx";
import { decodeText, importDelimited, exportDelimited } from "./delimited";
import { docHtml, docMarkdown, sheetHtml } from "./html";
import { plainDoc } from "./doc-model";
import { HeadlessDocument } from "../agent/headless";
import { exchangeMetadata } from "./package";
import {
  mimeTypes,
  formats,
  type ExchangeFormat,
  type CodecOptions,
  type ImportResult,
  type ExportResult,
  type Diagnostic,
} from "../../shared/exchange";
import { randomUUID } from "node:crypto";

export async function importOffice(
  kind: Kind,
  format: ExchangeFormat,
  bytes: Uint8Array,
  options: CodecOptions = {},
): Promise<ImportResult & { html?: string; bundleFiles?: any[] }> {
  if (!formats[kind].import.includes(format))
    throw new Error("IMPORT_FORMAT_NOT_SUPPORTED");
  if (format === "xlsx") return importXlsx(bytes, options);
  if (format === "docx") return importDocx(bytes, options);
  if (format === "csv" || format === "tsv")
    return {
      snapshot: importDelimited(
        decodeText(bytes, options.encoding),
        format === "tsv" ? "\t" : (options.delimiter ?? ","),
        options.title,
      ),
      diagnostics: [
        {
          severity: "info",
          code: "DELIMITED_TEXT_VALUES",
          message:
            "Delimited imports preserve text literally; they never execute leading =,+,-,@ as formulas.",
        },
      ],
    };
  if (format === "json") {
    const parsed = JSON.parse(decodeText(bytes)),
      bundle = parsed?.pioneerOffice === 1,
      snapshot = bundle ? parsed.snapshot : parsed;
    if (bundle && parsed.kind !== kind) throw new Error("FILE_KIND_MISMATCH");
    validateSnapshot(snapshot, kind);
    return {
      snapshot,
      diagnostics: [],
      ...(bundle ? { bundleFiles: parsed.files ?? [] } : {}),
    };
  }
  if (format === "html" || format === "md")
    return {
      snapshot: {} as Snapshot,
      html:
        format === "md"
          ? await marked.parse(decodeText(bytes))
          : decodeText(bytes),
      diagnostics: [],
    };
  const text = decodeText(bytes).replace(/\r\n|\n/g, "\r"),
    stream = text.replace(/\r?$/, "\r") + "\n",
    paragraphs = [];
  for (let i = 0; i < stream.length; i++)
    if (stream[i] === "\r")
      paragraphs.push({ startIndex: i, paragraphId: randomUUID() });
  return {
    snapshot: {
      id: randomUUID(),
      title: options.title ?? "Imported text",
      body: { dataStream: stream, paragraphs, textRuns: [] },
      documentStyle: {
        documentFlavor: 1,
        pageSize: { width: 794, height: 1123 },
        marginTop: 56,
        marginBottom: 56,
        marginLeft: 56,
        marginRight: 56,
        textStyle: { ff: "Arial", fs: 11 },
      },
    },
    diagnostics: [],
  };
}

export async function exportOffice(
  kind: Kind,
  format: ExchangeFormat,
  snapshot: Snapshot,
  options: CodecOptions = {},
  original?: Uint8Array,
): Promise<ExportResult & { html?: string }> {
  if (!formats[kind].export.includes(format))
    throw new Error("EXPORT_FORMAT_NOT_SUPPORTED");
  validateSnapshot(snapshot, kind);
  const meta = exchangeMetadata(snapshot);
  const presentation: Diagnostic[] = meta?.unsupported?.length
    ? [
        {
          severity: "warning",
          code: "SOURCE_ONLY_PRESENTATION",
          message:
            "Source-only features are not rendered in this presentation format: " +
            meta.unsupported.join(", "),
          preserved: true,
        },
      ]
    : [];
  if (format === "xlsx") return exportXlsx(snapshot, options);
  if (format === "docx") return exportDocx(snapshot, options, original);
  if (format === "pdf") {
    if (kind === "doc")
      return {
        data: new Uint8Array(),
        mime: mimeTypes.pdf,
        html: docHtml(snapshot),
        diagnostics: presentation,
      };
    const native = new HeadlessDocument("sheet");
    try {
      await native.load(snapshot, options.formulaPolicy !== "preserve");
      const data = native.save();
      for (const id of data.sheetOrder) {
        const sheet = data.sheets[id],
          facade = native.unit.getSheetBySheetId(id);
        for (const [r, row] of Object.entries(sheet.cellData ?? {}))
          for (const [c, cell] of Object.entries(row as any))
            (cell as any).pioneerDisplay = facade
              .getRange(+r, +c)
              .getDisplayValue();
      }
      return {
        data: new Uint8Array(),
        mime: mimeTypes.pdf,
        html: sheetHtml(data, options.sheet),
        diagnostics: presentation,
      };
    } finally {
      native.close();
    }
  }
  if (format === "html")
    return {
      data: Buffer.from(docHtml(snapshot)),
      mime: mimeTypes.html,
      diagnostics: presentation,
    };
  if (format === "md")
    return {
      data: Buffer.from(docMarkdown(snapshot)),
      mime: mimeTypes.md,
      diagnostics: [
        {
          severity: "info",
          code: "MARKDOWN_PRESENTATION",
          message:
            "Markdown retains text structure, links, images and tables; page layout and typography remain available in DOCX/JSON.",
        },
      ],
    };
  if (format === "txt")
    return {
      data: Buffer.from(plainDoc(snapshot)),
      mime: mimeTypes.txt,
      diagnostics: [
        {
          severity: "info",
          code: "PLAIN_TEXT_EXPORT",
          message: "Plain text excludes formatting and binary objects.",
        },
      ],
    };
  if (format === "csv" || format === "tsv") {
    const runtime = new HeadlessDocument("sheet");
    try {
      await runtime.load(snapshot, options.formulaPolicy !== "preserve");
      return {
        data: Buffer.from(
          "\ufeff" +
            exportDelimited(
              runtime.save(),
              format === "tsv" ? "\t" : (options.delimiter ?? ","),
              options.sheet,
            ),
        ),
        mime: mimeTypes[format],
        diagnostics: [
          {
            severity: "info",
            code: "SINGLE_WORKSHEET",
            message:
              "Delimited export contains one worksheet, with calculated/cached values.",
          },
        ],
      };
    } finally {
      runtime.close();
    }
  }
  return {
    data: Buffer.from(JSON.stringify(snapshot, null, 2)),
    mime: mimeTypes.json,
    diagnostics: [],
  };
}

export async function normalizeImported(
  kind: Kind,
  snapshot: Snapshot,
  extras: any,
) {
  const native = new HeadlessDocument(kind);
  try {
    await native.load(snapshot, false);
    const model = createModel(native.save());
    let data: Snapshot;
    try {
      data = modelSnapshot(model);
    } finally {
      model.destroy();
    }
    if (kind === "doc" && extras) recordParagraphFingerprints(data, extras);
    return { snapshot: data, extras };
  } finally {
    native.close();
  }
}
