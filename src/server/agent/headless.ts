import { hasFormulas, recalculate } from "../../shared/documents/formulas";
import { installHeadlessImageAdapter } from "./image";
import { retargetUnit } from "../../shared/documents/unit-data";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { Univer, LocaleType, ICommandService } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsHyperLinkPlugin } from "@univerjs/docs-hyper-link";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverSheetsHyperLinkPlugin } from "@univerjs/sheets-hyper-link";
import { UniverSheetsDrawingPlugin } from "@univerjs/sheets-drawing";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsTablePlugin } from "@univerjs/sheets-table";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import SheetsLocale from "@univerjs/sheets/locale/en-US";
import "@univerjs/docs/facade";
import "@univerjs/docs-drawing/facade";
import "@univerjs/sheets/facade";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets-formula/facade";
import "@univerjs/sheets-filter/facade";
import "@univerjs/sheets-data-validation/facade";
import "@univerjs/sheets-conditional-formatting/facade";
import "@univerjs/sheets-hyper-link/facade";
import "@univerjs/sheets-drawing/facade";
import "@univerjs/sheets-sort/facade";
import "@univerjs/sheets-table/facade";
import "@univerjs/sheets-numfmt/facade";
import type { Kind, Snapshot } from "../../shared/documents/model";

export class HeadlessDocument {
  univer: Univer;
  api: FUniver;
  unit: any;
  kind: Kind;
  loaded?: Snapshot;
  mutations: string[] = [];
  axes: any[] = [];
  facadeScope = 0;
  mode: "read" | "write" | "internal" = "internal";
  constructor(kind: Kind) {
    installHeadlessImageAdapter();
    this.kind = kind;
    this.univer = new Univer({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: SheetsLocale },
    });
    if (kind === "sheet")
      for (const plugin of [
        UniverFormulaEnginePlugin,
        UniverSheetsPlugin,
        UniverSheetsFormulaPlugin,
        UniverSheetsFilterPlugin,
        UniverSheetsDataValidationPlugin,
        UniverSheetsConditionalFormattingPlugin,
        UniverSheetsHyperLinkPlugin,
        UniverDrawingPlugin,
        UniverSheetsDrawingPlugin,
        UniverSheetsSortPlugin,
        UniverSheetsTablePlugin,
        UniverSheetsNumfmtPlugin,
      ])
        this.univer.registerPlugin(plugin as any);
    else
      for (const plugin of [
        UniverRenderEnginePlugin,
        UniverDocsPlugin,
        UniverDrawingPlugin,
        UniverDocsDrawingPlugin,
        UniverDocsHyperLinkPlugin,
      ])
        this.univer.registerPlugin(plugin as any);
    this.api = FUniver.newAPI(this.univer);
    const commands = this.univer.__getInjector().get(ICommandService);
    commands.beforeCommandExecuted((event) => {
      if (this.mode === "read" && this.facadeScope > 0 && event.type === 2)
        throw new Error("READ_ONLY: read execution cannot mutate content");
    });
    commands.onCommandExecuted((event: any) => {
      if (this.mode !== "write") return;
      if (event.type === 2) this.mutations.push(event.id);
      if (
        /^sheet\.mutation\.(insert-row|insert-col|remove-rows|remove-col)$/.test(
          event.id,
        )
      ) {
        const p = event.params,
          r = p?.range;
        if (r) {
          const row = event.id.includes("row");
          this.axes.push({
            sheetId: p.subUnitId,
            axis: row ? "row" : "column",
            index: row ? r.startRow : r.startColumn,
            count:
              (row ? r.endRow - r.startRow : r.endColumn - r.startColumn) + 1,
            remove: event.id.includes("remove"),
          });
        }
      }
    });
  }
  async load(data: Snapshot, calculate = true) {
    this.mode = "internal";
    if (this.unit) this.api.disposeUnit(this.unit.getId());
    data = retargetUnit(data, data.id, this.kind);
    this.loaded = structuredClone(data);
    this.unit =
      this.kind === "sheet"
        ? this.api.createWorkbook(structuredClone(data) as any)
        : this.api.createDocument(structuredClone(data) as any);
    if (calculate) await this.calculate();
    this.mutations = [];
    this.axes = [];
  }
  save(): Snapshot {
    const saved = this.unit.save();
    const resources = new Map(
      (this.loaded?.resources ?? []).map((r: any) => [r.name, r]),
    );
    for (const r of saved.resources ?? []) resources.set(r.name, r);
    return { ...this.loaded, ...saved, resources: [...resources.values()] };
  }
  async calculate() {
    if (this.kind !== "sheet") return;
    if (hasFormulas(this.unit.getWorkbook().getSnapshot()))
      await recalculate(this.api, "CALCULATION_TIMEOUT");
  }

  close() {
    this.univer.dispose();
  }
}
