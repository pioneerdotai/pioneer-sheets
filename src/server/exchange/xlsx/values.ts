import { columnIndex } from "../../../shared/coordinates";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../../../shared/documents/model";
import type { Diagnostic } from "../../../shared/exchange";
import { fontIn } from "./styles";

export function rangeFromA1(address: string) {
  const match = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(address);
  if (!match) throw new Error("INVALID_XLSX_RANGE");
  return {
    startRow: +match[2] - 1,
    endRow: +(match[4] ?? match[2]) - 1,
    startColumn: columnIndex(match[1]),
    endColumn: columnIndex(match[3] ?? match[1]),
  };
}

export function dateSerial(value: Date, date1904 = false) {
  return value.getTime() / 86400000 + (date1904 ? 24107 : 25569);
}

export function nativeValue(value: any, date1904 = false): any {
  if (value instanceof Date) return dateSerial(value, date1904);
  if (value && typeof value === "object" && "error" in value)
    return value.error;
  return value;
}

export function richText(parts: any[], theme: string[]) {
  let dataStream = "";
  const textRuns = [];
  for (const p of parts) {
    const st = dataStream.length;
    dataStream += p.text ?? "";
    textRuns.push({ st, ed: dataStream.length, ts: fontIn(p.font, theme) });
  }
  return {
    id: randomUUID(),
    body: {
      dataStream: dataStream + "\r\n",
      paragraphs: [{ startIndex: dataStream.length }],
      textRuns,
    },
    documentStyle: {},
  };
}

export function resource(snapshot: Snapshot, name: string) {
  const r = (snapshot.resources ?? []).find((r: any) => r.name === name);
  try {
    return r ? JSON.parse(r.data) : null;
  } catch {
    return null;
  }
}

export function diagnose(parts: Record<string, Uint8Array>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const features = [
    [/^xl\/charts\//, "XLSX_CHARTS", "Charts"],
    [/^xl\/pivot(Table|Cache)/, "XLSX_PIVOTS", "Pivot tables"],
    [/^xl\/(slicer|timeline)/, "XLSX_SLICERS", "Slicers/timelines"],
    [
      /vbaProject|activeX|embeddings\//,
      "XLSX_EMBEDDED_ACTIVE_CONTENT",
      "Embedded/active objects",
    ],
    [/^xl\/externalLinks\//, "XLSX_EXTERNAL_LINKS", "External workbook links"],
  ];
  for (const [pattern, code, label] of features as any)
    if (Object.keys(parts).some((path) => pattern.test(path)))
      diagnostics.push({
        severity: "warning",
        code,
        message:
          label +
          " are retained in the original source. Unmodified source export is exact; edited export requires explicit lossy consent when this content cannot be represented.",
        preserved: true,
      });
  return diagnostics;
}

export function validationOut(rule: any) {
  const values = rule.getCriteriaValues(),
    kind = rule.getCriteriaType();
  return {
    type: kind === "listMultiple" ? "list" : kind,
    operator: values[0],
    formulae: [values[1], values[2]]
      .filter((v) => v !== undefined && v !== "")
      .map((v: any) =>
        kind === "list" || kind === "listMultiple"
          ? /^[=']|!/.test(v)
            ? String(v).replace(/^=/, "")
            : '"' + String(v).replace(/"/g, '""') + '"'
          : /^-?\d+(\.\d+)?$/.test(v)
            ? Number(v)
            : String(v).replace(/^=/, ""),
      ),
    allowBlank: rule.rule.allowBlank ?? true,
    showErrorMessage: rule.rule.showErrorMessage ?? !rule.getAllowInvalid(),
    error: rule.getHelpText(),
    errorTitle: rule.rule.errorTitle,
    prompt: rule.rule.prompt,
    promptTitle: rule.rule.promptTitle,
    showInputMessage: rule.rule.showInputMessage,
    errorStyle: rule.rule.errorStyle,
  };
}
