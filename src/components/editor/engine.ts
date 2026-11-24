import { ILocalStorageService } from "@univerjs/core";
import { editorPreferences } from "./preferences";
import { getAppClient } from "../../client/pioneer/client";
import { fileDrawingPreset } from "./image-io";
import { UniverSheetsTablePreset } from "@univerjs/preset-sheets-table";
import TableEnUS from "@univerjs/preset-sheets-table/locales/en-US";
import "@univerjs/preset-sheets-table/lib/index.css";
import { IRenderManagerService } from "@univerjs/engine-render";
import { getViewportByCell } from "@univerjs/sheets-ui";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import CoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import FilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import SortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import ValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import ConditionalEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import FindEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import HyperLinkEnUS from "@univerjs/preset-sheets-hyper-link/locales/en-US";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import DrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";

export function createEngine(container: HTMLElement) {
  const runtime = createUniver({
    override: [[ILocalStorageService, { useValue: editorPreferences() }]],
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        TableEnUS,
        DrawingEnUS,
        CoreEnUS,
        FilterEnUS,
        SortEnUS,
        ValidationEnUS,
        ConditionalEnUS,
        FindEnUS,
        HyperLinkEnUS,
      ),
    },
    presets: [
      UniverSheetsCorePreset({ container }),
      UniverSheetsFilterPreset(),
      UniverSheetsSortPreset(),
      UniverSheetsTablePreset(),
      UniverSheetsDataValidationPreset(),
      UniverSheetsConditionalFormattingPreset(),
      UniverSheetsFindReplacePreset(),
      UniverSheetsHyperLinkPreset(),
      fileDrawingPreset(UniverSheetsDrawingPreset()),
    ],
  });
  let disposed = false,
    unsubscribe: (() => void) | undefined;
  void getAppClient()
    .then((app) => {
      if (disposed) return;
      unsubscribe = app.theme.subscribe((theme) => {
        runtime.univerAPI.toggleDarkMode(theme.mode === "dark");
        const current = runtime.univerAPI.getCurrentTheme();
        const accent = theme.colors.button_primary;
        if (typeof accent === "string")
          runtime.univerAPI.setTheme({
            ...current,
            primary: { ...current.primary, 600: accent },
          });
      });
    })
    .catch(() => {});
  return {
    ...runtime,
    dispose() {
      disposed = true;
      unsubscribe?.();
      runtime.univer.dispose();
    },
    cellRect(sheet: any, range: any) {
      const render = runtime.univer
        .__getInjector()
        .get(IRenderManagerService)
        .getRenderUnitById(range.getUnitId());
      if (!render) return;
      const selected = range.getRange();
      const viewport = getViewportByCell(
        selected.startRow,
        selected.startColumn,
        render.scene,
        sheet.getSheet(),
      );
      const canvas = render.engine.getCanvasElement();
      if (!viewport || !canvas) return;
      const world = range.getCellRect(),
        bounds = canvas.getBoundingClientRect(),
        scale = render.scene.getAncestorScale();
      const ratio =
        bounds.width / (parseFloat(canvas.style.width) || bounds.width);
      const x =
        bounds.x + (world.x - viewport.viewportScrollX) * scale.scaleX * ratio;
      const y =
        bounds.y + (world.y - viewport.viewportScrollY) * scale.scaleY * ratio;
      if (
        x < bounds.left ||
        y < bounds.top ||
        x > bounds.right ||
        y > bounds.bottom
      )
        return;
      return {
        x,
        y,
        width: world.width * scale.scaleX * ratio,
        height: world.height * scale.scaleY * ratio,
      };
    },
  };
}
