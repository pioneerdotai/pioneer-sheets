import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type WorkerCall = (method: string, input: any) => Promise<any>;

type Entry = {
  process: ChildProcess;
  busy: boolean;
  lastUsed: number;
  loaded?: string;
  pending: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
};

export class RuntimePool {
  entries = new Map<string, Entry>();
  private queues = new Map<string, Promise<any>>();
  private waiters: Array<() => void> = [];
  private sweep: ReturnType<typeof setInterval>;
  closed = false;
  created = 0;
  evicted = 0;
  crashed = 0;
  constructor(
    public options: {
      maxEntries?: number;
      idleTtlMs?: number;
      workerPath?: string;
      timeoutMs?: number;
    } = {},
  ) {
    this.sweep = setInterval(
      () => this.evictIdle(),
      Math.min(options.idleTtlMs ?? 300000, 10000),
    );
    this.sweep.unref?.();
  }
  private evictIdle() {
    for (const [key, entry] of this.entries)
      if (
        !entry.busy &&
        Date.now() - entry.lastUsed > (this.options.idleTtlMs ?? 300000)
      )
        this.invalidate(key);
  }
  invalidate(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    for (const p of entry.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("WORKER_INVALIDATED"));
    }
    entry.pending.clear();
    entry.process.kill();
    this.evicted++;
    this.wake();
  }
  private wake() {
    for (const fn of this.waiters.splice(0)) fn();
  }
  private async acquire(key: string): Promise<Entry> {
    if (this.closed) throw new Error("POOL_CLOSED");
    let entry = this.entries.get(key);
    if (entry) {
      entry.busy = true;
      return entry;
    }
    while (this.entries.size >= (this.options.maxEntries ?? 1)) {
      const idle = [...this.entries]
        .filter(([, e]) => !e.busy)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (idle) {
        this.invalidate(idle[0]);
        break;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("POOL_ACQUIRE_TIMEOUT")),
          30000,
        );
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (this.closed) throw new Error("POOL_CLOSED");
    }
    const path = resolve(this.options.workerPath ?? ".agent/worker.mjs");
    if (!existsSync(path))
      throw new Error("WORKER_NOT_BUILT: run bun scripts/build-agent.ts");
    const node = process.versions.bun ? Bun.which("node") : process.execPath;
    if (!node) throw new Error("NODE_REQUIRED");
    const child = fork(path, [], {
      execPath: node,
      execArgv: ["--max-old-space-size=128"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        TZ: process.env.TZ,
        NODE_ENV: process.env.NODE_ENV,
      },
    });
    entry = {
      process: child,
      busy: true,
      lastUsed: Date.now(),
      pending: new Map(),
    };
    this.entries.set(key, entry);
    this.created++;
    const current = entry;
    child.on("message", (message: any) => {
      const pending = current.pending.get(message.id);
      if (!pending) return;
      current.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    child.on("error", () => {
      if (this.entries.get(key) === current) this.invalidate(key);
    });
    child.on("exit", () => {
      if (this.entries.get(key) === current) {
        this.crashed++;
        this.invalidate(key);
      }
    });
    child.stderr?.on("data", (data) => {
      if (process.env.OFFICE_AGENT_DEBUG === "1") process.stderr.write(data);
    });
    child.unref();
    child.channel?.unref?.();
    return entry;
  }
  private call(entry: Entry, method: string, input: any, timeoutMs?: number) {
    return new Promise<any>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => {
          entry.pending.delete(id);
          reject(new Error("WORKER_TIMEOUT"));
        },
        timeoutMs ?? this.options.timeoutMs ?? 30000,
      );
      entry.pending.set(id, { resolve, reject, timer });
      entry.process.send({ id, method, input }, (error) => {
        if (error) {
          clearTimeout(timer);
          entry.pending.delete(id);
          reject(error);
        }
      });
    });
  }
  async lease<T>(
    key: string,
    fn: (rpc: WorkerCall, entry: Entry) => Promise<T>,
  ): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const work = prior
      .catch(() => {})
      .then(async () => {
        const entry = await this.acquire(key);
        try {
          return await fn(
            (method, input) => this.call(entry, method, input),
            entry,
          );
        } catch (error) {
          this.invalidate(key);
          throw error;
        } finally {
          entry.busy = false;
          entry.lastUsed = Date.now();
          this.wake();
        }
      });
    this.queues.set(key, work);
    try {
      return await work;
    } finally {
      if (this.queues.get(key) === work) this.queues.delete(key);
    }
  }
  forgetState(key: string) {
    const entry = this.entries.get(key);
    if (entry) entry.loaded = undefined;
  }
  stats() {
    return {
      resident: this.entries.size,
      busy: [...this.entries.values()].filter((e) => e.busy).length,
      created: this.created,
      evicted: this.evicted,
      crashed: this.crashed,
      maxEntries: this.options.maxEntries ?? 1,
    };
  }
  close() {
    this.closed = true;
    clearInterval(this.sweep);
    for (const key of [...this.entries.keys()]) this.invalidate(key);
    this.wake();
  }
}
