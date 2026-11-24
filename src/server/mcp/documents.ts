import { z } from "zod";
import { OfficeService } from "../documents/service";
import { OfficeAI } from "../documents/ai";
import { readable } from "../../shared/documents/text";
import type { RegisterTool } from "./types";

export function registerDocuments(tool: RegisterTool, service: OfficeService) {
  const ai = new OfficeAI(service);

  const id = { documentId: z.string() };

  tool(
    "documents_list",
    "List documents in the local application workspace.",
    { trash: z.boolean().optional() },
    (a, who) => service.list(who, a.trash),
  );

  tool(
    "document_create",
    "Create a blank document.",
    {
      title: z.string().optional(),
    },
    (a, who) => service.create(who, a.title),
  );

  tool(
    "document_import",
    "Create a document from a Univer JSON snapshot.",
    { snapshot: z.record(z.string(), z.any()), title: z.string().optional() },
    (a, who) => service.create(who, a.title, a.snapshot),
  );

  tool(
    "document_export",
    "Export a complete JSON snapshot or readable plain text.",
    { ...id, format: z.enum(["json", "text"]).optional() },
    async (a, who) => {
      const d = await service.get(a.documentId, who);
      return {
        title: d.title,
        revision: d.revision,
        format: a.format ?? "json",
        content:
          a.format === "text" ? readable(d.snapshot, service.kind) : d.snapshot,
      };
    },
  );

  tool(
    "document_permissions",
    "Set a participant role. Only document owners can change roles.",
    { ...id, identityId: z.string(), role: z.enum(["editor", "viewer"]) },
    (a, who) => service.setMember(a.documentId, who, a.identityId, a.role),
  );

  tool(
    "document_read",
    "Read the complete Univer JSON snapshot. Prefer document_inspect for bounded output.",
    id,
    async (a, who) => {
      const d = await service.get(a.documentId, who);
      return {
        id: d.id,
        title: d.title,
        revision: d.revision,
        snapshot: d.snapshot,
      };
    },
  );

  tool(
    "document_inspect",
    "Inspect sheets/ranges or document paragraphs and text. Positions use JavaScript UTF-16 offsets.",
    {
      ...id,
      sheet: z.string().optional(),
      range: z.string().optional(),
      start: z.number().int().nonnegative().optional(),
      end: z.number().int().nonnegative().optional(),
      query: z.string().optional(),
    },
    (a, who) => ai.inspect(a.documentId, who, a),
  );

  tool(
    "document_edit",
    "Apply an atomic batch. Sheets: set_cells, format_cells, clear_cells, add_sheet, remove_sheet, rename_sheet, move_sheet, insert_rows, delete_rows, insert_columns, delete_columns, merge, unmerge, sort, freeze, resize. Docs: insert_text, replace_text, delete_text, find_replace, format_text, format_paragraph, page_setup. Both: rename, patch. Pass requestId for safe retries and expectedRevision to reject stale edits.",
    {
      ...id,
      operations: z
        .array(z.object({ op: z.string() }).passthrough())
        .min(1)
        .max(200),
      requestId: z.string().optional(),
      expectedRevision: z.number().int().optional(),
    },
    (a, who) =>
      ai.execute(
        a.documentId,
        who,
        a.operations,
        a.requestId,
        a.expectedRevision,
      ),
  );

  tool(
    "document_manage",
    "Rename, duplicate, trash, restore, star or permanently purge a trashed document.",
    {
      ...id,
      action: z.enum([
        "rename",
        "duplicate",
        "trash",
        "restore",
        "star",
        "purge",
      ]),
      value: z.any().optional(),
    },
    (a, who) => service.meta(a.documentId, who, a.action, a.value),
  );

  tool(
    "document_draft",
    "Create an isolated CRDT draft, mark it ready for review, reopen it, or merge a ready draft into its source. Only the source owner can merge.",
    { ...id, action: z.enum(["create", "ready", "reopen", "merge"]) },
    (a, who) =>
      a.action === "create"
        ? service.createDraft(a.documentId, who)
        : service.reviewDraft(a.documentId, who, a.action),
  );

  tool(
    "document_history",
    "List the latest 100 saved revisions.",
    id,
    (a, who) => service.history(a.documentId, who),
  );

  tool(
    "document_restore_version",
    "Restore a previous revision as a new saved revision.",
    { ...id, revision: z.number().int().nonnegative() },
    (a, who) => service.restoreVersion(a.documentId, a.revision, who),
  );
}
