import { actor } from "./identity";
import { test, expect, afterEach, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Storage } from "../src/server/db/database";
import { OfficeService } from "../src/server/documents/service";
import { AgentManager } from "../src/server/agent/manager";
import { AgentLibrary } from "../src/server/agent/library";
import { findApi, showApi } from "../src/server/agent/reference";

const clean: Array<() => void | Promise<void>> = [];

beforeAll(() => {
  execFileSync("bun", ["scripts/build-agent.ts"]);
  execFileSync("bun", ["scripts/build-agent-reference.ts"]);
});

afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});

async function setup(kind: "doc" | "sheet" = "sheet") {
  const path = mkdtempSync(join(tmpdir(), "agent-capabilities-"));
  clean.push(() => rmSync(path, { recursive: true, force: true }));
  const storage = new Storage(join(path, "db.pgdata"));
  const blank = () =>
    kind === "sheet"
      ? {
          id: "book",
          name: "Examples",
          styles: { heading: { bl: 1 } },
          sheetOrder: ["data"],
          sheets: {
            data: {
              id: "data",
              name: "Data",
              rowCount: 20,
              columnCount: 10,
              cellData: {
                0: { 0: { v: "Total", s: "heading" }, 1: { v: 5 } },
                1: { 1: { f: "=B1*2" } },
              },
            },
          },
        }
      : {
          id: "doc",
          title: "Example",
          body: {
            dataStream: "First paragraph\rSecond paragraph\r\n",
            paragraphs: [
              { startIndex: 15, paragraphId: "first" },
              { startIndex: 32, paragraphId: "second" },
            ],
          },
          documentStyle: {},
        };
  const service = new OfficeService(storage, kind, blank);
  clean.push(() => service.close());
  await service.init();
  const owner = actor("Owner"),
    other = actor("Other");
  const doc = await service.create(owner.identity);
  const manager = new AgentManager(service, { maxEntries: 2, idleTtlMs: 5000 });
  clean.push(() => manager.shutdown());
  return {
    storage,
    service,
    owner,
    other,
    doc,
    manager,
    library: new AgentLibrary(service),
  };
}

test("offline API discovery provides executable Facade signatures and referenced cell types", async () => {
  const found = await findApi({
    terms: ["setValues"],
    unit: "sheet",
    limit: 10,
  });
  expect(found.matches.some((m: any) => m.id === "FRange.setValues")).toBe(
    true,
  );
  const show = await showApi([
    "FRange.setValues",
    "ICellData.v",
    "does-not-exist",
  ]);
  const [range] = show.symbols;
  expect("signatures" in range ? range.signatures.join(" ") : "").toContain("setValues");
  expect(show.symbols[1].notFound).not.toBe(true);
  expect(show.symbols[2].notFound).toBe(true);
});

test("structured Sheet inspection reports actual calculated values, formatting and stable sheet selectors", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.owner.identity);
  const inspected = await e.manager.inspect(r.runtimeId, e.owner.identity, {
    kind: "range",
    sheet: "name:Data",
    range: "A1:B2",
  });
  expect(inspected.content.cells[1][1].v).toBe(10);
  expect(inspected.content.cells[0][0].resolvedStyle.bl).toBe(1);
  const overview = await e.manager.inspect(r.runtimeId, e.owner.identity, {
    kind: "workbook",
  });
  expect(overview.content.worksheets[0].usedRange.range).toBe("A1:B2");
  expect((await e.service.get(e.doc.id, e.owner.identity)).revision).toBe(0);
});

test("Doc paragraph selectors and search return exact text positions without rewriting the document", async () => {
  const e = await setup("doc");
  const r = await e.manager.open(e.doc.id, e.owner.identity);
  const p = await e.manager.inspect(r.runtimeId, e.owner.identity, {
    kind: "paragraph",
    paragraphId: "second",
  });
  expect(p.content.text).toBe("Second paragraph");
  expect(p.content.start).toBe(16);
  const result = await e.manager.inspect(r.runtimeId, e.owner.identity, {
    kind: "search",
    query: "paragraph",
  });
  expect(result.content.total).toBe(2);
  expect(result.content.items[1].start).toBe(23);
});

test("cached binary resources deduplicate by content, survive service reconstruction and stay private", async () => {
  const e = await setup();
  const a = await e.library.import(e.owner.identity, {
    name: "first",
    mimeType: "text/plain",
    base64: "YWJj",
    tags: ["fixture"],
  });
  const b = await e.library.import(e.owner.identity, {
    name: "duplicate",
    mimeType: "text/plain",
    base64: "YWJj",
  });
  expect(a.id).toBe(b.id);
  expect(b.cacheHit).toBe(true);
  expect(a.sha256).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const reopened = new AgentLibrary(e.service);
  expect(
    (await reopened.export(e.owner.identity, String(a.id))).data.toString(),
  ).toBe("abc");
  expect(
    (await reopened.search(e.owner.identity, "fixture")).owned,
  ).toHaveLength(1);
  await expect(
    reopened.export(e.other.identity, String(a.id)),
  ).rejects.toThrow();
  await reopened.remove(e.owner.identity, String(a.id));
  await expect(
    reopened.export(e.owner.identity, String(a.id)),
  ).rejects.toThrow();
});

test("typed configuration applies defaults and persists isolated validated values", async () => {
  const e = await setup();
  await e.library.config(e.owner.identity, {
    action: "declare",
    namespace: "render",
    schema: { scale: { type: "number", default: 1 } },
  });
  expect(
    (
      await e.library.config(e.owner.identity, {
        action: "get",
        namespace: "render",
      })
    ).values.scale,
  ).toBe(1);
  await e.library.config(e.owner.identity, {
    action: "set",
    namespace: "render",
    values: { scale: 2 },
  });
  expect(
    (
      await new AgentLibrary(e.service).config(e.owner.identity, {
        action: "get",
        namespace: "render",
      })
    ).values.scale,
  ).toBe(2);
  await expect(
    e.library.config(e.owner.identity, {
      action: "set",
      namespace: "render",
      values: { scale: "wrong" },
    }),
  ).rejects.toThrow("INVALID_CONFIG_TYPE");
  expect(
    (
      await e.library.config(e.other.identity, {
        action: "get",
        namespace: "render",
      })
    ).values.scale,
  ).toBeUndefined();
});

test("exclusive runtime leases serialize dependent edits and LRU bounds worker residency", async () => {
  const e = await setup();
  const r = await e.manager.open(e.doc.id, e.owner.identity);
  await e.manager.execute(r.runtimeId, e.owner.identity, {
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("C1").setValue(0);',
  });
  await Promise.all(
    [1, 2].map(() =>
      e.manager.execute(r.runtimeId, e.owner.identity, {
        mode: "write",
        code: 'const r=workbook.getActiveSheet().getRange("C1");r.setValue(r.getValue()+1);',
      }),
    ),
  );
  expect(
    (await e.manager.export(r.runtimeId, e.owner.identity)).snapshot.sheets.data
      .cellData[0][2].v,
  ).toBe(2);
  for (let i = 0; i < 3; i++) {
    const next = await e.manager.open(e.doc.id, e.owner.identity);
    await e.manager.execute(next.runtimeId, e.owner.identity, {
      mode: "read",
      code: "return workbook.getId();",
    });
  }
  expect(e.manager.pool.stats().resident).toBeLessThanOrEqual(2);
  expect(e.manager.pool.stats().evicted).toBeGreaterThan(0);
});

test("cache deduplication preserves each rendering provenance instead of reporting stale revision metadata", async () => {
  const e = await setup();
  const a = await e.library.put(e.owner.identity, {
    name: "first.png",
    mimeType: "image/png",
    data: Buffer.from("same bytes"),
    metadata: { revision: 1 },
  });
  const b = await e.library.put(e.owner.identity, {
    name: "second.png",
    mimeType: "image/png",
    data: Buffer.from("same bytes"),
    metadata: { revision: 2 },
  });
  expect(a.id).toBe(b.id);
  expect(b.metadata.revision).toBe(2);
  expect(
    (await e.library.search(e.owner.identity, "second.png")).owned,
  ).toHaveLength(1);
  const exported = await e.library.export(e.owner.identity, String(a.id));
  expect(exported.usages.map((u) => u.metadata.revision).sort()).toEqual([
    1, 2,
  ]);
});

test("configuration rejects undeclared fields, inconsistent defaults and prototype keys", async () => {
  const e = await setup();
  await expect(
    e.library.config(e.owner.identity, {
      action: "set",
      namespace: "test",
      values: { unknown: 1 },
    }),
  ).rejects.toThrow("UNKNOWN_CONFIG_KEY");
  await expect(
    e.library.config(e.owner.identity, {
      action: "declare",
      namespace: "test",
      schema: { scale: { type: "number", default: "wrong" } },
    }),
  ).rejects.toThrow("INVALID_CONFIG_SCHEMA");
  await expect(
    e.library.config(e.owner.identity, {
      action: "declare",
      namespace: "test",
      schema: JSON.parse('{"__proto__":{"type":"object"}}'),
    }),
  ).rejects.toThrow("INVALID_CONFIG_SCHEMA");
});

test("visual URL imports reject localhost, private addresses and IPv4-mapped IPv6 before connecting", async () => {
  const e = await setup();
  for (const url of [
    "http://example.com/image.png",
    "https://127.0.0.1/image.png",
    "https://10.0.0.1/image.png",
    "https://[::1]/image.png",
    "https://[::ffff:127.0.0.1]/image.png",
  ])
    await expect(e.library.import(e.owner.identity, { url })).rejects.toThrow();
});
