import { actor } from "./identity";
import { test, expect, afterEach, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Storage } from "../src/server/db/database";
import { OfficeService } from "../src/server/documents/service";
import { OfficeAI } from "../src/server/documents/ai";
import { AgentManager } from "../src/server/agent/manager";

const clean: Array<() => void | Promise<void>> = [];

beforeAll(() =>
  execFileSync("bun", ["scripts/build-agent.ts"], { stdio: "pipe" }),
);

afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});

async function setup(kind: "sheet" | "doc" = "sheet") {
  const path = mkdtempSync(join(tmpdir(), "pioneer-agent-"));
  clean.push(() => rmSync(path, { recursive: true, force: true }));
  const store = new Storage(join(path, "db.pgdata"));
  const seed = () =>
    kind === "sheet"
      ? {
          id: "book",
          name: "Test",
          sheetOrder: ["main"],
          sheets: {
            main: {
              id: "main",
              name: "Main",
              rowCount: 20,
              columnCount: 10,
              cellData: { 0: { 0: { v: "Base" } } },
            },
          },
          styles: {},
        }
      : {
          id: "doc",
          title: "Test",
          body: {
            dataStream: "Hello world\r\n",
            paragraphs: [{ startIndex: 11, paragraphId: "p1" }],
          },
          documentStyle: {},
        };
  const service = new OfficeService(store, kind, seed);
  clean.push(() => service.close());
  await service.init();
  const user = actor("Owner");
  const other = actor("Other");
  const doc = await service.create(user.identity);
  const manager = new AgentManager(service, { maxEntries: 2, idleTtlMs: 5000 });
  clean.push(() => manager.shutdown());
  return { path, store, service, user, other, doc, manager };
}

test("Facade changes are staged, formula results readable, and explicit commit durably publishes once", async () => {
  const e = await setup();
  const runtime = await e.manager.open(e.doc.id, e.user.identity);
  const executed = await e.manager.execute(runtime.runtimeId, e.user.identity, {
    mode: "write",
    code: 'const s=workbook.getActiveSheet();s.getRange("A1:B2").setValues([["Facade",3],["Result","=B1*7"]]);return s.getRange("B2").getFormula();',
  });
  expect(executed.value).toBe("=B1*7");
  expect(executed.state.pending).toBe(true);
  expect(
    (await e.service.get(e.doc.id, e.user.identity)).snapshot.sheets.main
      .cellData[0][0].v,
  ).toBe("Base");
  const read = await e.manager.execute(runtime.runtimeId, e.user.identity, {
    mode: "read",
    code: 'return workbook.getActiveSheet().getRange("B2").getValue();',
  });
  expect(read.value).toBe(21);
  expect(
    (await e.manager.commit(runtime.runtimeId, e.user.identity)).status,
  ).toBe("confirmed");
  expect(
    (await e.manager.commit(runtime.runtimeId, e.user.identity)).status,
  ).toBe("nothing-to-commit");
  const saved = await e.service.get(e.doc.id, e.user.identity);
  expect(saved.revision).toBe(1);
  expect(saved.snapshot.sheets.main.cellData[0][0].v).toBe("Facade");
});

test("Docs executes the real Facade engine and read mode cannot alter content", async () => {
  const e = await setup("doc");
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'document.insertText(6,"dear ");return document.getId();',
  });
  expect(
    (await e.manager.export(r.runtimeId, e.user.identity)).snapshot.body
      .dataStream,
  ).toBe("Hello dear world\r\n");
  await expect(
    e.manager.execute(r.runtimeId, e.user.identity, {
      mode: "read",
      code: 'document.insertText(0,"Illegal");',
    }),
  ).rejects.toThrow();
  expect(
    (await e.manager.export(r.runtimeId, e.user.identity)).snapshot.body
      .dataStream,
  ).toBe("Hello dear world\r\n");
  await e.manager.commit(r.runtimeId, e.user.identity);
  expect(
    (await e.service.get(e.doc.id, e.user.identity)).snapshot.body.dataStream,
  ).toBe("Hello dear world\r\n");
});

test("pull reconciles staged changes with another writer; commit reports stale baseline explicitly", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("A2").setValue("Agent");',
  });
  await new OfficeAI(e.service).execute(e.doc.id, e.other.identity, [
    { op: "set_cells", range: "B2", values: [["Human"]] },
  ]);
  expect((await e.manager.commit(r.runtimeId, e.user.identity)).status).toBe(
    "pull-required",
  );
  await e.manager.pull(r.runtimeId, e.user.identity);
  await e.manager.commit(r.runtimeId, e.user.identity);
  const s = (await e.service.get(e.doc.id, e.user.identity)).snapshot;
  expect(s.sheets.main.cellData[1][0].v).toBe("Agent");
  expect(s.sheets.main.cellData[1][1].v).toBe("Human");
});

test("worker timeout and JS errors preserve earlier staging and allow a clean subsequent execution", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("A2").setValue("Keep");',
  });
  await expect(
    e.manager.execute(r.runtimeId, e.user.identity, {
      mode: "write",
      code: 'workbook.getActiveSheet().getRange("A2").setValue("Drop");throw new Error("abort");',
    }),
  ).rejects.toThrow();
  expect(
    (await e.manager.export(r.runtimeId, e.user.identity)).snapshot.sheets.main
      .cellData[1][0].v,
  ).toBe("Keep");
  await expect(
    e.manager.execute(r.runtimeId, e.user.identity, {
      mode: "read",
      code: "while(true){}",
      timeoutMs: 50,
    }),
  ).rejects.toThrow();
  expect(
    (
      await e.manager.execute(r.runtimeId, e.user.identity, {
        mode: "read",
        code: "return workbook.getId();",
      })
    ).value,
  ).toBe(e.doc.id);
});

test("execution has no Node globals, no host constructor escape, and runtime identity is isolated", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.user.identity);
  expect(
    (
      await e.manager.execute(r.runtimeId, e.user.identity, {
        mode: "read",
        code: "return [typeof process,typeof require,typeof fetch];",
      })
    ).value,
  ).toEqual(["undefined", "undefined", "undefined"]);
  await expect(
    e.manager.execute(r.runtimeId, e.user.identity, {
      mode: "read",
      code: "return workbook.constructor;",
    }),
  ).rejects.toThrow();
  await expect(
    e.manager.export(r.runtimeId, e.other.identity),
  ).rejects.toThrow();
  await e.service.setMember(
    e.doc.id,
    e.user.identity,
    e.other.identity.id,
    "viewer",
  );
  const viewer = await e.manager.open(e.doc.id, e.other.identity);
  await expect(
    e.manager.execute(viewer.runtimeId, e.other.identity, {
      mode: "write",
      code: 'workbook.getActiveSheet().getRange("A1").setValue("Forbidden");',
    }),
  ).rejects.toThrow();
});

test("closing and reconstructing the manager preserves uncommitted state in SQLite", async () => {
  const e = await setup("doc");
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'document.insertText(0,"Durable ");',
  });
  await e.manager.close(r.runtimeId, e.user.identity);
  e.manager.shutdown();
  const next = new AgentManager(e.service);
  clean.push(() => next.shutdown());
  const resumed = await next.open(e.doc.id, e.user.identity, r.runtimeId);
  expect(resumed.pending).toBe(true);
  expect(
    (await next.export(r.runtimeId, e.user.identity)).snapshot.body.dataStream,
  ).toBe("Durable Hello world\r\n");
  await next.commit(r.runtimeId, e.user.identity);
  expect(
    (await e.service.get(e.doc.id, e.user.identity)).snapshot.body.dataStream,
  ).toContain("Durable");
});

test("a lost commit response is resolved through the same durable receipt without duplicate edits", async () => {
  const e = await setup("doc");
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'document.insertText(0,"Once ");',
  });
  const original = e.service.update.bind(e.service);
  let disconnect = true;
  e.service.update = async (...args: any[]) => {
    const saved = await (original as any)(...args);
    if (disconnect) {
      disconnect = false;
      throw new Error("Injected response disconnect after durable write");
    }
    return saved;
  };
  const uncertain = await e.manager.commit(r.runtimeId, e.user.identity);
  expect(uncertain.status).toBe("unknown");
  expect(uncertain.state.submission!.status).toBe("unknown");
  await expect(
    e.manager.execute(r.runtimeId, e.user.identity, {
      mode: "write",
      code: 'document.insertText(0,"Extra ");',
    }),
  ).rejects.toThrow("COMMIT_OUTCOME_UNCERTAIN");
  expect((await e.manager.commit(r.runtimeId, e.user.identity)).status).toBe(
    "confirmed",
  );
  const saved = await e.service.get(e.doc.id, e.user.identity);
  expect(saved.revision).toBe(1);
  expect(saved.snapshot.body.dataStream).toBe("Once Hello world\r\n");
});

test("native row insertion retains the human edit anchored to its original row after pull", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'workbook.getActiveSheet().insertRowsBefore(0,1);workbook.getActiveSheet().getRange("A1").setValue("Inserted");',
  });
  await new OfficeAI(e.service).execute(e.doc.id, e.other.identity, [
    { op: "set_cells", range: "B1", values: [["Human original row"]] },
  ]);
  await e.manager.pull(r.runtimeId, e.user.identity);
  await e.manager.commit(r.runtimeId, e.user.identity);
  const saved = (await e.service.get(e.doc.id, e.user.identity)).snapshot.sheets
    .main;
  expect(saved.cellData[0][0].v).toBe("Inserted");
  expect(saved.cellData[1][1].v).toBe("Human original row");
});

test("an agent draft runtime publishes only to its own worktree until explicit review and merge", async () => {
  const e = await setup("doc");
  const draft = await e.service.createDraft(e.doc.id, e.user.identity),
    r = await e.manager.open(draft.id, e.user.identity);
  expect(r.worktree!.sourceId).toBe(e.doc.id);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'document.insertText(0,"Draft ");',
  });
  await e.manager.commit(r.runtimeId, e.user.identity);
  expect(
    (await e.service.get(e.doc.id, e.user.identity)).snapshot.body.dataStream,
  ).toBe("Hello world\r\n");
  await e.service.reviewDraft(draft.id, e.user.identity, "ready");
  await expect(
    e.manager.execute(r.runtimeId, e.user.identity, {
      mode: "write",
      code: 'document.insertText(0,"Forbidden ");',
    }),
  ).rejects.toThrow("RUNTIME_READ_ONLY");
  await e.service.reviewDraft(draft.id, e.user.identity, "merge");
  expect(
    (await e.service.get(e.doc.id, e.user.identity)).snapshot.body.dataStream,
  ).toBe("Draft Hello world\r\n");
});

test("worker process crashes invalidate the lease and preserve previously staged content", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("A2").setValue("Recovered");',
  });
  const entry = e.manager.pool.entries.get(r.runtimeId)!;
  const exited = new Promise<void>((resolve) =>
    entry.process.once("exit", () => resolve()),
  );
  entry.process.kill("SIGKILL");
  await exited;
  expect(
    (await e.manager.export(r.runtimeId, e.user.identity)).snapshot.sheets.main
      .cellData[1][0].v,
  ).toBe("Recovered");
  expect(e.manager.pool.stats().crashed).toBe(1);
});

test("idle TTL evicts actual worker processes and reacquires staged state on demand", async () => {
  const e = await setup();
  const manager = new AgentManager(e.service, { idleTtlMs: 80 });
  clean.push(() => manager.shutdown());
  const r = await manager.open(e.doc.id, e.user.identity);
  await manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("A2").setValue("TTL");',
  });
  const start = Date.now();
  while (manager.pool.stats().resident && Date.now() - start < 3000)
    await new Promise((resolve) => setTimeout(resolve, 20));
  expect(manager.pool.stats().resident).toBe(0);
  expect(
    (await manager.export(r.runtimeId, e.user.identity)).snapshot.sheets.main
      .cellData[1][0].v,
  ).toBe("TTL");
});

test("an invalid concurrent structural merge reports a persistent conflict and preserves recoverable staging", async () => {
  const e = await setup();
  await new OfficeAI(e.service).execute(e.doc.id, e.user.identity, [
    { op: "add_sheet", name: "Other" },
  ]);
  const initial = await e.service.get(e.doc.id, e.user.identity),
    otherId = initial.snapshot.sheetOrder.find((id: string) => id !== "main");
  const r = await e.manager.open(e.doc.id, e.user.identity);
  await e.manager.execute(r.runtimeId, e.user.identity, {
    mode: "write",
    code: 'workbook.deleteSheet("main");',
  });
  await new OfficeAI(e.service).execute(e.doc.id, e.other.identity, [
    { op: "remove_sheet", sheet: otherId },
  ]);
  const pulled = await e.manager.pull(r.runtimeId, e.user.identity);
  expect(pulled.status).toBe("conflict");
  expect(pulled.state.phase).toBe("conflict");
  expect(pulled.state.pending).toBe(true);
  expect(
    (await e.service.get(e.doc.id, e.user.identity)).snapshot.sheetOrder,
  ).toEqual(["main"]);
  expect((await e.manager.commit(r.runtimeId, e.user.identity)).status).toBe(
    "conflict",
  );
  await e.manager.discard(r.runtimeId, e.user.identity);
  expect((await e.manager.state(r.runtimeId, e.user.identity)).phase).toBe(
    "active",
  );
});
