import { cellAddress } from "../../../shared/coordinates";
import { posix } from "node:path";
import { FConditionalFormattingBuilder } from "@univerjs/sheets-conditional-formatting/facade";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { ImageSourceType } from "@univerjs/core";
import { FDataValidationBuilder } from "@univerjs/sheets-data-validation/facade";
import { HeadlessDocument } from "../../agent/headless";
import type { Snapshot } from "../../../shared/documents/model";
import type { CodecOptions, ImportResult } from "../../../shared/exchange";
import {
  readPackage,
  xmlPart,
  descendants,
  attr,
  serialize,
  putXml,
  writePackage,
} from "../package";
import { defaultTheme, styleIn } from "./styles";
import {
  rangeFromA1,
  dateSerial,
  nativeValue,
  richText,
  diagnose,
} from "./values";

export async function importXlsx(
  bytes: Uint8Array,
  options: CodecOptions = {},
): Promise<ImportResult> {
  const parts = readPackage(bytes);
  if (!parts["xl/workbook.xml"]) throw new Error("NOT_AN_XLSX_FILE");
  const diagnostics = diagnose(parts);
  let theme = defaultTheme;
  if (parts["xl/theme/theme1.xml"]) {
    const scheme = descendants(
      xmlPart(parts, "xl/theme/theme1.xml"),
      "clrScheme",
    )[0];
    if (scheme) {
      const raw = scheme.children
        .filter((n) => n.name !== "#text")
        .map(
          (n) =>
            attr(
              n.children.find((c) => c.name !== "#text"),
              "val",
            ) ??
            attr(
              n.children.find((c) => c.name !== "#text"),
              "lastClr",
            ),
        );
      const order = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11];
      theme = order.map((index, i) => raw[index] ?? defaultTheme[i]);
    }
  }
  const compatible = { ...parts };
  for (const path of Object.keys(parts).filter((p) => p.endsWith(".rels"))) {
    const root = xmlPart(parts, path),
      base = path.replace("/_rels/", "/").replace(/\.rels$/, "");
    for (const node of descendants(root, "Relationship"))
      if (
        node.attrs.Target?.startsWith("/") &&
        node.attrs.TargetMode !== "External"
      )
        node.attrs.Target = posix.relative(
          posix.dirname(base),
          node.attrs.Target.slice(1),
        );
    putXml(compatible, path, serialize(root));
  }
  // Normalize legal OOXML namespace aliases for parsers that require fixed prefixes.
  for (const path of Object.keys(compatible).filter(
    (p) =>
      p.startsWith("xl/drawings/") &&
      p.endsWith(".xml") &&
      !p.slice(12).includes("/"),
  )) {
    const root = xmlPart(compatible, path),
      uris: Record<string, string> = {
        "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing":
          "xdr",
        "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships":
          "r",
      };
    const walk = (node: any, inherited: Record<string, string>) => {
      const scope = { ...inherited };
      for (const [k, v] of Object.entries(node.attrs))
        if (k === "xmlns") scope[""] = String(v);
        else if (k.startsWith("xmlns:")) scope[k.slice(6)] = String(v);
      const [prefix, local] = node.name.includes(":")
        ? node.name.split(":")
        : ["", node.name];
      if (
        node.name !== "#text" &&
        node.name !== "#document" &&
        uris[scope[prefix]]
      )
        node.name = uris[scope[prefix]] + ":" + local;
      for (const [k, v] of Object.entries(node.attrs))
        if (k.includes(":") && !k.startsWith("xmlns:")) {
          const [p, n] = k.split(":");
          if (uris[scope[p]]) {
            delete node.attrs[k];
            node.attrs[uris[scope[p]] + ":" + n] = v;
          }
        }
      for (const child of node.children) walk(child, scope);
    };
    walk(root, {});
    const document = root.children.find((n) => n.name !== "#text");
    if (document)
      for (const [uri, prefix] of Object.entries(uris))
        document.attrs["xmlns:" + prefix] = uri;
    putXml(compatible, path, serialize(root));
  }
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(writePackage(compatible)) as any);
  if (!book.worksheets.length) throw new Error("EMPTY_WORKBOOK");
  const snapshot: Snapshot = {
      id: randomUUID(),
      name: options.title ?? book.title ?? "Imported workbook",
      sheetOrder: [],
      sheets: {},
      styles: {},
    },
    extras: any = {
      workbook: {
        creator: book.creator,
        description: book.description,
        subject: book.subject,
        keywords: book.keywords,
        date1904: book.properties.date1904,
      },
      sheets: {},
    };
  let cellCount = 0;
  for (const sheet of book.worksheets) {
    const id = randomUUID(),
      cellData: any = {},
      rowData: any = {},
      columnData: any = {};
    snapshot.sheetOrder.push(id);
    if (sheet.rowCount > 100000 || sheet.columnCount > 16384)
      throw new Error("XLSX_DIMENSION_LIMIT");
    sheet.eachRow({ includeEmpty: false }, (row, r) => {
      if (row.height !== undefined || row.hidden)
        rowData[r - 1] = {
          ...(row.height !== undefined ? { h: (row.height * 96) / 72 } : {}),
          ...(row.hidden ? { hd: 1 } : {}),
        };
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (++cellCount > 500000) throw new Error("XLSX_CELL_LIMIT");
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const raw: any = cell.value;
        let data: any;
        if (
          raw &&
          typeof raw === "object" &&
          ("formula" in raw || "sharedFormula" in raw)
        ) {
          data = {
            f: "=" + cell.formula,
            v: nativeValue(cell.result, book.properties.date1904),
          };
          if (/\[[^\]]+\].*!/.test(cell.formula ?? ""))
            diagnostics.push({
              severity: "warning",
              code: "XLSX_EXTERNAL_FORMULA",
              message:
                "Formula uses an external workbook; cached result is retained",
              location: sheet.name + "!" + cell.address,
              preserved: true,
            });
        } else if (raw?.richText) data = { p: richText(raw.richText, theme) };
        else if (raw?.hyperlink) data = { v: raw.text ?? raw.hyperlink, t: 1 };
        else if (raw === null || raw === undefined) data = {};
        else {
          const value = nativeValue(raw, book.properties.date1904);
          data = {
            v: value,
            t:
              typeof value === "number"
                ? 2
                : typeof value === "boolean"
                  ? 3
                  : 1,
          };
        }
        const style = styleIn(cell.style, theme);
        if (Object.keys(style).length) data.s = style;
        cellData[r - 1] ??= {};
        cellData[r - 1][c - 1] = data;
      });
    });
    sheet.columns.forEach((column, c) => {
      if (column.width !== undefined || column.hidden)
        columnData[c] = {
          ...(column.width !== undefined ? { w: column.width * 7 + 5 } : {}),
          ...(column.hidden ? { hd: 1 } : {}),
        };
    });
    const view = sheet.views?.[0] as any,
      freeze =
        view?.state === "frozen"
          ? {
              startRow: view.ySplit ?? 0,
              startColumn: view.xSplit ?? 0,
              ySplit: view.ySplit ?? 0,
              xSplit: view.xSplit ?? 0,
            }
          : undefined;
    snapshot.sheets[id] = {
      id,
      name: sheet.name,
      rowCount: Math.max(100, sheet.rowCount + 20),
      columnCount: Math.max(26, sheet.columnCount + 5),
      defaultRowHeight: ((sheet.properties.defaultRowHeight ?? 15) * 96) / 72,
      defaultColumnWidth: (sheet.properties.defaultColWidth ?? 8.43) * 7 + 5,
      cellData,
      rowData,
      columnData,
      mergeData: ((sheet.model as any).merges ?? []).map(rangeFromA1),
      ...(freeze ? { freeze } : {}),
      ...(sheet.state !== "visible" ? { hidden: 1 } : {}),
    };
    extras.sheets[id] = {
      properties: sheet.properties,
      pageSetup: sheet.pageSetup,
      headerFooter: sheet.headerFooter,
      state: sheet.state,
      tabColor: sheet.properties.tabColor,
      tables: (sheet.getTables() as any[]).map((t) => t.table),
    };
  }
  const native = new HeadlessDocument("sheet");
  await native.load(snapshot, options.formulaPolicy === "calculate");
  try {
    for (let index = 0; index < book.worksheets.length; index++) {
      const source = book.worksheets[index],
        target = native.unit.getSheetBySheetId(snapshot.sheetOrder[index]);
      source.eachRow({ includeEmpty: false }, (row) =>
        row.eachCell({ includeEmpty: false }, (cell) => {
          const range = target.getRange(cell.address);
          if (cell.numFmt && cell.numFmt !== "General")
            range.setNumberFormat(cell.numFmt);
          const v = cell.dataValidation;
          if (v?.type) {
            try {
              let formulas = (v.formulae ?? []).map((f) =>
                f instanceof Date
                  ? String(dateSerial(f, book.properties.date1904))
                  : String(f),
              );
              if (v.type === "list" && formulas[0]?.startsWith('"'))
                formulas[0] = formulas[0].slice(1, -1).replace(/""/g, '"');
              const builder = new FDataValidationBuilder({
                uid: randomUUID(),
                type: v.type as any,
                operator: v.operator as any,
                formula1: formulas[0],
                formula2: formulas[1],
                allowBlank: v.allowBlank,
                error: v.error,
                errorTitle: v.errorTitle,
                prompt: v.prompt,
                promptTitle: v.promptTitle,
                showErrorMessage: v.showErrorMessage,
                showInputMessage: v.showInputMessage,
                errorStyle: v.errorStyle,
              } as any);
              range.setDataValidation(builder.build());
            } catch (error) {
              diagnostics.push({
                severity: "warning",
                code: "XLSX_VALIDATION",
                message: String(error),
                location: source.name + "!" + cell.address,
              });
            }
          }
        }),
      );
      for (const row of (source.model as any).rows ?? [])
        for (const model of row.cells ?? []) {
          const cell = source.getCell(model.address),
            value: any = cell.value;
          if (value?.hyperlink) {
            if (/^(https?:|mailto:|tel:|#)/i.test(value.hyperlink))
              await target
                .getRange(cell.address)
                .setHyperLink(value.hyperlink, value.text ?? value.hyperlink);
            else
              diagnostics.push({
                severity: "warning",
                code: "BLOCKED_HYPERLINK",
                message: "Unsafe hyperlink scheme was omitted",
                location: source.name + "!" + cell.address,
              });
          }
        }
      for (const table of source.getTables() as any[]) {
        const model: any = table.table;
        const ref = rangeFromA1(model.tableRef ?? model.ref + ":" + model.ref);
        const added = await target.addTable(model.name, ref, randomUUID(), {
          showHeader: model.headerRow !== false,
          showFooter: !!model.totalsRow,
          hasTotalRow: !!model.totalsRow,
          tableStyleId: "table-default-0",
        });
        if (!added)
          diagnostics.push({
            severity: "warning",
            code: "XLSX_TABLE",
            message: "Native table rejected the imported range",
            location: source.name,
          });
      }
      if (source.autoFilter && !(source.getTables() as any[]).length) {
        const ref =
          typeof source.autoFilter === "string"
            ? source.autoFilter
            : cellAddress(
                (source.autoFilter as any).from.row - 1,
                (source.autoFilter as any).from.column - 1,
              ) +
              ":" +
              cellAddress(
                (source.autoFilter as any).to.row - 1,
                (source.autoFilter as any).to.column - 1,
              );
        target.getRange(ref).createFilter();
      }
      for (const cf of (source as any).conditionalFormattings ?? []) {
        for (const rule of cf.rules as any[]) {
          let builder: any = new FConditionalFormattingBuilder({
            ranges: cf.ref
              .split(/\s+/)
              .map((ref: string) => target.getRange(ref).getRange()),
          });
          let supported = true;
          if (rule.type === "expression")
            builder = builder.whenFormulaSatisfied(
              rule.formulae?.[0] ?? "FALSE",
            );
          else if (rule.type === "cellIs") {
            const methods: any = {
              equal: "whenNumberEqualTo",
              notEqual: "whenNumberNotEqualTo",
              greaterThan: "whenNumberGreaterThan",
              lessThan: "whenNumberLessThan",
              greaterThanOrEqual: "whenNumberGreaterThanOrEqualTo",
              lessThanOrEqual: "whenNumberLessThanOrEqualTo",
              between: "whenNumberBetween",
              notBetween: "whenNumberNotBetween",
            };
            const method = methods[rule.operator];
            if (method) builder = builder[method](...rule.formulae.map(Number));
            else supported = false;
          } else if (rule.type === "containsText")
            builder = builder.whenTextContains(rule.text ?? "");
          else if (rule.type === "duplicateValues")
            builder = builder.setDuplicateValues();
          else if (rule.type === "uniqueValues")
            builder = builder.setUniqueValues();
          else supported = false;
          if (supported) {
            const style = styleIn(rule.style, theme);
            if (style.bg) builder.setBackground(style.bg.rgb);
            if (style.cl) builder.setFontColor(style.cl.rgb);
            if (style.bl !== undefined) builder.setBold(!!style.bl);
            if (style.it !== undefined) builder.setItalic(!!style.it);
            target.addConditionalFormattingRule(builder.build());
          } else
            diagnostics.push({
              severity: "warning",
              code: "XLSX_CONDITIONAL_FORMAT",
              message:
                "This conditional format requires a mapping before editable export",
              location: source.name + "!" + cf.ref,
              preserved: true,
            });
        }
      }
      for (const image of source.getImages()) {
        const data = book.getImage(Number(image.imageId)),
          anchor: any = image.range;
        let bytes: Buffer;
        if (data.buffer) bytes = Buffer.from(data.buffer as any);
        else if (data.base64)
          bytes = Buffer.from(
            data.base64.replace(/^data:[^,]*,/, ""),
            "base64",
          );
        else {
          diagnostics.push({
            severity: "warning",
            code: "XLSX_IMAGE",
            message: "Image bytes unavailable",
          });
          continue;
        }
        const tl = anchor.tl ?? {},
          builder = target
            .newOverGridImage()
            .setSource(
              "data:image/" +
                data.extension +
                ";base64," +
                bytes.toString("base64"),
              ImageSourceType.BASE64,
            )
            .setRow(tl.nativeRow ?? Math.floor(tl.row ?? 0))
            .setColumn(tl.nativeCol ?? Math.floor(tl.col ?? 0))
            .setRowOffset((tl.nativeRowOff ?? 0) / 9525)
            .setColumnOffset((tl.nativeColOff ?? 0) / 9525);
        if (anchor.ext)
          builder.setWidth(anchor.ext.width).setHeight(anchor.ext.height);
        else if (anchor.br) {
          const br = anchor.br,
            width = Math.max(1, (br.col - (tl.col ?? 0)) * 64),
            height = Math.max(1, (br.row - (tl.row ?? 0)) * 20);
          builder.setWidth(width).setHeight(height);
        }
        target.insertImages([await builder.buildAsync()]);
      }
    }
    for (const item of book.definedNames.model ?? []) {
      if (item.name.startsWith("_xlnm.")) continue;
      native.unit.insertDefinedName(item.name, item.ranges.join(","));
    }
    if (options.formulaPolicy === "calculate") await native.calculate();
    const result = native.save();
    return {
      snapshot: result,
      diagnostics,
      unsupported: diagnostics
        .filter((d) => d.code !== "XLSX_EXTERNAL_FORMULA")
        .map((d) => d.code),
      extras,
    };
  } finally {
    native.close();
  }
}
