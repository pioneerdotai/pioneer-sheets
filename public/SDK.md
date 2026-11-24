# Pioneer Sheets SDK · installed application

Sheets runs only as a managed Pioneer application. Pioneer owns installation, execution credentials, user/agent identity and the model/tool loop. Sheets owns spreadsheet execution, SQLite, files, Yjs collaboration and MCP tools. There is no application login, name/password form, bearer token creation or browser-storage dependency.

## Platform adapter

Use `@pioneercompany/app-sdk@0.2.0` client/server. The backend validates the existing execution nonce before using `Pioneer-App-User-Id`. MCP tool calls also require `Pioneer-App-Agent-Id`; `Pioneer-App-Agent-Name` is optional. Gateway must supply these from the calling principal/agent. The bootstrap never reaches the browser.

`GET api/context` returns the current Pioneer user projection. `POST api/session` does not exist. All HTTP requests, including readiness, assets, files and the internal renderer, require the execution credential. Readiness and static MCP discovery do not require a user. Browser requests rely on the admitted view proxy; they send no bearer credentials.

The authenticated HTML base and App SDK construct contained HTTP/WS paths. The opaque App frame uses no localStorage, sessionStorage or IndexedDB. Univer preferences use an injected per-view memory service. The editor is enabled after native controllers reach Rendered and while its collaboration connection is active.

## Storage and server ownership

One backend per installed application/workspace. `APP_DATA/sheets.sqlite` uses Drizzle/libSQL; immutable blobs, uploads and signing key live in `APP_DATA/sheets.sqlite.files`. The installation owns the workspace boundary. Documents are shared with workspace users; explicit per-document roles restrict editors/viewers and owner-only operations.

Document creation, metadata, revisions, draft review, receipts, resources, agent staging and conversion jobs are durable. Authors and conversion-job callers are persisted only as `{id, type}` references, where type is `human` or `agent`. Names, colors and avatars are not historical identity data. Conversion jobs resume from the caller reference without a login session. Files are pinned by live document/history/draft/runtime/job references.

## MCP

MCP servers are declared in `.mcp.json`, referenced by `app.json` through `mcp.config`. Sheets declares `"type": "pioneer"` with `"url": "http://pioneer-app-runtime.internal/api/mcp"`. Gateway resolves the declaring App's current backend through the existing HTTP MCP transport. Discovery reads only the static tool catalog under execution authority; each tool callback authenticates the admitted user and agent before reading or changing data. The implementation has not been compiled or integration-tested; see `docs/PIONEER-REQUIRED-CHANGES.md`.

Main tools:

- `documents_list`, `document_create`, `document_read`, `document_inspect`, `document_edit`, `document_manage`;
- `document_draft`, `document_restore_version`, `document_permissions`, `presence_set`;
- `agent_runtime_open/state/pull/commit/export/discard/close`, `agent_execute`, `agent_capabilities`;
- `agent_api_find/show`, `agent_inspect`, `agent_screenshot`, resource/catalog/config tools;
- `files_list/info/manage/attach`, `files_upload_start/append/status/finish/cancel`, `files_put/read/download`;
- `exchange_formats/create/get/list/manage`.

Read schemas from MCP rather than inferring arguments from this summary. Agent operations use the same document/file permissions and persistence as users. Draft approval belongs to the source document's owner. A human browser cannot become an agent by sending a name or a token.

## Collaboration and saving

Yjs state is persisted before ACK. Each view retains unacknowledged updates in memory and retries the same request IDs after reconnect. WebSocket framing keeps every message below the Gateway's 1 MiB limit and bounds reassembly. File uploads use 1 MiB chunks with the acknowledged offset in the query, compatible with the current proxy header allowlist.

No offline-tab recovery is promised without browser storage. Editing pauses offline, and app close/navigation waits for confirmed save. Forced process/view termination may discard input that never reached a server commit. Ordinary remote edits preserve the live editor, input and selection; structural changes may recreate its unit.

## Office and native files

Import XLSX/CSV/TSV/JSON; export XLSX/CSV/TSV/JSON/PDF. CSV cells remain literal strings. Review conversion diagnostics; `allowLossy` must be explicit. The server pins an exact revision or staged runtime before starting export.

An App sandbox cannot open a save dialog itself. The native download adapter requests a contained `api/files/<id>/content` path from its parent and fails explicitly if the host bridge is unavailable. Agents read bytes through `files_read`; they do not need browser download capabilities.

## Packaging and verification

Linux payloads include Nitro output, bundled Node workers, QuickJS/WASM, offline API JSON, Chromium, its library/font closure and notices. They run in the managed Node 26 distroless runtime without a shell or package manager. Data is written only under APP_DATA (and ephemeral /tmp).

See the repository README for build commands and `docs/VALIDATION.md` for measured results. Real Pioneer installation is a separate qualification step after the documented host binding/download/package/resource changes.
