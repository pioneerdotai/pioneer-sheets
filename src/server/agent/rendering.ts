import { getPioneerContext } from "#sheets-authority";
import type { Snapshot, Kind } from "../../shared/documents/model";

export interface ScreenshotTarget {
  sheet?: string;
  range?: string;
  scale?: number;
}

export class RenderRuntime {
  async capture(snapshot: Snapshot, kind: Kind, target: ScreenshotTarget = {}) {
    const scale = target.scale ?? 1;
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 3)
      throw new Error("INVALID_RENDER_SCALE");
    if (kind !== "sheet") throw new Error("SHEET_RENDER_KIND_REQUIRED");
    const { data, metadata } = await (
      await getPioneerContext()
    ).host.render.screenshot({
      path: "/agent-render",
      input: {
        snapshot,
        target: { sheet: target.sheet, range: target.range, scale },
      },
    });
    const result = metadata as {
      width: number;
      height: number;
      sheetId: string;
      range: string;
    };
    return {
      images: [
        {
          data,
          mimeType: "image/png",
          width: result.width,
          height: result.height,
          target: {
            kind: "sheet-range",
            sheetId: result.sheetId,
            range: result.range,
          },
          filename: "sheet-range.png",
        },
      ],
    };
  }
  async pdf(html: string) {
    if (html.length > 40_000_000) throw new Error("PDF_HTML_SIZE_LIMIT");
    return (await getPioneerContext()).host.render.pdf({ html });
  }
}

const renderer = new RenderRuntime();

export function getRenderRuntime() {
  return renderer;
}
