# Files and Office Exchange

Sheets runs inside Pioneer: TanStack Start/Nitro, HTTP MCP, SQLite/Drizzle and local storage in APP_DATA. Pioneer provides identity; the app has no separate sign-in.

## Using the interface

- In the document library, click **Open file**. Import creates a new editable document.
- In a document, choose **Download as…**. Export waits for saving and captures a specific server revision.
- **Files → Files**: search, upload, download, versions, rename, attachments, trash and restore. A new file version does not change an image or attachment already inserted into a document.
- **Files → Conversions**: queue, results, diagnostics, cancel, retry and delete job records. Export with simplifications requires an explicit action after strict export is rejected.
- History, drafts and unfinished agent runtimes retain references to the required file versions. Permanent deletion is blocked while these references or jobs exist.

## Formats

| Application | Import               | Export                    |
| ----------- | -------------------- | ------------------------- |
| Sheets      | XLSX, CSV, TSV, JSON | XLSX, CSV, TSV, JSON, PDF |

CSV/TSV values are imported as literal text: `=2+2` does not become a formula. Create formulas using the editor or Facade API. CSV/TSV export the selected sheet; `options.sheet` accepts its ID or name. UTF-8 and UTF-16 with BOM, custom delimiters and explicit encoding selection are supported.

JSON is a portable package: `{pioneerOffice:1,kind,snapshot,files}`. It includes images, attachments and source Office files with SHA-256 checksums. Import into another database replaces references with new local IDs. Plain Univer JSON snapshots can also be imported; external file references must be accessible to the current participant.

XLSX supports values, formulas/results, rich text, fonts/fills/borders, row/column sizes and visibility, merged cells, frozen panes, number/date formats, links, data validation, tables, filters, supported conditional formatting, images and named ranges.

DOCX supports text and styles, headings/lists, links/bookmarks/fields, tables, images, sections/page sizes/margins, headers/footers and footnote stories. OMML equations are imported with MathML and an image for the editor; the source OMML is retained for DOCX export. This is not a Word equation editor.

PDF is rendered by local Chromium with text and images. In Docs, headers and footers repeat on each page; footnote stories appear after the main text in HTML/PDF. In Sheets, sheets are printed separately and wide tables are scaled to fit the page width. This is the app's print layout, not Microsoft Office's pagination engine.

## Source preservation and compatibility limits

The source file remains a separate immutable version. Exporting an unchanged document to its source format returns the original bytes. The DOCX adapter also preserves unchanged source XML paragraphs when other parts are edited.

Complex charts, pivot tables, macros/ActiveX/OLE, external workbooks, some conditional formats and Word-specific elements do not have a universal editable representation. They are diagnosed and retained in the source. Export of a modified XLSX or an opaque modified DOCX fragment is blocked when it cannot be done safely. `allowLossy:true` permits a simplified result with diagnostics. Macros are never executed. PDF import, legacy binary DOC/XLS and exact reproduction of every Microsoft Office layout are not supported.

HTML/Markdown/TXT intentionally omit some Office features. TXT omits formatting and images; Markdown omits exact typography and pagination. Use JSON to transfer the complete application model.

## MCP and HTTP

Endpoint: `/api/mcp` of the managed execution. Gateway supplies the execution credential and user/agent identity; the app has no separate bearer token. MCP uses the same permissions and data as the interface.

Main tools:

- `files_list`, `files_info`, `files_manage`, `files_attach`;
- `files_upload_start`, `files_upload_append`, `files_upload_status`, `files_upload_finish`, `files_upload_cancel`;
- `files_put` for small files, `files_read` for byte chunks and `files_download` for a relative download URL;
- `exchange_formats`, `exchange_create`, `exchange_get`, `exchange_list`, `exchange_manage`.

Upload:

1. `files_upload_start({name,size,mime,checksum?,requestId?})` returns uploadId and the maximum chunk size.
2. `files_upload_append({uploadId,offset,base64})`. The browser adapter uses `PATCH api/files/uploads/:id?offset=N` with a binary body and no extra auth/offset headers. After an interruption, request the confirmed offset.
3. `files_upload_finish` validates size/SHA-256 and publishes the version idempotently.

Conversion:
`exchange_create({operation:"import",format:"xlsx",fileId,fileVersion,requestId})`.
Poll `exchange_get({jobId})` until `succeeded` / `failed` / `cancelled`.

Export:
`exchange_create({operation:"export",format:"xlsx",documentId,revision,options})`.
Pass `runtimeId` instead of documentId to export that agent's pending edits captured when the job was created, without publishing them to the main document.

File IDs can be passed in `agent_execute.resourceIds`. The sandbox provides `resources.text(id)`, `resources.json(id)`, `resources.image(id)` and `resources.size(id)`. File ACLs apply; missing or private AI resources do not become accessible through this bridge.

Download: `GET/HEAD /api/files/:id/content?version=N`, including a single Range, ETag, If-Range and a UTF-8 file name. `files_download` returns an ordinary app-relative URL with a fixed version. Pioneer supplies authorization and the current identity; the app has no separate download tokens or keys. Agents read bytes through `files_read`; the browser requests Pioneer's native download bridge. Direct downloads from an opaque iframe are unavailable.

HTTP JSON endpoints are under `/api/files` and `/api/exchange`; MCP uses the same services.

## Data, runtime and limits

- Database: `APP_DATA/sheets.sqlite`.
- Files: `APP_DATA/sheets.sqlite.files`. Each installation has its own APP_DATA.
- The file directory contains SHA-256-addressed blobs, temporary uploads and a private URL-signing key.
- For a consistent backup, stop the app and copy SQLite together with the file directory. Copying SQLite alone does not preserve binary objects.
- Maximum file size: 100 MiB; chunk size: 1 MiB; unfinished upload lifetime: 24 hours. One conversion runs at a time, with up to 120 seconds per worker operation and 128 MiB of JS heap per worker.
- Office ZIP archives are checked before extraction: paths, part counts/sizes, encryption and DTD/entities. Spreadsheets and PDFs have separate cell-count limits.
- The queue is stored in SQLite. After a restart, `running` jobs are requeued; requestId and deterministic document creation prevent duplicates.
- File cleanup runs at startup and hourly. Only physical objects without live versions are removed, after a 24-hour grace period.
- A database/file directory requires one server process. Queue coordination across multiple instances is not implemented.
- User and agent identities come only from verified Pioneer context. Jobs retain the originating platform actor for recovery.
- PDF/HTML conversion requires Chromium from Playwright or `OFFICE_BROWSER_EXECUTABLE`. `OFFICE_RENDER_ORIGIN` must point to this app; it defaults to PORT.
- The installed payload contains `.output`, both worker bundles, QuickJS/WASM dependencies, Chromium and its libraries. It is built before installation. Rendering requires 1 GiB RAM.

## Verification

`bun run typecheck`
`bun test --timeout 30000 tests/sdk.test.ts tests/agent-*.test.ts tests/files.test.ts tests/exchange.test.ts`
`bun run test:e2e`
`bun run test:restart`

Independent Office file validation uses Python:
`python3 -m venv .agent/office-python`
`.agent/office-python/bin/pip install python-docx==1.2.0 openpyxl==3.1.5 pypdf==6.1.1 Pillow==12.0.0`

Set `OFFICE_PYTHON` to use another interpreter. The application does not use Python; only independent tests do. Fixtures and their reproducible generator are in `tests/fixtures/office`. Checks cover reading results with independent libraries, transfer between two databases, pending-export privacy, MCP, two browsers and backend restart. See docs/VALIDATION.md for the installed validation boundary.
