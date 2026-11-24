---
name: sheets
slug: sheets
version: 1.1.0
description: Read, create, edit, review and exchange spreadsheets stored in the installed Pioneer Sheets application through its MCP tools.
---

# Pioneer Sheets

Use the application's MCP tools for spreadsheets. Pioneer supplies user and agent identity; do not create sessions, request user names or invent bearer tokens. Use the actual document IDs returned by `documents_list` or `document_create`.

For spreadsheet changes:
1. `agent_runtime_open` for the document; inspect its sheet IDs and ranges.
2. `agent_api_find` with `terms`, then `agent_api_show` for the public Facade methods you need.
3. `agent_execute` with `mode: "write"` stages code using `univerAPI` and `workbook`; no Node globals or imports. Prefer bounded ranges.
4. Check `agent_inspect` and `agent_screenshot`. Staged edits are private until committed.
5. `agent_runtime_commit`; verify `confirmed`. For `pull-required`, pull and review the merged state. For `unknown`, retry the same runtime commit before making more edits.
6. Close the runtime when finished. `presence_set` with a stable `connectionId` and sheet/range shows your work to participants; send `leave` when done.

For files, use `files_put` for small content, or `files_upload_start`, `files_upload_append` (base64 with acknowledged offset), `files_upload_finish`. Read bytes with bounded `files_read` calls. No raw backend HTTP credential is needed.

`exchange_create` imports XLSX/CSV/TSV/JSON or exports a confirmed document revision or a private staged runtime. Inspect `exchange_get` until terminal status and review diagnostics. Keep `allowLossy` false unless the user approves a lossy conversion. `files_read` retrieves exported bytes. For a review workflow, use document drafts; owner approval merges them into the shared document.
