import { actor } from "./identity";
import { test, expect, afterEach } from "bun:test";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importOffice,
  exportOffice,
  normalizeImported,
} from "../src/server/exchange/codecs";
import {
  setExchangeMetadata,
  fingerprint,
  readPackage,
  writePackage,
} from "../src/server/exchange/package";
import { docHtml, docMarkdown } from "../src/server/exchange/html";
import { Storage } from "../src/server/db/database";
import { OfficeService } from "../src/server/documents/service";
import { getFileService } from "../src/server/files/service";
import { ExchangeService } from "../src/server/exchange/service";
import { OfficeAI } from "../src/server/documents/ai";
import { getAgentManager } from "../src/server/agent/manager";

const fixture = (name: string) =>
  new Uint8Array(readFileSync("tests/fixtures/office/" + name));

const clean: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});

const python = process.env.OFFICE_PYTHON ?? ".agent/office-python/bin/python";

function independent(ext: string, bytes: Uint8Array) {
  if (!existsSync(python))
    throw new Error(
      "Set OFFICE_PYTHON to Python with python-docx, openpyxl and pypdf",
    );
  const dir = mkdtempSync(join(tmpdir(), "office-verify-"));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "export." + ext);
  writeFileSync(path, bytes);
  return JSON.parse(
    execFileSync(python, ["tests/fixtures/office/verify.py", path], {
      encoding: "utf8",
    }),
  );
}

test("XLSX edited export reopens in openpyxl with formulas, styles, tables, names and validation", async () => {
  const imported = await importOffice(
    "sheet",
    "xlsx",
    fixture("independent.xlsx"),
  );
  const { snapshot, extras } = await normalizeImported(
    "sheet",
    imported.snapshot,
    imported.extras,
  );
  setExchangeMetadata(snapshot, {
    format: "xlsx",
    extras,
    fingerprint: fingerprint(snapshot),
  });
  const id = snapshot.sheetOrder[0];
  snapshot.sheets[id].cellData[1][1].v = 73;
  const out = await exportOffice("sheet", "xlsx", snapshot, {
    formulaPolicy: "preserve",
  });
  const read = independent("xlsx", out.data);
  expect(read.sheets).toEqual(["Sales", "Other"]);
  expect(read.score).toBe(73);
  expect(read.formula).toBe("=B2*2");
  expect(read.dateFormat).toBe("yyyy-mm-dd");
  expect(read.bold).toBe(true);
  expect(read.fill).toBe("FF123456");
  expect(read.hyperlink).toBe("https://example.com");
  expect(read.merges).toContain("A6:C6");
  expect(read.freeze).toBe("B2");
  expect(read.validation).toContainEqual({
    type: "whole",
    min: "0",
    max: "100",
    range: "B2:B3",
  });
  expect(read.tables).toEqual(["Scores"]);
  expect(read.defined).toContain("ScoresRange");
  expect(read.cf).toBe(1);
  expect(read.images).toBe(1);
});

test("DOCX edited export reopens in python-docx preserving tables, images, header, footer and text style", async () => {
  const imported = await importOffice(
    "doc",
    "docx",
    fixture("independent.docx"),
  );
  const normalized = await normalizeImported(
      "doc",
      imported.snapshot,
      imported.extras,
    ),
    snapshot = normalized.snapshot;
  setExchangeMetadata(snapshot, {
    format: "docx",
    extras: normalized.extras,
    fingerprint: fingerprint(snapshot),
  });
  snapshot.body.dataStream = snapshot.body.dataStream.replace("Hello", "Salve");
  const out = await exportOffice(
      "doc",
      "docx",
      snapshot,
      {},
      fixture("independent.docx"),
    ),
    read = independent("docx", out.data);
  expect(read.paragraphs).toContain("Salve коллеги website");
  expect(read.tables[0]).toEqual([
    ["Name", "Score"],
    ["Иван", "42"],
  ]);
  expect(read.header).toBe("Team header");
  expect(read.footer).toBe("Private footer");
  expect(read.images).toBe(1);
  expect(read.bold).toContain("Salve ");
  const html = docHtml(snapshot),
    md = docMarkdown(snapshot);
  expect(html).toContain("<table");
  expect(html).toContain("https://example.com");
  expect(md).toContain("Иван");
});

test("CSV quotes, embedded newlines and formula-like text remain literal through export", async () => {
  const imported = await importOffice("sheet", "csv", fixture("quoted.csv"));
  const s = imported.snapshot.sheets[imported.snapshot.sheetOrder[0]];
  expect(s.cellData[1][1].v).toBe('line 1\nline "2"');
  expect(s.cellData[1][2]).toEqual({ v: "=2+2", t: 1 });
  const out = await exportOffice("sheet", "tsv", imported.snapshot),
    round = await importOffice("sheet", "tsv", out.data);
  expect(
    round.snapshot.sheets[round.snapshot.sheetOrder[0]].cellData[1][1].v,
  ).toBe('line 1\nline "2"');
});

test("untrusted Office packages reject traversal, XML entities and wrong file kinds before conversion", async () => {
  expect(() =>
    readPackage(writePackage({ "../outside.xml": Buffer.from("<x/>") })),
  ).toThrow("UNSAFE_ZIP_ENTRY");
  const parts = readPackage(fixture("independent.docx"));
  parts["word/document.xml"] = Buffer.from(
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document>&x;</w:document>',
  );
  await expect(
    importOffice("doc", "docx", writePackage(parts)),
  ).rejects.toThrow("XML");
  await expect(
    importOffice("sheet", "docx", fixture("independent.docx")),
  ).rejects.toThrow("FORMAT");
  await expect(
    importOffice(
      "doc",
      "json",
      Buffer.from(
        JSON.stringify({ pioneerOffice: 1, kind: "sheet", snapshot: {} }),
      ),
    ),
  ).rejects.toThrow("KIND");
});

async function setup(kind: "sheet" | "doc" = "sheet") {
  const dir = mkdtempSync(join(tmpdir(), "office-exchange-"));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Storage(join(dir, "db.pgdata"));
  const seed = () =>
    kind === "sheet"
      ? {
          id: "x",
          name: "Test",
          sheetOrder: ["s"],
          sheets: {
            s: {
              id: "s",
              name: "Sheet1",
              rowCount: 100,
              columnCount: 26,
              cellData: {},
            },
          },
        }
      : {
          id: "x",
          title: "Test",
          body: { dataStream: "Hello\r\n", paragraphs: [{ startIndex: 5 }] },
          documentStyle: { documentFlavor: 1 },
        };
  const service = new OfficeService(store, kind, seed);
  clean.push(() => service.close());
  await service.init();
  const who = actor("Importer").identity,
    other = actor("Other").identity,
    files = getFileService(service);
  await files.ready;
  const exchange = new ExchangeService(service);
  await exchange.ready;
  clean.push(() => exchange.shutdown());
  return { dir, store, service, who, other, files, exchange };
}

async function done(exchange: ExchangeService, id: string, who: any) {
  for (let i = 0; i < 400; i++) {
    const j = await exchange.get(id, who);
    if (["succeeded", "failed", "cancelled"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Conversion timeout");
}

test("durable import, explicit revision export, idempotency, private jobs and retention leases", async () => {
  const e = await setup();
  const f = await e.files.put(e.who, {
    name: "Sales.xlsx",
    mime: "application/octet-stream",
    data: fixture("independent.xlsx"),
  });
  const started = await e.exchange.create(e.who, {
      operation: "import",
      format: "xlsx",
      fileId: f.id,
      requestId: "one-import",
    }),
    job = await done(e.exchange, started.id, e.who);
  expect(job.error).toBeNull();
  expect(job.status).toBe("succeeded");
  expect(
    (
      await e.exchange.create(e.who, {
        operation: "import",
        format: "xlsx",
        fileId: f.id,
        requestId: "one-import",
      })
    ).id,
  ).toBe(job.id);
  await expect(e.exchange.get(job.id, e.other)).rejects.toThrow("NOT_FOUND");
  const doc = await e.service.get(job.result.documentId, e.who);
  await new OfficeAI(e.service).execute(doc.id, e.who, [
    { op: "set_cells", range: "B2", values: [[99]] },
  ]);
  const exported = await e.exchange.create(e.who, {
    operation: "export",
    format: "xlsx",
    documentId: doc.id,
    revision: 0,
  });
  const output = await done(e.exchange, exported.id, e.who);
  expect(output.error).toBeNull();
  const bytes = await e.files.read(output.result.file.id, e.who);
  expect(
    Buffer.compare(bytes.data, Buffer.from(fixture("independent.xlsx"))),
  ).toBe(0);
  const changed = await done(
    e.exchange,
    (
      await e.exchange.create(e.who, {
        operation: "export",
        format: "xlsx",
        documentId: doc.id,
        options: { formulaPolicy: "preserve" },
      })
    ).id,
    e.who,
  );
  expect(changed.error).toBeNull();
  const firstPage = await e.exchange.list(e.who, 0, 2);
  const lastPage = await e.exchange.list(e.who, 2, 2);
  expect(firstPage.items).toHaveLength(2);
  expect(firstPage.hasMore).toBe(true);
  expect(lastPage.items).toHaveLength(1);
  expect(lastPage.hasMore).toBe(false);
  expect(
    new Set([...firstPage.items, ...lastPage.items].map((item) => item.id)),
  ).toEqual(new Set([job.id, output.id, changed.id]));
  expect((await e.exchange.list(e.who, 0, 3)).hasMore).toBe(false);
  expect(await e.exchange.list(e.other, 0, 2)).toMatchObject({
    items: [],
    hasMore: false,
  });
  expect(
    independent(
      "xlsx",
      (await e.files.read(changed.result.file.id, e.who)).data,
    ).score,
  ).toBe(99);
  await e.files.manage(f.id, e.who, "trash");
  await expect(e.files.manage(f.id, e.who, "purge")).rejects.toThrow();
});

test("failed conversion is visible and retryable, source retained, output file protected until job purged", async () => {
  const e = await setup(),
    f = await e.files.put(e.who, {
      name: "bad.xlsx",
      mime: "application/octet-stream",
      data: Buffer.from("not zip"),
    });
  const j = await done(
    e.exchange,
    (
      await e.exchange.create(e.who, {
        operation: "import",
        format: "xlsx",
        fileId: f.id,
      })
    ).id,
    e.who,
  );
  expect(j.status).toBe("failed");
  expect(j.error).toBeTruthy();
  await e.exchange.manage(j.id, e.who, "retry");
  expect((await done(e.exchange, j.id, e.who)).attempt).toBe(2);
  const doc = await e.service.create(e.who),
    exported = await done(
      e.exchange,
      (
        await e.exchange.create(e.who, {
          operation: "export",
          format: "json",
          documentId: doc.id,
        })
      ).id,
      e.who,
    );
  expect(exported.error).toBeNull();
  await e.files.manage(exported.result.file.id, e.who, "trash");
  await expect(
    e.files.manage(exported.result.file.id, e.who, "purge"),
  ).rejects.toThrow("JOB");
  await e.exchange.manage(exported.id, e.who, "purge");
  await e.files.manage(exported.result.file.id, e.who, "purge");
});

test("portable JSON transports original DOCX and images into a separate database", async () => {
  const a = await setup("doc"),
    source = await a.files.put(a.who, {
      name: "Original.docx",
      mime: "application/octet-stream",
      data: fixture("independent.docx"),
    });
  const imported = await done(
    a.exchange,
    (
      await a.exchange.create(a.who, {
        operation: "import",
        format: "docx",
        fileId: source.id,
      })
    ).id,
    a.who,
  );
  expect(imported.error).toBeNull();
  const exported = await done(
    a.exchange,
    (
      await a.exchange.create(a.who, {
        operation: "export",
        format: "json",
        documentId: imported.result.documentId,
      })
    ).id,
    a.who,
  );
  expect(exported.error).toBeNull();
  const b = await setup("doc"),
    bytes = (await a.files.read(exported.result.file.id, a.who)).data,
    portable = await b.files.put(b.who, {
      name: "Portable.json",
      mime: "application/json",
      data: bytes,
    });
  const moved = await done(
    b.exchange,
    (
      await b.exchange.create(b.who, {
        operation: "import",
        format: "json",
        fileId: portable.id,
      })
    ).id,
    b.who,
  );
  expect(moved.error).toBeNull();
  const doc = await b.service.get(moved.result.documentId, b.who);
  expect(JSON.stringify(doc.snapshot)).not.toContain(source.id);
  const output = await done(
    b.exchange,
    (
      await b.exchange.create(b.who, {
        operation: "export",
        format: "docx",
        documentId: doc.id,
      })
    ).id,
    b.who,
  );
  expect(output.error).toBeNull();
  const result = independent(
    "docx",
    (await b.files.read(output.result.file.id, b.who)).data,
  );
  expect(result.images).toBe(1);
  expect(result.header).toBe("Team header");
  expect(result.tables[0][1][0]).toBe("Иван");
}, 15000);

test("export captures staged agent edits without publishing them, and remains private", async () => {
  const e = await setup(),
    doc = await e.service.create(e.who),
    manager = getAgentManager(e.service);
  clean.push(() => manager.pool.close());
  const runtime = await manager.open(doc.id, e.who);
  await manager.execute(runtime.runtimeId, e.who, {
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("A1").setValue("Pending-only");return true;',
  });
  const queued = await e.exchange.create(e.who, {
      operation: "export",
      format: "csv",
      runtimeId: runtime.runtimeId,
    }),
    job = await done(e.exchange, queued.id, e.who);
  expect(job.error).toBeNull();
  expect(
    (await e.files.read(job.result.file.id, e.who)).data.toString(),
  ).toContain("Pending-only");
  expect(
    JSON.stringify((await e.service.get(doc.id, e.who)).snapshot),
  ).not.toContain("Pending-only");
  await expect(e.files.read(job.result.file.id, e.other)).rejects.toThrow(
    "ACCESS",
  );
}, 15000);

test("source-only Office features require explicit consent for edited export", async () => {
  const e = await setup(),
    parts = readPackage(fixture("independent.xlsx"));
  parts["xl/charts/chart999.xml"] = Buffer.from(
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>',
  );
  const source = await e.files.put(e.who, {
    name: "Chart.xlsx",
    mime: "application/octet-stream",
    data: writePackage(parts),
  });
  const j = await done(
    e.exchange,
    (
      await e.exchange.create(e.who, {
        operation: "import",
        format: "xlsx",
        fileId: source.id,
      })
    ).id,
    e.who,
  );
  expect(j.error).toBeNull();
  expect(j.result.diagnostics.some((d: any) => d.code === "XLSX_CHARTS")).toBe(
    true,
  );
  await new OfficeAI(e.service).execute(j.result.documentId, e.who, [
    { op: "set_cells", range: "B2", values: [[7]] },
  ]);
  const blocked = await done(
    e.exchange,
    (
      await e.exchange.create(e.who, {
        operation: "export",
        format: "xlsx",
        documentId: j.result.documentId,
      })
    ).id,
    e.who,
  );
  expect(blocked.status).toBe("failed");
  expect(blocked.error).toContain("UNSUPPORTED");
  const allowed = await done(
    e.exchange,
    (
      await e.exchange.create(e.who, {
        operation: "export",
        format: "xlsx",
        documentId: j.result.documentId,
        options: { allowLossy: true },
      })
    ).id,
    e.who,
  );
  expect(allowed.status).toBe("succeeded");
  expect(
    allowed.result.diagnostics.some(
      (d: any) => d.code === "EXPLICIT_LOSSY_EXPORT",
    ),
  ).toBe(true);
}, 15000);
