import { contentKey, type RecordState } from "./runtime-state";
import { getFileService } from "../files/service";
import { and, eq } from "drizzle-orm";
import { agentRuntimes as runtimeRows } from "../db/schema/agents";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { ServiceError } from "../documents/error";
import { OfficeService } from "../documents/service";
import type { Identity, IdentityReference } from "../../shared/types";
import {
  fromUpdate,
  snapshot,
  writeSnapshot,
  encode,
  base64,
  unbase64,
  validateSnapshot,
} from "../../shared/documents/model";
import { getAgentLibrary } from "./library";
import { RuntimePool, type WorkerCall } from "./pool";

const allPools = new Set<RuntimePool>();

const managers = new WeakMap<OfficeService, AgentManager>();

export function getAgentManager(service: OfficeService) {
  let manager = managers.get(service);
  if (!manager) {
    manager = new AgentManager(service);
    managers.set(service, manager);
  }
  return manager;
}

export class AgentManager {
  pool: RuntimePool;
  constructor(
    public service: OfficeService,
    poolOptions: ConstructorParameters<typeof RuntimePool>[0] = {},
  ) {
    this.pool = new RuntimePool(poolOptions);
    allPools.add(this.pool);
  }
  private async read(
    id: string,
    who: IdentityReference,
    allowClosed = false,
  ): Promise<RecordState> {
    const [row] = await this.service.storage.db
      .select({ data: runtimeRows.data })
      .from(runtimeRows)
      .where(and(eq(runtimeRows.id, id), eq(runtimeRows.identityId, who.id)))
      .limit(1);
    if (!row) throw new ServiceError(404, "Agent runtime not found");
    const record = JSON.parse(row.data);
    await this.service.require(record.documentId, who);
    if (record.closed && !allowClosed)
      throw new ServiceError(409, "RUNTIME_CLOSED");
    return record;
  }
  private async save(record: RecordState, who: IdentityReference) {
    record.updatedAt = Date.now();
    const files = getFileService(this.service);
    await files.ready;
    const model = fromUpdate(unbase64(record.state));
    try {
      await this.service.storage.transaction(async (tx) => {
        await files.pinInTransaction(
          tx,
          snapshot(model),
          who,
          record.documentId,
          "runtime",
          record.id,
        );
        await tx
          .insert(runtimeRows)
          .values({
            id: record.id,
            documentId: record.documentId,
            identityId: record.identityId,
            data: JSON.stringify(record),
          })
          .onConflictDoUpdate({
            target: runtimeRows.id,
            set: { data: JSON.stringify(record) },
          });
      });
    } finally {
      model.destroy();
    }
  }
  async open(documentId: string, who: Identity, resumeId?: string) {
    const current = await this.service.get(documentId, who);
    let record: RecordState;
    if (resumeId) {
      record = await this.read(resumeId, who, true);
      if (record.documentId !== documentId)
        throw new ServiceError(400, "Runtime target mismatch");
      record.closed = false;
    } else
      record = {
        id: randomUUID(),
        documentId,
        identityId: who.id,
        baseRevision: current.revision,
        baseState: current.update,
        state: current.update,
        generation: 0,
        committedGeneration: 0,
        closed: false,
        updatedAt: Date.now(),
      };
    await this.save(record, who);
    const model = fromUpdate(unbase64(record.state));
    try {
      await this.pool.lease(record.id, async (rpc, entry) => {
        const data = snapshot(model);
        await rpc("load", { kind: this.service.kind, snapshot: data });
        entry.loaded = contentKey(data);
      });
    } finally {
      model.destroy();
    }
    this.service.presence(record.documentId, who, "runtime:" + record.id);
    return this.describe(record, who);
  }
  private async describe(record: RecordState, who: IdentityReference) {
    const current = await this.service.get(record.documentId, who);
    return {
      runtimeId: record.id,
      documentId: record.documentId,
      kind: this.service.kind,
      worktree: current.draft ?? null,
      role: current.role,
      baseRevision: record.baseRevision,
      remoteRevision: current.revision,
      hasRemoteChanges: record.baseRevision !== current.revision,
      pending: record.generation > record.committedGeneration,
      connected: !record.closed,
      phase: record.closed
        ? "closed"
        : record.conflict
          ? "conflict"
          : current.role === "viewer"
            ? "read-only"
            : "active",
      conflict: record.conflict ?? null,
      generation: record.generation,
      submission: record.submission ?? null,
      pool: this.pool.stats(),
    };
  }
  async state(id: string, who: IdentityReference) {
    return this.describe(await this.read(id, who, true), who);
  }
  async execute(
    id: string,
    who: IdentityReference,
    input: {
      mode: "read" | "write";
      code: string;
      timeoutMs?: number;
      resourceIds?: string[];
    },
  ) {
    if (!["read", "write"].includes(input.mode))
      throw new ServiceError(400, "Invalid execution mode");
    return this.service.locked("agent:" + id, async () => {
      const record = await this.read(id, who);
      const current = await this.service.get(record.documentId, who);
      if (input.mode === "write" && record.conflict)
        throw new ServiceError(
          409,
          "RUNTIME_CONFLICT: pull or discard before editing",
        );
      if (
        input.mode === "write" &&
        ["unknown", "submitting"].includes(record.submission?.status ?? "")
      )
        throw new ServiceError(
          409,
          "COMMIT_OUTCOME_UNCERTAIN: retry commit before further writes",
        );
      if (input.mode === "write" && current.role === "viewer")
        throw new ServiceError(403, "RUNTIME_READ_ONLY");
      const model = fromUpdate(unbase64(record.state));
      const before = snapshot(model);
      try {
        const result = await this.pool.lease(id, async (rpc, entry) => {
          const fingerprint = contentKey(before);
          if (entry.loaded !== fingerprint) {
            await rpc("load", { kind: this.service.kind, snapshot: before });
            entry.loaded = fingerprint;
          }
          const resources: Record<string, any> = {};
          let size = 0;
          for (const resourceId of new Set(input.resourceIds ?? [])) {
            let r: { data: Buffer; mimeType: string };
            try {
              r = await getAgentLibrary(this.service).export(who, resourceId);
            } catch (error) {
              if (!(error instanceof ServiceError) || error.status !== 404)
                throw error;
              try {
                const file = await getFileService(this.service).read(
                  resourceId,
                  who,
                );
                r = { data: file.data, mimeType: file.mime };
              } catch (fileError) {
                if (
                  fileError instanceof ServiceError &&
                  fileError.status === 404
                )
                  throw error;
                throw fileError;
              }
            }
            size += r.data.length;
            if (size > 20_000_000)
              throw new ServiceError(413, "BOUND_RESOURCES_TOO_LARGE");
            resources[resourceId] = {
              mimeType: r.mimeType,
              base64: r.data.toString("base64"),
            };
          }
          const executed = await rpc("execute", { ...input, resources });
          entry.loaded = contentKey(
            input.mode === "read" ? before : executed.snapshot,
          );
          return executed;
        });
        if (input.mode === "write" && result.changed) {
          validateSnapshot(result.snapshot, this.service.kind);
          if (result.snapshot.id !== record.documentId)
            throw new ServiceError(400, "Cannot change runtime target");
          writeSnapshot(model, before, result.snapshot);
          const next = base64(encode(model));
          if (next !== record.state) {
            record.state = next;
            record.generation++;
            await this.save(record, who);
          }
        }
        return {
          value: result.value,
          mutations: result.mutations,
          committed: false,
          state: await this.describe(record, who),
        };
      } finally {
        model.destroy();
      }
    });
  }
  private withRuntime<T>(
    id: string,
    who: IdentityReference,
    read: (record: RecordState, rpc: WorkerCall) => Promise<T>,
  ): Promise<T> {
    return this.service.locked("agent:" + id, async () => {
      const record = await this.read(id, who);
      const model = fromUpdate(unbase64(record.state));
      try {
        const data = snapshot(model);
        return await this.pool.lease(id, async (rpc, entry) => {
          const fingerprint = contentKey(data);
          if (entry.loaded !== fingerprint) {
            await rpc("load", { kind: this.service.kind, snapshot: data });
            entry.loaded = fingerprint;
          }
          return read(record, rpc);
        });
      } finally {
        model.destroy();
      }
    });
  }
  async capabilities(id: string, who: IdentityReference) {
    return this.withRuntime(id, who, (_record, rpc) => rpc("capabilities", {}));
  }
  async inspect(
    id: string,
    who: IdentityReference,
    query: import("./inspection").InspectionQuery,
  ) {
    return this.withRuntime(id, who, async (record, rpc) => {
      const content = await rpc("inspect", query);
      return { target: await this.describe(record, who), content };
    });
  }
  async pull(id: string, who: IdentityReference) {
    return this.service.locked("agent:" + id, async () => {
      const record = await this.read(id, who);
      if (["unknown", "submitting"].includes(record.submission?.status ?? ""))
        throw new ServiceError(
          409,
          "COMMIT_OUTCOME_UNCERTAIN: retry commit before pull",
        );
      const current = await this.service.get(record.documentId, who);
      const model = fromUpdate(unbase64(record.state));
      try {
        Y.applyUpdate(model, unbase64(current.update));
        try {
          validateSnapshot(snapshot(model), this.service.kind);
        } catch (error) {
          record.conflict = {
            message: error instanceof Error ? error.message : String(error),
            remoteRevision: current.revision,
          };
          await this.save(record, who);
          return {
            status: "conflict",
            conflict: record.conflict,
            state: await this.describe(record, who),
          };
        }
        record.conflict = undefined;
        record.state = base64(encode(model));
        record.baseState = current.update;
        record.baseRevision = current.revision;
        await this.save(record, who);
        this.pool.forgetState(id);
        return {
          status: "synchronized",
          state: await this.describe(record, who),
        };
      } finally {
        model.destroy();
      }
    });
  }
  async commit(id: string, who: IdentityReference) {
    return this.service.locked("agent:" + id, async () => {
      const record = await this.read(id, who);
      if (record.conflict)
        return {
          status: "conflict",
          conflict: record.conflict,
          state: await this.describe(record, who),
        };
      if (record.generation === record.committedGeneration)
        return {
          status: "nothing-to-commit",
          state: await this.describe(record, who),
        };
      const current = await this.service.get(record.documentId, who);
      if (current.role === "viewer")
        throw new ServiceError(403, "RUNTIME_READ_ONLY");
      const requestId = "runtime:" + id + ":" + record.generation;
      // The receipt is checked by service.update before revision comparison, so
      // a lost response after a commit is safely recoverable using this same ID.
      const model = fromUpdate(unbase64(record.state)),
        base = fromUpdate(unbase64(record.baseState));
      try {
        const update = base64(
          Y.encodeStateAsUpdate(model, Y.encodeStateVector(base)),
        );
        record.submission = {
          requestId,
          generation: record.generation,
          status: "submitting",
        };
        await this.save(record, who);
        try {
          await this.service.update(record.documentId, who, {
            update,
            requestId,
            expectedRevision: record.baseRevision,
            message: "Agent Facade commit",
          });
        } catch (error) {
          record.submission.status =
            error instanceof ServiceError &&
            error.status >= 400 &&
            error.status < 500
              ? "rejected"
              : "unknown";
          await this.save(record, who);
          if (record.submission.status === "rejected") {
            if (error instanceof ServiceError && error.status === 409)
              return {
                status: "pull-required",
                state: await this.describe(record, who),
              };
            throw error;
          }
          return {
            status: "unknown",
            requestId,
            error: error instanceof Error ? error.message : String(error),
            state: await this.describe(record, who),
          };
        }
        const confirmed = await this.service.get(record.documentId, who);
        record.baseRevision = confirmed.revision;
        record.baseState = confirmed.update;
        record.state = confirmed.update;
        record.committedGeneration = record.generation;
        record.submission = {
          requestId,
          generation: record.generation,
          status: "confirmed",
          revision: confirmed.revision,
        };
        await this.save(record, who);
        return { status: "confirmed", state: await this.describe(record, who) };
      } finally {
        model.destroy();
        base.destroy();
      }
    });
  }
  async export(id: string, who: IdentityReference) {
    return this.withRuntime(id, who, async (record, rpc) => {
      const exported = await rpc("export", {});
      return {
        snapshot: exported.snapshot,
        state: await this.describe(record, who),
      };
    });
  }
  async close(id: string, who: IdentityReference) {
    return this.service.locked("agent:" + id, async () => {
      const record = await this.read(id, who, true);
      record.closed = true;
      await this.save(record, who);
      this.pool.invalidate(id);
      this.service.leave(record.documentId, "runtime:" + record.id);
      return {
        closed: true,
        pendingPreserved: record.generation > record.committedGeneration,
        runtimeId: id,
      };
    });
  }
  async discard(id: string, who: IdentityReference) {
    return this.service.locked("agent:" + id, async () => {
      const record = await this.read(id, who);
      if (["unknown", "submitting"].includes(record.submission?.status ?? ""))
        throw new ServiceError(
          409,
          "COMMIT_OUTCOME_UNCERTAIN: retry commit before discard",
        );
      const current = await this.service.get(record.documentId, who);
      record.submission = undefined;
      record.conflict = undefined;
      record.state = current.update;
      record.baseState = current.update;
      record.baseRevision = current.revision;
      record.committedGeneration = record.generation;
      await this.save(record, who);
      this.pool.invalidate(id);
      return this.describe(record, who);
    });
  }
  shutdown() {
    this.pool.close();
    allPools.delete(this.pool);
  }
}

export function shutdownAgentRuntimes() {
  for (const pool of allPools) pool.close();
  allPools.clear();
}
