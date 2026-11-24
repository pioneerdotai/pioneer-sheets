import { columnIndex, columnName } from "../../coordinates";
import * as Y from "yjs";
import { base64, unbase64 } from "./document";

export function anchorSelection(doc: Y.Doc, selection: any): any {
  if (!selection) return selection;
  const result = { ...selection };
  const unit = doc.getMap("unit");
  const text = (unit.get("body") as Y.Map<any>)?.get("$text");
  if (text instanceof Y.Text && typeof selection.start === "number") {
    result.relativeStart = base64(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(
          text,
          Math.max(0, Math.min(text.length, selection.start)),
        ),
      ),
    );
    result.relativeEnd = base64(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(
          text,
          Math.max(0, Math.min(text.length, selection.end ?? selection.start)),
        ),
      ),
    );
  }
  if (selection.sheetId && selection.range) {
    const sheet = (unit.get("sheets") as Y.Map<any>)?.get(selection.sheetId);
    const grid = sheet?.get("$grid");
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(selection.range);
    if (grid && m) {
      result.cellAnchors = [
        grid.get("rows").get(+m[2] - 1),
        grid.get("cols").get(columnIndex(m[1])),
        grid.get("rows").get(+(m[4] ?? m[2]) - 1),
        grid.get("cols").get(columnIndex(m[3] ?? m[1])),
      ];
    }
  }
  return result;
}

export function resolveSelection(doc: Y.Doc, selection: any): any {
  if (!selection) return selection;
  const result = { ...selection };
  try {
    for (const [key, target] of [
      ["relativeStart", "start"],
      ["relativeEnd", "end"],
    ])
      if (selection[key]) {
        const absolute = Y.createAbsolutePositionFromRelativePosition(
          Y.decodeRelativePosition(unbase64(selection[key])),
          doc,
        );
        if (absolute) result[target] = absolute.index;
      }
    if (selection.cellAnchors) {
      const grid = (doc.getMap("unit").get("sheets") as Y.Map<any>)
        ?.get(selection.sheetId)
        ?.get("$grid");
      if (grid) {
        const rows = grid.get("rows").toArray(),
          cols = grid.get("cols").toArray();
        const [r, c, re, ce] = [
          rows.indexOf(selection.cellAnchors[0]),
          cols.indexOf(selection.cellAnchors[1]),
          rows.indexOf(selection.cellAnchors[2]),
          cols.indexOf(selection.cellAnchors[3]),
        ];
        if ([r, c, re, ce].some((x) => x < 0)) return undefined;
        result.range = `${columnName(c)}${r + 1}:${columnName(ce)}${re + 1}`;
      }
    }
  } catch {}
  return result;
}
