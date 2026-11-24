import { z } from "zod";
import type { OfficeService } from "../documents/service";
import type { RegisterTool } from "../mcp/types";
import { getFileService } from "./service";
import { getExchangeService } from "../exchange/service";
import { formats } from "../../shared/exchange";

export function registerFileTools(tool: RegisterTool, service: OfficeService) {
  const files = getFileService(service),
    exchange = getExchangeService(service),
    id = z.string().uuid(),
    version = z.number().int().positive().optional();
  tool(
    "files_list",
    "List accessible persistent files. Immutable versions and document ACLs apply.",
    {
      query: z.string().optional(),
      trash: z.boolean().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    (a, who) => files.list(who, a.query, a.trash, a.offset),
  );
  tool(
    "files_info",
    "Read file metadata, versions and document references. A fileId can be bound through agent_execute.resourceIds; resources.text/json/image expose its bytes in the sandbox.",
    { fileId: id, version },
    async (a, who) => ({
      file: await files.require(a.fileId, who, false, a.version),
      versions: await files.versions(a.fileId, who),
      references: await files.references(a.fileId, who),
    }),
  );
  tool(
    "files_upload_start",
    "Start a resumable binary upload. Use files_upload_append with the acknowledged offset and chunks at most maxChunkBytes; then files_upload_finish. Does not expose local paths.",
    {
      name: z.string(),
      size: z.number().int().nonnegative().max(104857600),
      mime: z.string().optional(),
      fileId: id.optional(),
      checksum: z.string().optional(),
      requestId: z.string().max(200).optional(),
    },
    (a, who) => files.begin(who, a),
  );
  tool(
    "files_upload_append",
    "Append a base64 chunk to a resumable upload at the acknowledged byte offset. Retry an ambiguous chunk at the same offset; discover received with files_upload_status.",
    {
      uploadId: id,
      offset: z.number().int().nonnegative(),
      base64: z.string().max(1400000),
    },
    async (a, who) => {
      const bytes = Buffer.from(a.base64, "base64");
      if (bytes.length > 1024 * 1024) throw new Error("UPLOAD_CHUNK_TOO_LARGE");
      return files.append(
        a.uploadId,
        who,
        a.offset,
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      );
    },
  );
  tool(
    "files_read",
    "Read up to 1 MiB of immutable file content as base64 through MCP; no browser token or direct backend URL is needed.",
    {
      fileId: id,
      version,
      offset: z.number().int().nonnegative().default(0),
      length: z.number().int().min(1).max(1048576).default(1048576),
    },
    async (a, who) => {
      const file = await files.require(a.fileId, who, false, a.version);
      if (file.size === 0 && a.offset === 0)
        return { file, offset: 0, nextOffset: 0, base64: "" };
      const response = await files.response(
        a.fileId,
        who,
        new Request("http://app.internal/", {
          headers: { Range: `bytes=${a.offset}-${a.offset + a.length - 1}` },
        }),
        a.version,
      );
      if (!response.ok) throw new Error("FILE_RANGE_NOT_SATISFIABLE");
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        file,
        offset: a.offset,
        nextOffset: a.offset + bytes.length,
        base64: bytes.toString("base64"),
      };
    },
  );
  tool(
    "files_upload_status",
    "Recover an acknowledged upload offset after interruption.",
    { uploadId: id },
    (a, who) => files.uploadStatus(a.uploadId, who),
  );
  tool(
    "files_upload_finish",
    "Verify bytes and checksum and publish an immutable file version, idempotently.",
    { uploadId: id },
    (a, who) => files.finish(a.uploadId, who),
  );
  tool(
    "files_upload_cancel",
    "Cancel an unfinished upload and remove temporary bytes.",
    { uploadId: id },
    (a, who) => files.cancelUpload(a.uploadId, who),
  );
  tool(
    "files_put",
    "Upload small generated files as base64 (up to 1 MiB). For larger files use files_upload_start/append/finish.",
    {
      name: z.string(),
      mime: z.string(),
      base64: z.string().max(1400000),
      fileId: id.optional(),
      requestId: z.string().max(200).optional(),
    },
    (a, who) => files.put(who, { ...a, data: Buffer.from(a.base64, "base64") }),
  );
  tool(
    "files_download",
    "Return an App-relative download path. Pioneer authentication and current file permissions apply on GET/HEAD; byte ranges, immutable versions and ETag are supported.",
    { fileId: id, version },
    async (a, who) => {
      const file = await files.require(a.fileId, who, false, a.version);
      return {
        fileId: file.id,
        version: file.version,
        url: `api/files/${file.id}/content?version=${file.version}`,
      };
    },
  );
  tool(
    "files_manage",
    "Rename, trash, restore or permanently purge a file. Purge is blocked by document/history/draft/runtime/job references.",
    {
      fileId: id,
      action: z.enum(["rename", "trash", "restore", "purge"]),
      name: z.string().optional(),
    },
    (a, who) => files.manage(a.fileId, who, a.action, a.name),
  );
  tool(
    "files_attach",
    "Attach or detach an immutable file version to a document. Creates a normal collaborative document revision.",
    { fileId: id, version, documentId: id, remove: z.boolean().optional() },
    (a, who) =>
      files.attach(
        a.documentId,
        who,
        { fileId: a.fileId, version: a.version },
        a.remove,
      ),
  );
  tool(
    "exchange_formats",
    "Discover supported import/export formats for this application.",
    {},
    async () => formats[service.kind],
  );
  tool(
    "exchange_create",
    "Queue durable import or export. Import creates a document from an immutable file version. Export captures a confirmed document revision OR an agent runtime including staged edits, never commits it. Unsupported feature diagnostics returned by exchange_get; allowLossy must be explicit.",
    {
      operation: z.enum(["import", "export"]),
      format: z.enum([
        "xlsx",
        "csv",
        "tsv",
        "docx",
        "html",
        "md",
        "txt",
        "json",
        "pdf",
      ]),
      fileId: id.optional(),
      fileVersion: version,
      documentId: id.optional(),
      revision: z.number().int().nonnegative().optional(),
      runtimeId: id.optional(),
      requestId: z.string().max(200).optional(),
      options: z
        .object({
          title: z.string().max(200).optional(),
          sheet: z.string().optional(),
          delimiter: z.string().max(1).optional(),
          encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]).optional(),
          formulaPolicy: z.enum(["calculate", "preserve"]).optional(),
          allowLossy: z.boolean().optional(),
        })
        .optional(),
    },
    (a, who) => exchange.create(who, a),
  );
  tool(
    "exchange_get",
    "Read persistent conversion status, diagnostics, output document or downloadable file. Poll until succeeded/failed/cancelled.",
    { jobId: id },
    (a, who) => exchange.get(a.jobId, who),
  );
  tool(
    "exchange_list",
    "List this actor’s conversion jobs, including jobs recovered after restart.",
    { offset: z.number().int().nonnegative().optional() },
    (a, who) => exchange.list(who, a.offset),
  );
  tool(
    "exchange_manage",
    "Cancel, retry a failed/cancelled conversion or purge its job record and release file retention leases.",
    { jobId: id, action: z.enum(["cancel", "retry", "purge"]) },
    (a, who) => exchange.manage(a.jobId, who, a.action),
  );
}
