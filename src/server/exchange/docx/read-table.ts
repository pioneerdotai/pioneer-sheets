import { randomUUID } from "node:crypto";
import { DataStreamTreeTokenType as T } from "@univerjs/core";
import type { XmlNode } from "../package";
import { child, children, attr } from "../package";
import { value, flag, px } from "./values";
import type { StoryContext } from "./story-context";

export function table(
  story: Pick<StoryContext, "body" | "context" | "paragraph" | "table">,
  node: XmlNode,
) {
  const tableId = randomUUID(),
    startIndex = story.body.dataStream.length,
    pr = child(node, "tblPr"),
    grid = children(child(node, "tblGrid"), "gridCol").map((c) =>
      px(attr(c, "w")),
    ),
    rows: any[] = [];
  const totalWidth =
    grid.reduce((n, v) => n + v, 0) ||
    story.context.snapshot.documentStyle.pageSize.width -
      story.context.snapshot.documentStyle.marginLeft -
      story.context.snapshot.documentStyle.marginRight;
  story.body.dataStream += T.TABLE_START;
  for (const row of children(node, "tr")) {
    story.body.dataStream += T.TABLE_ROW_START;
    const cells: any[] = [],
      trPr = child(row, "trPr"),
      height = child(trPr, "trHeight");
    for (const cell of children(row, "tc")) {
      const cellPr = child(cell, "tcPr"),
        span = +(value(cellPr, "gridSpan") ?? 1),
        shade = value(cellPr, "shd", "fill"),
        margins = child(cellPr, "tcMar") ?? child(pr, "tblCellMar");
      story.body.dataStream += T.TABLE_CELL_START;
      const before = story.body.dataStream.length;
      for (const c of cell.children) {
        if (c.name.endsWith(":p") || c.name === "p") story.paragraph(c);
        else if (c.name.endsWith(":tbl") || c.name === "tbl") story.table(c);
      }
      if (story.body.dataStream.length === before) {
        story.body.paragraphs.push({
          startIndex: story.body.dataStream.length,
          paragraphId: randomUUID(),
        });
        story.body.dataStream += "\r";
      }
      story.body.sectionBreaks.push({
        sectionId: randomUUID(),
        startIndex: story.body.dataStream.length,
      });
      story.body.dataStream += "\n" + T.TABLE_CELL_END;
      const config: any = {
        ...(span > 1 ? { columnSpan: span } : {}),
        margin: {
          start: {
            v: px(
              value(margins, "left", "w") ??
                value(margins, "start", "w") ??
                108,
            ),
          },
          end: {
            v: px(
              value(margins, "right", "w") ?? value(margins, "end", "w") ?? 108,
            ),
          },
          top: { v: px(value(margins, "top", "w") ?? 0) },
          bottom: { v: px(value(margins, "bottom", "w") ?? 0) },
        },
        ...(shade && shade !== "auto"
          ? { backgroundColor: { rgb: "#" + shade } }
          : {}),
      };
      if (child(cellPr, "vMerge")) {
        config.pioneerVerticalMerge =
          attr(child(cellPr, "vMerge"), "val") ?? "continue";
        story.context.warn(
          "DOCX_VERTICAL_MERGE",
          "Vertical table merge retained in the source package",
          tableId,
        );
      }
      for (const [side, key] of [
        ["top", "borderTop"],
        ["bottom", "borderBottom"],
        ["left", "borderLeft"],
        ["right", "borderRight"],
      ]) {
        const border =
          child(child(cellPr, "tcBorders"), side) ??
          child(child(pr, "tblBorders"), side);
        if (border)
          config[key] = {
            color: { rgb: "#" + (attr(border, "color") ?? "000000") },
            width: { v: ((Number(attr(border, "sz") ?? 4) / 8) * 96) / 72 },
            dashStyle: attr(border, "val") === "dashed" ? 2 : 0,
          };
      }
      cells.push(config);
    }
    rows.push({
      tableCells: cells,
      trHeight: {
        val: { v: height ? px(attr(height, "val")) : 0 },
        hRule:
          attr(height, "hRule") === "exact"
            ? 2
            : attr(height, "hRule") === "atLeast"
              ? 1
              : 0,
      },
      ...(flag(trPr, "tblHeader") ? { repeatHeaderRow: 1 } : {}),
    });
    story.body.dataStream += T.TABLE_ROW_END;
  }
  story.body.dataStream += T.TABLE_END;
  story.body.tables.push({
    startIndex,
    endIndex: story.body.dataStream.length - 1,
    tableId,
  });
  story.context.snapshot.tableSource[tableId] = {
    tableId,
    tableRows: rows,
    tableColumns: grid.map((width) => ({
      size: { type: 1, width: { v: width } },
    })),
    size: { type: 1, width: { v: totalWidth } },
    align:
      value(pr, "jc") === "center" ? 1 : value(pr, "jc") === "right" ? 2 : 0,
    indent: { v: px(value(pr, "tblInd", "w")) },
    textWrap: 0,
    position: {
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 0, posOffset: 0 },
    },
    dist: { distB: 0, distL: 0, distR: 0, distT: 0 },
  };
}
