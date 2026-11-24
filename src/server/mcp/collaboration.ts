import { z } from "zod";
import { OfficeService } from "../documents/service";
import {
  fromUpdate,
  unbase64,
  anchorSelection,
} from "../../shared/documents/model";
import type { RegisterTool } from "./types";

export function registerCollaboration(
  tool: RegisterTool,
  service: OfficeService,
) {
  const id = { documentId: z.string() };

  tool(
    "presence_set",
    "Publish the agent name and selected range/caret. Call leave when finished. Presence expires after 60 seconds without refresh.",
    {
      ...id,
      connectionId: z.string(),
      selection: z
        .object({
          sheetId: z.string().optional(),
          range: z.string().optional(),
          start: z.number().optional(),
          end: z.number().optional(),
        })
        .optional(),
      leave: z.boolean().optional(),
    },
    async (a, who) => {
      await service.require(a.documentId, who);
      const cid = `agent:${who.id}:${a.connectionId}`;
      if (a.leave) service.leave(a.documentId, cid);
      else {
        const unit = await service.get(a.documentId, who);
        const model = fromUpdate(unbase64(unit.update));
        service.presence(
          a.documentId,
          who,
          cid,
          anchorSelection(model, a.selection),
        );
        model.destroy();
      }
      return { members: service.members(a.documentId) };
    },
  );

  tool(
    "operations_help",
    "Get supported operation examples for this application.",
    {},
    async () =>
      service.kind === "sheet"
        ? [
            {
              op: "set_cells",
              sheet: "sheet-id-or-name",
              range: "A1:B2",
              values: [
                ["Item", "Total"],
                ["Example", "=10*2"],
              ],
            },
            {
              op: "format_cells",
              range: "A1:B1",
              style: { bl: 1, bg: { rgb: "#eeeeee" } },
            },
            { op: "insert_rows", index: 2, count: 1 },
            { op: "add_sheet", name: "Summary" },
            {
              op: "patch",
              path: ["sheets", "sheet-id", "mergeData"],
              value: [],
            },
          ]
        : [
            { op: "insert_text", index: 0, text: "Hello ", style: { bl: 1 } },
            { op: "replace_text", start: 0, end: 5, text: "Hello" },
            { op: "format_text", start: 0, end: 5, style: { it: 1 } },
            {
              op: "format_paragraph",
              start: 0,
              end: 100,
              style: { namedStyleType: 4 },
            },
            { op: "page_setup", style: { marginTop: 72 } },
          ],
  );
}
