import { cellAddress } from "../../../shared/coordinates";
import ExcelJS from "exceljs";
import { HeadlessDocument } from "../../agent/headless";
import type { Snapshot } from "../../../shared/documents/model";
import type {
  CodecOptions,
  Diagnostic,
  ExportResult,
} from "../../../shared/exchange";
import {
  readPackage,
  xmlPart,
  descendants,
  child,
  exchangeMetadata,
  serialize,
  putXml,
  writePackage,
} from "../package";
import { styleOut, nativeStyle } from "./styles";
import { resource, validationOut } from "./values";

export async function exportXlsx(
  snapshot: Snapshot,
  options: CodecOptions = {},
): Promise<ExportResult> {
  const diagnostics: Diagnostic[] = [],
    book = new ExcelJS.Workbook(),
    meta = exchangeMetadata(snapshot),
    extras = meta?.extras ?? {};
  Object.assign(book, {
    creator: extras.workbook?.creator ?? "Pioneer",
    title: snapshot.name,
    description: extras.workbook?.description,
    subject: extras.workbook?.subject,
  });
  book.properties.date1904 = !!extras.workbook?.date1904;
  book.calcProperties.fullCalcOnLoad = true;
  const native = new HeadlessDocument("sheet");
  await native.load(snapshot, options.formulaPolicy !== "preserve");
  const data = native.save();
  try {
    for (const id of data.sheetOrder) {
      const source = data.sheets[id],
        fSheet = native.unit.getSheetBySheetId(id),
        extra = extras.sheets?.[id] ?? {};
      const target = book.addWorksheet(source.name, {
        properties: {
          ...extra.properties,
          defaultRowHeight: ((source.defaultRowHeight ?? 20) * 72) / 96,
          defaultColWidth: ((source.defaultColumnWidth ?? 64) - 5) / 7,
        },
        pageSetup: extra.pageSetup,
        headerFooter: extra.headerFooter,
        state: source.hidden ? "hidden" : "visible",
      });
      const freeze = source.freeze;
      if (freeze && (freeze.xSplit || freeze.ySplit))
        target.views = [
          { state: "frozen", xSplit: freeze.xSplit, ySplit: freeze.ySplit },
        ];
      for (const [r, row] of Object.entries(source.cellData ?? {}))
        for (const [c, cell] of Object.entries(row as any)) {
          const value: any = cell,
            output = target.getCell(+r + 1, +c + 1);
          if (value.f)
            output.value = {
              formula: value.f.replace(/^=/, ""),
              ...(value.v !== undefined
                ? {
                    result:
                      typeof value.v === "string" &&
                      /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(
                        value.v,
                      )
                        ? { error: value.v }
                        : value.v,
                  }
                : {}),
            } as any;
          else if (value.p?.body) {
            const body = value.p.body,
              stream = body.dataStream.replace(/\r\n$/, "");
            const boundaries = [
              ...new Set([
                0,
                stream.length,
                ...(body.textRuns ?? []).flatMap((run: any) => [
                  run.st,
                  Math.min(run.ed, stream.length),
                ]),
              ]),
            ].sort((a: any, b: any) => a - b);
            output.value = {
              richText: boundaries.slice(0, -1).map((st: any, i) => {
                const ed: any = boundaries[i + 1],
                  style = Object.assign(
                    {},
                    ...(body.textRuns ?? [])
                      .filter((run: any) => run.st <= st && run.ed >= ed)
                      .map((run: any) => run.ts),
                  );
                return {
                  text: stream.slice(st, ed),
                  font: styleOut(style).font,
                };
              }),
            };
          } else output.value = value.v ?? null;
          output.style = styleOut(nativeStyle(data, value));
          const range = fSheet.getRange(+r, +c),
            numfmt = range.getNumberFormat();
          if (numfmt) output.numFmt = numfmt;
          const links = range.getHyperLinks();
          if (links?.length && !value.f)
            output.value = {
              text: String(value.v ?? links[0].payload ?? ""),
              hyperlink: links[0].url,
            };
          const validation = range.getDataValidation();
          if (validation)
            output.dataValidation = validationOut(validation) as any;
        }
      for (const [r, value] of Object.entries(source.rowData ?? {})) {
        const row: any = value;
        if (row.h !== undefined)
          target.getRow(+r + 1).height = (row.h * 72) / 96;
        if (row.hd) target.getRow(+r + 1).hidden = true;
      }
      for (const [c, value] of Object.entries(source.columnData ?? {})) {
        const col: any = value;
        if (col.w !== undefined)
          target.getColumn(+c + 1).width = Math.max(0, (col.w - 5) / 7);
        if (col.hd) target.getColumn(+c + 1).hidden = true;
      }
      for (const merge of source.mergeData ?? [])
        target.mergeCells(
          merge.startRow + 1,
          merge.startColumn + 1,
          merge.endRow + 1,
          merge.endColumn + 1,
        );
      const filter = fSheet.getFilter();
      if (filter) {
        const r = filter.getRange().getRange();
        target.autoFilter =
          cellAddress(r.startRow, r.startColumn) +
          ":" +
          cellAddress(r.endRow, r.endColumn);
      }
      const tables = fSheet.getSubTableInfos?.() ?? [];
      for (const info of tables) {
        const table = info.range ?? info.tableRange;
        if (!table) continue;
        const original = (extra.tables ?? []).find(
            (t: any) => t.name === info.name,
          ),
          header = info.showHeader ?? original?.headerRow ?? true,
          footer = !!original?.totalsRow,
          start = table.startRow + (header ? 1 : 0),
          end = table.endRow - (footer ? 1 : 0);
        const columns = Array.from(
          { length: table.endColumn - table.startColumn + 1 },
          (_, i) => ({
            ...original?.columns?.[i],
            name: String(
              info.columns?.[i]?.displayName ??
                source.cellData?.[table.startRow]?.[table.startColumn + i]?.v ??
                "Column" + (i + 1),
            ),
            filterButton: info.showAutoFilter !== false,
          }),
        );
        const rows = Array.from(
          { length: Math.max(0, end - start + 1) },
          (_, r) =>
            Array.from(
              { length: columns.length },
              (_, c) =>
                target.getCell(start + 1 + r, table.startColumn + 1 + c).value,
            ),
        );
        target.addTable({
          name: info.name ?? "Table" + (target.getTables().length + 1),
          ref: cellAddress(table.startRow, table.startColumn),
          headerRow: header,
          totalsRow: footer,
          style: original?.style ?? {
            theme: "TableStyleMedium2",
            showRowStripes: true,
          },
          columns,
          rows,
        });
      }

      for (const rule of fSheet.getConditionalFormattingRules()) {
        const config: any = rule.rule,
          ranges = rule.ranges,
          ref = ranges
            .map(
              (r: any) =>
                cellAddress(r.startRow, r.startColumn) +
                ":" +
                cellAddress(r.endRow, r.endColumn),
            )
            .join(" ");
        let mapped: any;
        if (config?.type === "highlightCell") {
          const sub = config.subType ?? config.type,
            op = config.operator,
            style = styleOut(config.style ?? {});
          if (sub === "formula")
            mapped = { type: "expression", formulae: [config.value], style };
          else if (sub === "number")
            mapped = {
              type: "cellIs",
              operator: op,
              formulae: Array.isArray(config.value)
                ? config.value
                : [config.value],
              style,
            };
          else if (sub === "uniqueValues" || sub === "duplicateValues")
            mapped = { type: sub, style };
        }
        if (mapped)
          target.addConditionalFormatting({
            ref,
            rules: [
              {
                ...mapped,
                priority: (target as any).conditionalFormattings.length + 1,
              },
            ],
          });
        else
          diagnostics.push({
            severity: "warning",
            code: "CONDITIONAL_FORMAT_EXPORT",
            message: "Conditional rule needs an XLSX mapping",
            location: source.name,
          });
      }
      for (const d of Object.values(
        resource(data, "SHEET_DRAWING_PLUGIN")?.[id]?.data ?? {},
      ) as any[]) {
        if (d.drawingType !== 0) continue;
        const imageSource = d.source;
        if (!imageSource?.startsWith("data:image/")) {
          diagnostics.push({
            severity: "error",
            code: "UNMATERIALIZED_IMAGE",
            message: "Resolve file references before export",
          });
          continue;
        }
        const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/s.exec(
          imageSource,
        );
        if (!match) {
          diagnostics.push({
            severity: "warning",
            code: "XLSX_IMAGE_FORMAT",
            message: "XLSX requires PNG/JPEG/GIF image data",
          });
          continue;
        }
        const imageId = book.addImage({
          base64: imageSource,
          extension: match[1] as any,
        });
        const transform = d.transform ?? {},
          sheetTransform = d.sheetTransform ?? {};
        target.addImage(imageId, {
          tl: {
            col:
              (sheetTransform.from?.column ?? 0) +
              (sheetTransform.from?.columnOffset ?? 0) /
                (source.columnData?.[sheetTransform.from?.column ?? 0]?.w ??
                  source.defaultColumnWidth ??
                  64),
            row:
              (sheetTransform.from?.row ?? 0) +
              (sheetTransform.from?.rowOffset ?? 0) /
                (source.rowData?.[sheetTransform.from?.row ?? 0]?.h ??
                  source.defaultRowHeight ??
                  20),
          },
          ext: {
            width: transform.width ?? 100,
            height: transform.height ?? 100,
          },
        });
      }
    }
    for (const defined of native.unit.getDefinedNames()) {
      const name = defined.getName?.(),
        range = defined.getFormulaOrRefString?.() ?? defined.getRef?.();
      if (name && range) book.definedNames.add(range, name);
    }
    if (
      diagnostics.some((d) => d.severity === "error") ||
      (diagnostics.some((d) => d.severity === "warning") && !options.allowLossy)
    )
      throw new Error("EXCHANGE_UNSUPPORTED: " + JSON.stringify(diagnostics));
    const output = readPackage(
      new Uint8Array((await book.xlsx.writeBuffer()) as any),
    );
    for (const path of Object.keys(output).filter(
      (p) => p.startsWith("xl/drawings/") && p.endsWith(".xml"),
    )) {
      const root = xmlPart(output, path);
      for (const anchor of descendants(root, "oneCellAnchor")) {
        delete anchor.attrs.editAs;
        const extent = child(anchor, "ext");
        for (const transform of descendants(anchor, "xfrm")) {
          const size = child(transform, "ext");
          if (size && extent) Object.assign(size.attrs, extent.attrs);
        }
      }
      putXml(output, path, serialize(root));
    }
    return {
      data: writePackage(output),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      diagnostics,
    };
  } finally {
    native.close();
  }
}
