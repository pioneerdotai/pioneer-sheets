import { resolveSheetId } from "../../shared/documents/sheet-selector";
import { hasFormulas, recalculate } from "../../shared/documents/formulas";
import { LifecycleService, LifecycleStages } from "@univerjs/core";
import { retargetUnit } from "../../shared/documents/unit-data";
import { loadDocumentFonts } from "../editor/fonts";
import { useEffect, useRef } from "react";
import { createEngine } from "../editor/engine";
import { appConfig } from "../../app-config";
import { IRenderManagerService } from "@univerjs/engine-render";

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export default function AgentRender() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const runtime = createEngine(host.current!);
    const api: any = runtime.univerAPI;
    let unit: any, source: any;
    function render() {
      return runtime.univer
        .__getInjector()
        .get(IRenderManagerService)
        .getRenderUnitById(unit.getId()) as any;
    }
    function selectSheet(selector?: string) {
      const id = resolveSheetId(
        source,
        selector ?? unit.getActiveSheet().getSheetId(),
      );
      const sheet = unit.getSheetBySheetId(id);
      if (!sheet) throw new Error("WORKSHEET_NOT_FOUND");
      return sheet;
    }
    async function settled() {
      await runtime.univer
        .__getInjector()
        .get(LifecycleService)
        .onStage(LifecycleStages.Rendered);
      await document.fonts.ready;
      await frame();
      await frame();
      const deadline = Date.now() + 15000;
      while (unit) {
        const r = render(),
          canvas = r?.engine?.getCanvasElement(),
          matrix = r?.mainComponent?.transform?.getMatrix();
        if (
          canvas?.getBoundingClientRect().width > 100 &&
          (!matrix || (matrix[4] > -9000 && matrix[5] > -9000))
        )
          break;
        if (Date.now() > deadline) throw new Error("RENDER_NOT_READY");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await frame();
      await frame();
    }
    const bridge = {
      async load(snapshot: any) {
        if (unit) api.disposeUnit(unit.getId());
        source = retargetUnit(snapshot, snapshot.id, appConfig.kind);
        await loadDocumentFonts(source);
        // Render a materialized copy only. There is no live collaboration client.
        for (const sheet of Object.values(source.sheets) as any[])
          sheet.freeze = { startRow: 0, startColumn: 0, xSplit: 0, ySplit: 0 };
        unit = api.createWorkbook(source);
        if (hasFormulas(source))
          await recalculate(api, "RENDER_CALCULATION_TIMEOUT");
        await settled();
      },
      async sheet(input: { sheet?: string; range?: string; scale?: number }) {
        const sheet = selectSheet(input.sheet);
        unit.setActiveSheet(sheet);
        sheet.zoom(input.scale ?? 1);
        const range = sheet.getRange(
          input.range ?? sheet.getDataRange().getA1Notation(),
        );
        const indexes = range.getRange();
        sheet.scrollToCell(indexes.startRow, indexes.startColumn, 0);
        await settled();
        const start = sheet.getRange(indexes.startRow, indexes.startColumn);
        const end = sheet.getRange(indexes.endRow, indexes.endColumn);
        const a = (runtime as any).cellRect(sheet, start),
          b = (runtime as any).cellRect(sheet, end);
        if (!a || !b) throw new Error("RENDER_VIEWPORT_TOO_SMALL");
        return {
          x: a.x,
          y: a.y,
          width: b.x + b.width - a.x,
          height: b.y + b.height - a.y,
          sheetId: sheet.getSheetId(),
          range: range.getA1Notation(),
        };
      },
      async sheetSize(input: {
        sheet?: string;
        range?: string;
        scale?: number;
      }) {
        const sheet = selectSheet(input.sheet);
        unit.setActiveSheet(sheet);
        const range = sheet.getRange(
          input.range ?? sheet.getDataRange().getA1Notation(),
        );
        const index = range.getRange();
        const a = sheet
            .getRange(index.startRow, index.startColumn)
            .getCellRect(),
          b = sheet.getRange(index.endRow, index.endColumn).getCellRect();
        const scale = input.scale ?? 1;
        return {
          width: (b.right - a.left) * scale,
          height: (b.bottom - a.top) * scale,
          range: range.getA1Notation(),
          sheetId: sheet.getSheetId(),
        };
      },
      close() {
        runtime.dispose();
      },
    };
    type Target = Parameters<typeof bridge.sheet>[0];
    let target: Target | undefined;
    const renderJob = {
      async prepare(input: { snapshot: unknown; target: Target }) {
        const scale = input.target.scale ?? 1;
        if (!Number.isFinite(scale) || scale < 0.25 || scale > 3)
          throw new Error("INVALID_RENDER_SCALE");
        await bridge.load(input.snapshot);
        const size = await bridge.sheetSize(input.target);
        if (
          size.width <= 0 ||
          size.height <= 0 ||
          size.width > 8192 ||
          size.height > 16000 ||
          size.width * size.height > 20_000_000
        )
          throw new Error("RENDER_RESOURCE_LIMIT");
        target = input.target;
        return {
          width: Math.ceil(Math.max(1400, size.width + 160)),
          height: Math.ceil(Math.max(1000, size.height + 240)),
        };
      },
      async capture() {
        if (!target) throw new Error("RENDER_NOT_READY");
        const { x, y, width, height, sheetId, range } =
          await bridge.sheet(target);
        return {
          clip: { x, y, width, height },
          metadata: {
            width: Math.ceil(width),
            height: Math.ceil(height),
            sheetId,
            range,
          },
        };
      },
    };
    Object.assign(window, {
      __pioneerRender: renderJob,
    });
    return () => {
      delete (window as any).__pioneerRender;
      bridge.close();
    };
  }, []);
  return (
    <div
      ref={host}
      style={{ position: "fixed", inset: 0, background: "#fff" }}
    />
  );
}
