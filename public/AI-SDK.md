# Pioneer Sheets AI SDK

Agents use the App-owned Streamable HTTP MCP endpoint. Pioneer supplies the execution credential and caller user/agent headers; Sheets creates no login session or user token. Pioneer retains the model/conversation/tool loop; the application owns document execution, staging, rendering and persistence. See SDK.md for the installed contract and the repository's docs/PIONEER-REQUIRED-CHANGES.md for pending host work.

Functional references: [Univer AI SDK 1.5.0 packages](https://docs.univer.ai/ai/packages), [content operations](https://docs.univer.ai/ai/content-operations), [worker lifecycle](https://docs.univer.ai/ai/runtime-architecture), [visual inspection](https://docs.univer.ai/ai/visual-inspection). This independent implementation uses Apache Univer plugins, Yjs, SQLite, QuickJS and Playwright. No proprietary Univer CLI/Pro implementation is imported or copied.

## Agent flow

1. `documents_list` / `document_create` returns the document ID.
2. `agent_runtime_open {documentId}` loads real headless Univer and waits for formula calculation. Keep `runtimeId`.
3. Discover APIs with `agent_api_find` / `agent_api_show`. Check actual runtime composition with `agent_capabilities`.
4. Read with `agent_inspect` or `agent_execute {mode:"read",code}`.
5. Stage edits with `agent_execute {mode:"write",code}`. Successful execution does **not** publish changes.
6. Inspect, export or `agent_screenshot` the staged result.
7. `agent_runtime_commit`: only `confirmed` and `nothing-to-commit` mean completion. For `pull-required`, pull, review and retry. For `unknown`, retry commit on the same runtime: a durable receipt prevents duplication. Further writes are blocked while outcome is uncertain. A merge that violates model invariants reports `conflict` and retains the previous staging.
8. Close. Pending state remains in SQLite; its owner can resume with `agent_runtime_open {documentId,resumeRuntimeId}`.

`presence_set` publishes the agent's name/range/caret. Refresh during long work; presence expires after 60 seconds. Runtime/resources are private to the authenticated actor. Document roles are checked again for every operation. A draft document ID targets an isolated worktree; `document_draft` handles review/merge.

### Sheets Facade example

```json
{
  "runtimeId": "RUNTIME_ID",
  "mode": "write",
  "code": "const s=workbook.getActiveSheet();s.getRange('A1:B3').setValues([['Metric','Value'],['Input',7],['Result','=B2*6']]);s.getRange('A1:B1').setFontWeight('bold');return s.getRange('B3').getFormula();"
}
```

Formula results are readable before commit. Installed public content Facades cover formatting, sheets/rows/columns, tables, sorting, filters, validation, conditional formatting, links and drawings.

### Docs Facade example

```json
{
  "runtimeId": "RUNTIME_ID",
  "mode": "write",
  "code": "document.insertText(0,'Agent introduction. ');document.findParagraphByText('Agent introduction.').getTextRange().setTextStyle({bl:1,fs:18});"
}
```

Native Doc Facades handle text, paragraphs, styles, sections, headers/footers and images. Traditional-only operations require that document flavor; the native API rejects them for Modern Docs.

## MCP surface

| Group         | Tools                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Runtime       | `agent_runtime_open/state/pull/commit/export/discard/close` (separate tools with these suffixes) |
| Execution     | `agent_execute`, `agent_capabilities`                                                            |
| Discovery     | `agent_api_find`, `agent_api_show`                                                               |
| Inspection    | `agent_inspect`                                                                                  |
| Rendering     | `agent_screenshot`                                                                               |
| Resources     | `agent_resource_import/search/catalog/resolve/export/delete` (separate tools)                    |
| Configuration | `agent_config`                                                                                   |

Existing document CRUD/import/export/history/permissions, presence, atomic `document_edit` and draft review tools remain. Standard MCP `tools/list` returns exact schemas and descriptions.

### Execution

Bindings: `univerAPI`, `workbook` (Sheets), `document` (Docs), `resources`. Supports `await`, JSON return values, enums, native asynchronous methods and callbacks. Program-created subscriptions are disposed at its end.

QuickJS WASM runs inside a separate Node process. No `process`, `require`, filesystem, module imports, host constructor/prototype access or ambient network APIs. Read mode guards native mutations and verifies the resulting snapshot. Failed/timed out execution rolls back that execution, retaining earlier staging. Lifecycle operations cannot target foreign units; same-ID/same-kind replacement is allowed only in write mode.

Offline discovery includes declarations and data types. A declaration does not imply a browser-only or uninstalled feature is operational headlessly; check `agent_capabilities`. The surface follows the installed content plugins. It does not include proprietary Pro plugins or Slide/Board/Base editors.

### Inspection

Kinds: `overview`, `workbook`, `worksheet`, `range`, `document`, `paragraph`, `features`, `search`. Sheet selectors: `name:Data`, `id:sheet-id`, `index:0` or plain ID/name. Ranges use A1 notation. Paragraphs use persistent ID or index; `segment` selects a header/footer. Results include UTF-16 positions, calculated values, resolved styles, feature data and pagination. Bounded searches report truncation.

### Screenshots

`agent_screenshot {runtimeId,sheet?,range?,pages?,scale?}` renders an explicit staged/native snapshot in an anonymous browser context, without connecting it to collaboration. Defaults: active sheet's data range or all Doc pages. Page indices are zero-based. Returns actual MCP `image` blocks plus dimensions, target, revision/generation and private resource/usage IDs.

Frozen panes are stripped on the isolated render copy to capture a continuous rectangular range. Nothing is written back. Fonts in `PIONEER_FONT_BUNDLE` load before layout. Browser remote requests are blocked: import images into the cache first.

### Resources and settings

Import bytes as base64 or a public HTTPS URL. Fetches validate/pin public DNS addresses and bound redirects, bytes and time. Private/local addresses are rejected. Catalogs are HTTPS JSON arrays of `{id,name,url,tags?,license?,attribution?}`. Search metadata, resolve/download an entry, export cached bytes, delete owned resources. SHA-256 deduplicates bytes; separate usage records preserve each rendering's current provenance.

Pass explicit owned `resourceIds` to execution. Only these are available through `resources.json/text/base64/image/size(id)`. For native image insertion use the cached data URI and BASE64 source type. Embedded image dimensions work without DOM/network access.

`agent_config` actions: `declare/get/set/reset`, isolated by caller/namespace. Declare types (`string/number/boolean/object/array`) and defaults before setting values. Rejects invalid types, undeclared/prototype keys and inconsistent defaults; persists across restarts.

## Limits and deployment

- Code 200,000 characters; JSON result 2 MB.
- QuickJS heap 64 MiB, stack 1 MiB, deadline 50–30,000 ms.
- Worker heap 128 MiB; one resident agent worker, FIFO exclusive leases per runtime, LRU, idle TTL five minutes. Crashes/timeouts invalidate workers. Staging stays in SQLite.
- Long-lived application server owns pool/render browser across stateless MCP calls; this HTTP architecture needs no separate agent daemon.
- Resource 20 MB; total execution bindings 20 MB.
- Inspection 10,000 cells; 1,000 returned search items/5,000 matches; feature payload 500 KB.
- Screenshot scale 0.25–3; 20 Doc pages; 8,192×16,000 and 20 million pixels per image, 40 million total.

One application process per installed workspace owns its SQLite/file storage. The prepared Linux payload includes all worker dependencies, QuickJS/WASM, offline reference and Chromium. The managed Node 26 runtime must provide 1 GiB for the renderer workload. No Typst compiler or Docs compilation tool is shipped by Sheets.

## Verification

`bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e` exercise SQLite, actual workers, HTTP MCP and opaque App views without running Pioneer itself. See docs/VALIDATION.md in the repository for the exact tested boundary and remaining host qualification.

Files and Office Exchange are available to agents through the same MCP server and ACLs. Pass file IDs in `agent_execute.resourceIds`. See [FILES-EXCHANGE.md](FILES-EXCHANGE.md) for uploads, pending-revision exports and conversions.
