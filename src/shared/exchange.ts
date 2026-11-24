import type { Kind, Snapshot } from "./documents/model";

export type ExchangeFormat =
  "xlsx" | "csv" | "tsv" | "docx" | "html" | "md" | "txt" | "json" | "pdf";

export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  location?: string;
  preserved?: boolean;
}

export interface CodecOptions {
  sheet?: string;
  delimiter?: string;
  encoding?: string;
  allowLossy?: boolean;
  formulaPolicy?: "calculate" | "preserve";
  title?: string;
}

export interface ImportResult {
  snapshot: Snapshot;
  diagnostics: Diagnostic[];
  unsupported?: string[];
  extras?: Record<string, any>;
}

export interface ExportResult {
  data: Uint8Array;
  mime: string;
  diagnostics: Diagnostic[];
}

export const formats: Record<
  Kind,
  { import: ExchangeFormat[]; export: ExchangeFormat[] }
> = {
  sheet: {
    import: ["xlsx", "csv", "tsv", "json"],
    export: ["xlsx", "csv", "tsv", "json", "pdf"],
  },
  doc: {
    import: ["docx", "html", "md", "txt", "json"],
    export: ["docx", "html", "md", "txt", "json", "pdf"],
  },
};

export const mimeTypes: Record<ExchangeFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
};
