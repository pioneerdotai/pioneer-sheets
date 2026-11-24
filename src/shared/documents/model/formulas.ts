import { columnIndex } from "../../coordinates";
import * as Y from "yjs";

export function formulaParts(doc: Y.Doc, sheetId: string, formula: string) {
  const sheets = doc.getMap("unit").get("sheets") as Y.Map<any>;
  const parts: any[] = [];
  let last = 0;
  let inherited = sheetId;
  const regex =
    /"(?:""|[^"])*"|(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)/gu;
  for (const match of formula.matchAll(regex)) {
    if (
      match[0].startsWith('"') ||
      formula[match.index! + match[0].length] === "("
    )
      continue;
    const name = match[1]?.replace(/''/g, "'") ?? match[2];
    const between = formula.slice(last, match.index);
    let target = name
      ? [...sheets.entries()].find(([, s]) => s.get("name") === name)?.[0]
      : between.trim() === ":"
        ? inherited
        : sheetId;
    if (!target) continue;
    const grid = sheets.get(target)?.get("$grid");
    if (!grid) continue;
    const col = columnIndex(match[4]);
    const row = +match[6] - 1;
    const rid = grid.get("rows").get(row),
      cid = grid.get("cols").get(col);
    if (!rid || !cid) continue;
    parts.push(formula.slice(last, match.index));
    parts.push({
      sheetId: target,
      rowId: rid,
      colId: cid,
      columnAbsolute: match[3],
      rowAbsolute: match[5],
      prefix: match[0].slice(
        0,
        match[0].length - (match[3] + match[4] + match[5] + match[6]).length,
      ),
    });
    last = match.index! + match[0].length;
    inherited = target;
  }
  parts.push(formula.slice(last));
  return parts;
}

export function anchorFormulas(doc: Y.Doc) {
  const sheets = doc.getMap("unit").get("sheets");
  if (!(sheets instanceof Y.Map)) return;
  for (const [id, sheet] of sheets.entries()) {
    const cells = sheet.get("$grid")?.get("cells");
    if (!cells) continue;
    for (const cell of cells.values())
      if (cell instanceof Y.Map) {
        const formula = cell.get("f");
        const old = cell.get("$formulaAnchors");
        if (typeof formula === "string" && formula !== old?.formula)
          cell.set("$formulaAnchors", {
            formula,
            parts: formulaParts(doc, id, formula),
          });
        else if (!formula && old) cell.delete("$formulaAnchors");
      }
  }
}
