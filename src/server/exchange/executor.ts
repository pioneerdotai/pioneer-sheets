import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MAX_FILE_BYTES } from "../files/validation";
import {
  collectFileReferences,
  fileSource,
  parseFileSource,
} from "../../shared/files";
import { getAgentManager } from "../agent/manager";
import { type Snapshot } from "../../shared/documents/model";
import { identityReference, type IdentityReference } from "../../shared/types";
import {
  mimeTypes,
  type ExchangeFormat,
  type CodecOptions,
} from "../../shared/exchange";
import { exchangeJobs } from "../db/schema/exchange";
import { exchangeMetadata, setExchangeMetadata, fingerprint } from "./package";
import { recordParagraphFingerprints } from "./docx";
import {
  externalize,
  remap,
  type AssetContext,
} from "./assets";
import type { RuntimePool } from "../agent/pool";

interface ExecutionContext extends AssetContext {
  pool: RuntimePool;
  active: Map<string, () => void>;
  isStopped: () => boolean;
  cancelled: (id: string) => Promise<void>;
}

type Job = typeof exchangeJobs.$inferSelect;

export async function runJob(context: ExecutionContext, job: Job) {
  const key = job.id;
  context.active.set(job.id, () => context.pool.invalidate(key));
  try {
    const started = await context.service.storage.write(() =>
      context.service.storage.db
        .update(exchangeJobs)
        .set({
          status: "running",
          attempt: job.attempt + 1,
          error: null,
          updatedAt: Date.now(),
        })
        .where(
          and(eq(exchangeJobs.id, job.id), eq(exchangeJobs.status, "queued")),
        )
        .returning({ id: exchangeJobs.id }),
    );
    if (!started.length) return;
    const payload = JSON.parse(job.payload),
      actor = payload.actor,
      options: CodecOptions = payload.options ?? {};
    if (
      !actor ||
      actor.id !== job.ownerId ||
      !["human", "agent"].includes(actor.type)
    )
      throw new Error("JOB_PIONEER_IDENTITY_MISSING");
    const who: IdentityReference = identityReference(actor);
    await context.cancelled(job.id);
    let result: any, finalize: (() => Promise<any>) | undefined;
    if (job.operation === "import") {
      const file = await context.files.read(
          payload.file.id,
          who,
          payload.file.version,
        ),
        converted = await context.pool.lease(key, (rpc) =>
          rpc("import", {
            kind: context.service.kind,
            actor: identityReference(who),
            format: job.format,
            base64: file.data.toString("base64"),
            options: {
              ...options,
              title: options.title ?? file.name.replace(/\.[^.]+$/, ""),
            },
          }),
        );
      const drawings = Object.values(converted.snapshot?.drawings ?? {}) as {
        source?: string;
      }[];
      if (
        converted.html ||
        drawings.some((drawing) => drawing.source?.startsWith("pioneer-math:"))
      )
        throw new Error("DOC_RENDER_NOT_AVAILABLE_IN_SHEETS");
      if (converted.bundleFiles?.length) {
        const mappings = new Map<string, string>();
        for (const entry of converted.bundleFiles) {
          if (
            !parseFileSource(entry.source) ||
            typeof entry.base64 !== "string"
          )
            throw new Error("INVALID_NATIVE_FILE_BUNDLE");
          const data = Buffer.from(entry.base64, "base64");
          if (
            entry.hash &&
            createHash("sha256").update(data).digest("hex") !== entry.hash
          )
            throw new Error("BUNDLE_CHECKSUM_MISMATCH");
          const f = await context.files.put(who, {
            name: entry.name ?? "Bundled file",
            mime: entry.mime ?? "application/octet-stream",
            data,
            requestId: "bundle:" + job.id + ":" + entry.source,
          });
          mappings.set(entry.source, fileSource(f.id, f.version));
        }
        remap(converted.snapshot, mappings);
      }
      converted.snapshot = await externalize(
        context,
        converted.snapshot,
        who,
        job.id,
      );
      const normalized = await context.pool.lease(key, (rpc) =>
        rpc("normalize", {
          kind: context.service.kind,
          actor: identityReference(who),
          snapshot: converted.snapshot,
          extras: converted.extras,
        }),
      );
      let data = normalized.snapshot;
      const existingMeta = exchangeMetadata(data);
      if (job.format !== "json") {
        const metadata = {
          format: job.format,
          source: { fileId: file.id, version: file.version },
          diagnostics: converted.diagnostics,
          unsupported: converted.unsupported ?? [],
          extras: normalized.extras ?? {},
          fingerprint: fingerprint(data),
        };
        setExchangeMetadata(data, metadata);
      } else if (existingMeta) {
        existingMeta.fingerprint = fingerprint(data);
        if (context.service.kind === "doc")
          recordParagraphFingerprints(data, existingMeta.extras ?? {});
        setExchangeMetadata(data, existingMeta);
      }
      finalize = async () => {
        const document = await context.service.create(
          who,
          options.title ?? data.name ?? data.title,
          data,
          "exchange:" + job.id,
        );
        return {
          documentId: document.id,
          revision: document.revision,
          diagnostics: converted.diagnostics ?? [],
          sourceFile: { id: file.id, version: file.version },
        };
      };
    } else {
      const data: Snapshot = payload.snapshot;
      if (payload.target.documentId)
        await context.service.require(payload.target.documentId, who);
      else
        await getAgentManager(context.service).state(
          payload.target.runtimeId,
          who,
        );
      const meta = exchangeMetadata(data);
      let original: Buffer | undefined;
      if (meta?.source?.fileId) {
        original = (
          await context.files.read(meta.source.fileId, who, meta.source.version)
        ).data;
      }
      let exported: any;
      if (
        meta?.format === job.format &&
        original &&
        meta.fingerprint === fingerprint(data)
      )
        exported = {
          base64: original.toString("base64"),
          mime: mimeTypes[job.format as ExchangeFormat],
          diagnostics: [
            {
              severity: "info",
              code: "EXACT_ORIGINAL",
              message: "Unmodified source returned byte-for-byte",
            },
          ],
        };
      else if (job.format === "json") {
        const bundleFiles = [];
        let total = 0;
        for (const ref of collectFileReferences(data)) {
          const f = await context.files.read(ref.fileId, who, ref.version);
          total += f.size;
          if (total > 65_000_000) throw new Error("NATIVE_BUNDLE_SIZE_LIMIT");
          bundleFiles.push({
            source: fileSource(f.id, f.version),
            name: f.name,
            mime: f.mime,
            hash: f.hash,
            base64: f.data.toString("base64"),
          });
        }
        exported = {
          base64: Buffer.from(
            JSON.stringify({
              pioneerOffice: 1,
              kind: context.service.kind,
              actor: identityReference(who),
              snapshot: data,
              files: bundleFiles,
            }),
          ).toString("base64"),
          mime: mimeTypes.json,
          diagnostics: [],
        };
      } else {
        if (
          job.format === "docx" &&
          meta?.unsupported?.includes("DOCX_BODY_CONTENT") &&
          !options.allowLossy
        )
          throw new Error(
            "EDITED_DOCX_CONTAINS_SOURCE_ONLY_BODY_CONTENT; original file remains available",
          );
        if (
          job.format === "xlsx" &&
          meta?.unsupported?.length &&
          !options.allowLossy
        )
          throw new Error(
            "EDITED_XLSX_CONTAINS_UNSUPPORTED_FEATURES: " +
              meta.unsupported.join(", ") +
              "; original file remains available",
          );
        const materialized = await context.files.materialize(data, who);
        exported = await context.pool.lease(key, (rpc) =>
          rpc("export", {
            kind: context.service.kind,
            actor: identityReference(who),
            format: job.format,
            snapshot: materialized,
            options,
            original: original?.toString("base64"),
          }),
        );
        if (exported.html) {
          exported.base64 = (
            await context.renderer.pdf(exported.html)
          ).toString("base64");
        }
        if (options.allowLossy && meta?.unsupported?.length)
          exported.diagnostics.push({
            severity: "warning",
            code: "EXPLICIT_LOSSY_EXPORT",
            message:
              "Source-only features may be omitted: " +
              meta.unsupported.join(", "),
            preserved: true,
          });
      }
      const bytes = Buffer.from(exported.base64, "base64");
      if (bytes.length > MAX_FILE_BYTES)
        throw new Error("EXPORT_FILE_SIZE_LIMIT");
      finalize = async () => {
        const output = await context.files.put(who, {
          name:
            (options.title ?? data.name ?? data.title ?? "document") +
            "." +
            job.format,
          mime: exported.mime,
          data: bytes,
          requestId: "exchange-result:" + job.id,
        });
        await context.service.storage.transaction((tx) =>
          context.files.leaseInTransaction(
            tx,
            who,
            [{ fileId: output.id, version: output.version }],
            "exchange-result",
            job.id,
          ),
        );
        return {
          file: output,
          source: payload.target,
          diagnostics: exported.diagnostics ?? [],
        };
      };
    }
    await context.service.locked("exchange-finalize:" + job.id, async () => {
      await context.cancelled(job.id);
      result = await finalize!();
      await context.service.storage.write(() =>
        context.service.storage.db
          .update(exchangeJobs)
          .set({
            status: "succeeded",
            result: JSON.stringify(result),
            error: null,
            updatedAt: Date.now(),
          })
          .where(
            and(eq(exchangeJobs.id, job.id), eq(exchangeJobs.cancelled, false)),
          ),
      );
    });
  } catch (error) {
    if (!context.isStopped())
      await context.service.storage.write(() =>
        context.service.storage.db
          .update(exchangeJobs)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            updatedAt: Date.now(),
          })
          .where(
            and(eq(exchangeJobs.id, job.id), eq(exchangeJobs.cancelled, false)),
          ),
      );
  } finally {
    context.pool.invalidate(key);
    context.active.delete(job.id);
  }
}
