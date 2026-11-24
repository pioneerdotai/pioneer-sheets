import { hasFormulas, recalculate } from "../../shared/documents/formulas";
import { Univer, LocaleType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import "@univerjs/sheets/facade";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets-formula/facade";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverSheetsHyperLinkPlugin } from "@univerjs/sheets-hyper-link";
import { UniverSheetsDrawingPlugin } from "@univerjs/sheets-drawing";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import type { Snapshot } from "../../shared/documents/model";

export async function calculateSnapshot(
  data: Snapshot,
  structural?: { op: string; sheet?: string; index: number; count?: number },
): Promise<Snapshot> {
  const formulas = hasFormulas(data);
  if (!structural && !formulas) return data;
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: SheetsEnUS },
  });
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.registerPlugin(UniverSheetsFilterPlugin);
    univer.registerPlugin(UniverSheetsDataValidationPlugin);
    univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
    univer.registerPlugin(UniverSheetsHyperLinkPlugin);
    univer.registerPlugin(UniverDrawingPlugin);
    univer.registerPlugin(UniverSheetsDrawingPlugin);
    const api = FUniver.newAPI(univer);
    const book = api.createWorkbook(structuredClone(data));
    if (structural) {
      const target = structural.sheet
        ? book
            .getSheets()
            .find(
              (s) =>
                s.getSheetId() === structural.sheet ||
                s.getSheetName() === structural.sheet,
            )
        : book.getActiveSheet();
      if (!target) throw new Error("Sheet not found");
      const count = structural.count ?? 1;
      switch (structural.op) {
        case "insert_rows":
          target.insertRowsBefore(structural.index, count);
          break;
        case "delete_rows":
          target.deleteRows(structural.index, count);
          break;
        case "insert_columns":
          target.insertColumnsBefore(structural.index, count);
          break;
        case "delete_columns":
          target.deleteColumns(structural.index, count);
          break;
      }
    }
    if (formulas)
      await recalculate(api, "Formula recalculation exceeded 10 seconds");
    const saved = book.save() as Snapshot;
    // Preserve resources of plugins not installed in this headless environment.
    // Registered open-source plugins supply their transformed ranges on save.
    const resources = new Map(
      (data.resources ?? []).map((r: any) => [r.name, r]),
    );
    for (const resource of saved.resources ?? [])
      resources.set(resource.name, resource);
    return { ...data, ...saved, resources: [...resources.values()] };
  } finally {
    univer.dispose();
  }
}
