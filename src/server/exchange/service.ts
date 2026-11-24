import { runJob } from "./executor";
import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { getFileService, type FileService } from "../files/service";
import { collectFileReferences } from "../../shared/files";
import { ServiceError } from "../documents/error";
import { OfficeService } from "../documents/service";
import { getAgentManager } from "../agent/manager";
import { getRenderRuntime, type RenderRuntime } from "../agent/rendering";
import { RuntimePool } from "../agent/pool";
import { identityReference, type IdentityReference } from "../../shared/types";
import {
  formats,
  type ExchangeFormat,
  type CodecOptions,
} from "../../shared/exchange";
import { exchangeJobs } from "../db/schema/exchange";

type Job = typeof exchangeJobs.$inferSelect;

export class ExchangeService {
  ready: Promise<void>;
  pool: RuntimePool;
  private files: FileService;
  private draining = false;
  private stopped = false;
  private active = new Map<string, () => void>();
  constructor(
    public service: OfficeService,
    public renderer: RenderRuntime = getRenderRuntime(),
    options: { workerPath?: string; timeoutMs?: number } = {},
  ) {
    this.files = getFileService(service);
    this.pool = new RuntimePool({
      maxEntries: 1,
      idleTtlMs: 60000,
      workerPath: options.workerPath ?? ".agent/exchange-worker.mjs",
      timeoutMs: options.timeoutMs ?? 120000,
    });
    allServices.add(this);
    this.ready = this.initialize();
  }
  private async initialize() {
    await this.files.ready;
    await this.service.storage.write(() =>
      this.service.storage.db
        .update(exchangeJobs)
        .set({
          status: "queued",
          updatedAt: Date.now(),
          error: "Resumed after process interruption",
        })
        .where(eq(exchangeJobs.status, "running")),
    );
    queueMicrotask(() => void this.drain());
  }
  async create(
    who: IdentityReference,
    input: {
      operation: "import" | "export";
      format: ExchangeFormat;
      fileId?: string;
      fileVersion?: number;
      documentId?: string;
      revision?: number;
      runtimeId?: string;
      options?: CodecOptions;
      requestId?: string;
    },
  ) {
    await this.ready;
    if (input.options?.title && input.options.title.length > 200)
      throw new ServiceError(400, "TITLE_TOO_LONG");
    if (
      input.revision !== undefined &&
      (!Number.isSafeInteger(input.revision) || input.revision < 0)
    )
      throw new ServiceError(400, "INVALID_REVISION");
    if (
      !["import", "export"].includes(input.operation) ||
      !formats[this.service.kind][input.operation].includes(input.format)
    )
      throw new ServiceError(400, "EXCHANGE_FORMAT_NOT_SUPPORTED");
    return this.service.locked(
      "exchange-create:" + who.id + ":" + (input.requestId ?? randomUUID()),
      async () => {
        if (input.requestId) {
          const old = (
            await this.service.storage.db
              .select()
              .from(exchangeJobs)
              .where(
                and(
                  eq(exchangeJobs.ownerId, who.id),
                  eq(exchangeJobs.requestKey, input.requestId),
                ),
              )
          )[0];
          if (old) return this.describe(old);
        }
        const payload: any = {
            kind: this.service.kind,
            actor: identityReference(who),
            options: input.options ?? {},
          },
          refs: Array<{ fileId: string; version: number }> = [];
        if (input.operation === "import") {
          if (!input.fileId)
            throw new ServiceError(400, "SOURCE_FILE_REQUIRED");
          const file = await this.files.require(
            input.fileId,
            who,
            false,
            input.fileVersion,
          );
          payload.file = {
            id: file.id,
            version: file.version,
            name: file.name,
          };
          refs.push({ fileId: file.id, version: file.version });
        } else {
          if (!!input.documentId === !!input.runtimeId)
            throw new ServiceError(400, "SELECT_DOCUMENT_OR_RUNTIME");
          if (input.runtimeId) {
            const exported = await getAgentManager(this.service).export(
              input.runtimeId,
              who,
            );
            payload.snapshot = exported.snapshot;
            payload.target = { ...exported.state, runtimeId: input.runtimeId };
          } else {
            const doc = await this.service.get(input.documentId!, who);
            let data = doc.snapshot,
              revision = doc.revision;
            if (input.revision !== undefined) {
              data = await this.service.version(doc.id, input.revision, who);
              revision = input.revision;
            }
            payload.snapshot = data;
            payload.target = { documentId: doc.id, revision, title: doc.title };
          }
          refs.push(...collectFileReferences(payload.snapshot));
        }
        const id = randomUUID(),
          now = Date.now(),
          job: Job = {
            id,
            ownerId: who.id,
            operation: input.operation,
            format: input.format,
            status: "queued",
            payload: JSON.stringify(payload),
            result: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            attempt: 0,
            requestKey: input.requestId?.slice(0, 200) ?? null,
            cancelled: false,
          };
        await this.service.storage.transaction(async (tx) => {
          await this.files.leaseInTransaction(tx, who, refs, "exchange", id);
          await tx.insert(exchangeJobs).values(job);
        });
        void this.drain();
        return this.describe(job);
      },
    );
  }
  private describe(job: Job) {
    const payload = JSON.parse(job.payload);
    return {
      id: job.id,
      ownerId: job.ownerId,
      operation: job.operation,
      format: job.format,
      status: job.status,
      attempt: job.attempt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      target: payload.target ?? null,
      sourceFile: payload.file ?? null,
      result: job.result ? JSON.parse(job.result) : null,
      error: job.error,
      cancelled: job.cancelled,
    };
  }
  async get(id: string, who: IdentityReference) {
    await this.ready;
    const job = (
      await this.service.storage.db
        .select()
        .from(exchangeJobs)
        .where(and(eq(exchangeJobs.id, id), eq(exchangeJobs.ownerId, who.id)))
    )[0];
    if (!job) throw new ServiceError(404, "EXCHANGE_JOB_NOT_FOUND");
    return this.describe(job);
  }
  async list(who: IdentityReference, offset = 0, limit = 50) {
    const size = Math.max(1, Math.min(100, limit));
    await this.ready;
    const items = await this.service.storage.db
      .select()
      .from(exchangeJobs)
      .where(eq(exchangeJobs.ownerId, who.id))
      .orderBy(desc(exchangeJobs.createdAt))
      .limit(size + 1)
      .offset(offset);
    return {
      items: items.slice(0, size).map((j) => this.describe(j)),
      offset,
      hasMore: items.length > size,
    };
  }
  async manage(
    id: string,
    who: IdentityReference,
    action: "cancel" | "retry" | "purge",
  ) {
    const job = await this.get(id, who);
    if (action === "retry") {
      if (!["failed", "cancelled"].includes(job.status))
        throw new ServiceError(409, "JOB_NOT_RETRYABLE");
      await this.service.storage.write(() =>
        this.service.storage.db
          .update(exchangeJobs)
          .set({
            status: "queued",
            cancelled: false,
            error: null,
            updatedAt: Date.now(),
          })
          .where(eq(exchangeJobs.id, id)),
      );
      void this.drain();
      return this.get(id, who);
    }
    if (action === "cancel")
      return this.service.locked("exchange-finalize:" + id, async () => {
        const latest = await this.get(id, who);
        if (["succeeded", "failed", "cancelled"].includes(latest.status))
          return latest;
        await this.service.storage.write(() =>
          this.service.storage.db
            .update(exchangeJobs)
            .set({
              cancelled: true,
              status: "cancelled",
              updatedAt: Date.now(),
            })
            .where(eq(exchangeJobs.id, id)),
        );
        this.active.get(id)?.();
        return this.get(id, who);
      });
    if (job.status === "running" || job.status === "queued")
      throw new ServiceError(409, "CANCEL_JOB_BEFORE_PURGE");
    await this.files.releaseLease("exchange", id);
    await this.files.releaseLease("exchange-result", id);
    await this.service.storage.write(() =>
      this.service.storage.db
        .delete(exchangeJobs)
        .where(eq(exchangeJobs.id, id)),
    );
    return { purged: true };
  }
  private async cancelled(id: string) {
    if (this.stopped) throw new Error("EXCHANGE_STOPPED");
    const row = (
      await this.service.storage.db
        .select()
        .from(exchangeJobs)
        .where(eq(exchangeJobs.id, id))
    )[0];
    if (!row || row.cancelled) throw new Error("EXCHANGE_CANCELLED");
  }
  private async drain() {
    await this.ready;
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (!this.stopped) {
        const rows = await this.service.storage.db
          .select()
          .from(exchangeJobs)
          .where(eq(exchangeJobs.status, "queued"))
          .orderBy(exchangeJobs.createdAt)
          .limit(2);
        if (!rows.length) break;
        await Promise.all(rows.map((job) => this.run(job)));
      }
    } catch (error) {
      if (!this.stopped)
        console.error(
          "Exchange queue:",
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      this.draining = false;
    }
  }

  private run(job: Job) {
    return runJob(
      {
        service: this.service,
        files: this.files,
        renderer: this.renderer,
        pool: this.pool,
        active: this.active,
        isStopped: () => this.stopped,
        cancelled: (id) => this.cancelled(id),
      },
      job,
    );
  }
  shutdown() {
    this.stopped = true;
    this.pool.close();
    allServices.delete(this);
  }
}

const allServices = new Set<ExchangeService>(),
  services = new WeakMap<OfficeService, ExchangeService>();

export function getExchangeService(service: OfficeService) {
  let exchange = services.get(service);
  if (!exchange) {
    exchange = new ExchangeService(service);
    services.set(service, exchange);
  }
  return exchange;
}

export function shutdownExchangeServices() {
  for (const service of allServices) service.shutdown();
}
