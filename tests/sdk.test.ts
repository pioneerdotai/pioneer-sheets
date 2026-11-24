import { actor } from "./identity";
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import {
  createModel,
  snapshot,
  writeSnapshot,
  encode,
  fromUpdate,
  base64,
} from "../src/shared/documents/model";
import { Storage } from "../src/server/db/database";
import { OfficeService } from "../src/server/documents/service";
import { OfficeAI, applyOperation } from "../src/server/documents/ai";

const sheet = () => ({
  id: "book",
  name: "Budget",
  styles: {},
  sheetOrder: ["main"],
  sheets: {
    main: {
      id: "main",
      name: "Main",
      rowCount: 10,
      columnCount: 5,
      cellData: {
        0: { 0: { v: "Item" }, 1: { v: 10 } },
        1: { 0: { v: "Second" }, 1: { v: 20 } },
      },
    },
  },
});

const doc = () => ({
  id: "doc",
  title: "Report",
  body: {
    dataStream: "Hello world\r\n",
    paragraphs: [{ startIndex: 11, paragraphId: "p1" }],
    textRuns: [{ st: 0, ed: 5, ts: { bl: 1 } }],
  },
  documentStyle: { pageSize: { width: 794, height: 1123 } },
});

const dirs: string[] = [];

const services: OfficeService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

async function setup(kind: "sheet" | "doc" = "sheet") {
  const dir = mkdtempSync(join(tmpdir(), "pioneer-office-test-"));
  dirs.push(dir);
  const store = new Storage(join(dir, "office.pgdata"));
  const service = new OfficeService(
    store,
    kind,
    kind === "sheet" ? sheet : doc,
  );
  services.push(service);
  await service.init();
  const owner = actor("Alice");
  const bob = actor("Bob");
  return { service, store, owner, bob, dir };
}

async function reopen(service: OfficeService, dir: string) {
  await service.close();
  services.splice(services.indexOf(service), 1);
  const make = service.kind === "sheet" ? sheet : doc;
  const reopened = new OfficeService(
    new Storage(join(dir, "office.pgdata")),
    service.kind,
    make,
  );
  services.push(reopened);
  await reopened.init();
  return reopened;
}

function branch(source: Y.Doc, change: (s: any) => void) {
  const d = fromUpdate(encode(source));
  const before = snapshot(d);
  const next = structuredClone(before);
  change(next);
  writeSnapshot(d, before, next);
  return d;
}

test("offline edits to different cells survive merging in either order", () => {
  const initial = createModel(sheet());
  const a = branch(initial, (s) => (s.sheets.main.cellData[0][1].v = 100));
  const b = branch(initial, (s) => (s.sheets.main.cellData[1][1].v = 200));
  Y.applyUpdate(a, encode(b));
  Y.applyUpdate(b, encode(a));
  expect(snapshot(a).sheets.main.cellData[0][1].v).toBe(100);
  expect(snapshot(a).sheets.main.cellData[1][1].v).toBe(200);
  expect(snapshot(a)).toEqual(snapshot(b));
});

test("concurrent rich text insertion and formatting preserve both intentions", () => {
  const initial = createModel(doc());
  const a = branch(initial, (s) =>
    applyOperation(s, { op: "insert_text", index: 0, text: "Dear " }, "doc"),
  );
  const b = branch(initial, (s) =>
    applyOperation(
      s,
      { op: "format_text", start: 6, end: 11, style: { it: 1 } },
      "doc",
    ),
  );
  Y.applyUpdate(a, encode(b));
  Y.applyUpdate(b, encode(a));
  const result = snapshot(a);
  expect(result.body.dataStream).toBe("Dear Hello world\r\n");
  expect(
    result.body.textRuns.some(
      (r: any) => r.st === 11 && r.ed === 16 && r.ts.it === 1,
    ),
  ).toBe(true);
  expect(result.body.paragraphs[0].startIndex).toBe(16);
  expect(snapshot(a)).toEqual(snapshot(b));
});

test("concurrent row insertion retains edits on stable cell identities", () => {
  const initial = createModel(sheet());
  const a = branch(initial, (s) =>
    applyOperation(s, { op: "insert_rows", index: 0, count: 1 }, "sheet"),
  );
  const b = branch(initial, (s) =>
    applyOperation(
      s,
      { op: "set_cells", range: "B2", values: [[99]] },
      "sheet",
    ),
  );
  Y.applyUpdate(a, encode(b));
  Y.applyUpdate(b, encode(a));
  const result = snapshot(a);
  expect(result.sheets.main.rowCount).toBe(11);
  expect(result.sheets.main.cellData[2][1].v).toBe(99);
  expect(result.sheets.main.cellData[1][0].v).toBe("Item");
  expect(snapshot(a)).toEqual(snapshot(b));
});

test("concurrent insertions of rows both remain", () => {
  const initial = createModel(sheet());
  const a = branch(initial, (s) =>
    applyOperation(s, { op: "insert_rows", index: 0, count: 1 }, "sheet"),
  );
  const b = branch(initial, (s) =>
    applyOperation(s, { op: "insert_rows", index: 0, count: 1 }, "sheet"),
  );
  Y.applyUpdate(a, encode(b));
  expect(snapshot(a).sheets.main.rowCount).toBe(12);
  expect(snapshot(a).sheets.main.cellData[2][0].v).toBe("Item");
});

test("local undo does not undo another participant", () => {
  const initial = createModel(sheet());
  const a = fromUpdate(encode(initial));
  const undo = new Y.UndoManager(a.getMap("unit"), {
    trackedOrigins: new Set(["editor"]),
  });
  const before = snapshot(a);
  const next = structuredClone(before);
  next.sheets.main.cellData[0][1].v = 111;
  writeSnapshot(a, before, next);
  const b = branch(initial, (s) => (s.sheets.main.cellData[1][1].v = 222));
  Y.applyUpdate(a, encode(b), "remote");
  undo.undo();
  expect(snapshot(a).sheets.main.cellData[0][1].v).toBe(10);
  expect(snapshot(a).sheets.main.cellData[1][1].v).toBe(222);
});

test("persisted content survives a service restart with the same Pioneer principal", async () => {
  const { service, owner, dir } = await setup();
  const d = await service.create(owner.identity);
  await new OfficeAI(service).execute(d.id, owner.identity, [
    { op: "set_cells", range: "B2", values: [[123]] },
  ]);
  const reopened = await reopen(service, dir);
  expect(
    (await reopened.get(d.id, owner.identity)).snapshot.sheets.main
      .cellData[1][1].v,
  ).toBe(123);
});

test("idempotent retry of agent edit changes the document only once", async () => {
  const { service, owner } = await setup("doc");
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  await ai.execute(
    d.id,
    owner.identity,
    [{ op: "insert_text", index: 0, text: "Once " }],
    "same-request",
  );
  const retry = await ai.execute(
    d.id,
    owner.identity,
    [{ op: "insert_text", index: 0, text: "Once " }],
    "same-request",
  );
  expect(retry.duplicate).toBe(true);
  const current = await service.get(d.id, owner.identity);
  expect(current.revision).toBe(1);
  expect(current.snapshot.body.dataStream).toBe("Once Hello world\r\n");
});

test("invalid batch is atomic and stale edits are rejected", async () => {
  const { service, owner } = await setup();
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  await expect(
    ai.execute(d.id, owner.identity, [
      { op: "set_cells", range: "B2", values: [[555]] },
      { op: "remove_sheet" },
    ]),
  ).rejects.toThrow();
  expect((await service.get(d.id, owner.identity)).revision).toBe(0);
  await ai.execute(d.id, owner.identity, [{ op: "rename", title: "New" }]);
  await expect(
    ai.execute(
      d.id,
      owner.identity,
      [{ op: "rename", title: "Stale" }],
      undefined,
      0,
    ),
  ).rejects.toThrow("Stale revision");
  expect((await service.get(d.id, owner.identity)).title).toBe("New");
});

test("viewer cannot edit through either mutation or raw update", async () => {
  const { service, owner, bob } = await setup();
  const d = await service.create(owner.identity);
  await service.setMember(d.id, owner.identity, bob.identity.id, "viewer");
  await expect(
    new OfficeAI(service).execute(d.id, bob.identity, [
      { op: "rename", title: "No" },
    ]),
  ).rejects.toThrow("Permission denied");
  await expect(
    service.update(d.id, bob.identity, {
      update: d.update,
      requestId: "attempt",
    }),
  ).rejects.toThrow("Permission denied");
  expect((await service.get(d.id, bob.identity)).role).toBe("viewer");
});

test("trash restore duplicate and permanent deletion have distinct lifecycles", async () => {
  const { service, owner } = await setup();
  const d = await service.create(owner.identity);
  const copy: any = await service.meta(d.id, owner.identity, "duplicate");
  expect(copy.id).not.toBe(d.id);
  await service.meta(d.id, owner.identity, "trash");
  expect((await service.list(owner.identity)).map((d) => d.id)).toEqual([
    copy.id,
  ]);
  expect((await service.list(owner.identity, true))[0].id).toBe(d.id);
  await expect(service.get(d.id, owner.identity)).rejects.toThrow(
    "Document is in trash",
  );
  await service.meta(d.id, owner.identity, "restore");
  expect((await service.get(d.id, owner.identity)).title).toBe("Budget");
  await expect(service.meta(d.id, owner.identity, "purge")).rejects.toThrow(
    "Move the document to trash first",
  );
  await service.meta(d.id, owner.identity, "trash");
  await service.meta(d.id, owner.identity, "purge");
  await expect(service.get(d.id, owner.identity)).rejects.toThrow(
    "Document not found",
  );
});

test("restoring history creates a new revision and retains later history", async () => {
  const setupResult = await setup();
  const { owner, dir } = setupResult;
  let service = setupResult.service;
  const data: any = sheet();
  const retainedText = "Original history payload ".repeat(1000);
  data.sheets.main.cellData[9] = { 0: { v: retainedText } };
  const d = await service.create(owner.identity, undefined, data);
  // Cross the 256-record checkpoint boundary using tiny accepted deltas. They
  // must retain durability without manufacturing 257 visible versions.
  for (let i = 0; i < 257; i++)
    await service.update(d.id, owner.identity, {
      update: base64(new Uint8Array([0, 0])),
      requestId: `history-noop-${i}`,
    });
  service = await reopen(service, dir);
  expect(
    (await service.get(d.id, owner.identity)).snapshot.sheets.main
      .cellData[9][0].v,
  ).toBe(retainedText);
  expect(
    (await service.history(d.id, owner.identity)).map((r) => r.revision),
  ).toEqual([0]);

  await new OfficeAI(service).execute(d.id, owner.identity, [
    { op: "set_cells", range: "B1", values: [[999]] },
    { op: "set_cells", range: "A10", values: [["Changed payload"]] },
  ]);
  await service.restoreVersion(d.id, 0, owner.identity);
  service = await reopen(service, dir);
  const historical = await service.version(d.id, 1, owner.identity);
  expect(historical.sheets.main.cellData[0][1].v).toBe(999);
  expect(historical.sheets.main.cellData[9][0].v).toBe("Changed payload");
  expect(
    (await service.get(d.id, owner.identity)).snapshot.sheets.main
      .cellData[0][1].v,
  ).toBe(10);
  expect(
    (await service.get(d.id, owner.identity)).snapshot.sheets.main
      .cellData[9][0].v,
  ).toBe(retainedText);
  expect(
    (await service.history(d.id, owner.identity)).map((r) => r.revision),
  ).toEqual([2, 1, 0]);
});

test("no-op, viewport and formula-cache updates retain causality without adding history", async () => {
  const setupResult = await setup();
  const { owner, dir } = setupResult;
  let service = setupResult.service;
  const data: any = sheet();
  data.sheets.main.cellData[0][2] = { f: "=B1*2", v: 20, t: 2 };
  const created = await service.create(owner.identity, undefined, data);
  const local = fromUpdate(Buffer.from(created.update, "base64"));
  try {
    const vector = Y.encodeStateVector(local);
    const before = snapshot(local),
      next = structuredClone(before);
    next.sheets.main.zoomRatio = 1.5;
    next.sheets.main.scrollTop = 200;
    next.sheets.main.cellData[0][2].v = 200;
    writeSnapshot(local, before, next);
    // Same visible title, new CRDT item. Later deltas may depend on this item.
    local.getMap("unit").set("name", before.name);
    const update = base64(Y.encodeStateAsUpdate(local, vector));
    const input = { update, requestId: "derived-and-view" };
    expect(
      (await service.update(created.id, owner.identity, input)).revision,
    ).toBe(0);
    expect(
      await service.update(created.id, owner.identity, input),
    ).toMatchObject({ revision: 0, duplicate: true });
    expect(
      (await service.history(created.id, owner.identity)).map(
        (row) => row.revision,
      ),
    ).toEqual([0]);

    service = await reopen(service, dir);
    const followup = Y.encodeStateVector(local);
    local.getMap("unit").set("name", "Subsequent edit");
    const edited = await service.update(created.id, owner.identity, {
      update: base64(Y.encodeStateAsUpdate(local, followup)),
      requestId: "content-edit",
    });
    expect(edited.revision).toBe(1);
    const current = await service.get(created.id, owner.identity);
    expect(current.title).toBe("Subsequent edit");
    expect(current.snapshot.sheets.main.cellData[0][2]).toMatchObject({
      f: "=B1*2",
      v: 200,
    });
    expect(
      (await service.history(created.id, owner.identity)).map(
        (row) => row.revision,
      ),
    ).toEqual([1, 0]);
    expect(
      (await service.mutate(created.id, owner.identity, () => {}, "No change"))
        .revision,
    ).toBe(1);
    expect(
      (await service.history(created.id, owner.identity)).map(
        (row) => row.revision,
      ),
    ).toEqual([1, 0]);
  } finally {
    local.destroy();
  }
});

test("presence joins, selection changes and leaves do not create revisions", async () => {
  const { service, owner, bob } = await setup();
  const d = await service.create(owner.identity);
  const events: any[] = [];
  const unsubscribe = service.subscribe(d.id, (event) => events.push(event));
  service.presence(d.id, bob.identity, "tab-b", {
    sheetId: "main",
    range: "B2",
  });
  expect(service.members(d.id)[0].name).toBe("Bob");
  service.presence(d.id, bob.identity, "tab-b", {
    sheetId: "main",
    range: "B2",
  });
  expect(events.filter((event) => event.type === "presence")).toHaveLength(1);
  service.presence(d.id, bob.identity, "tab-b", {
    sheetId: "main",
    range: "C3",
  });
  expect(service.members(d.id)).toHaveLength(1);
  expect(service.members(d.id)[0].selection?.range).toBe("C3");
  service.leave(d.id, "tab-b");
  expect(service.members(d.id)).toHaveLength(0);
  expect(events.filter((event) => event.type === "presence")).toHaveLength(3);
  unsubscribe();
  expect((await service.get(d.id, owner.identity)).revision).toBe(0);
});

test("agent formulas calculate without a browser and structural edits update references", async () => {
  const { service, owner } = await setup();
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  await ai.execute(d.id, owner.identity, [
    { op: "set_cells", range: "C1:D1", values: [[7, "=C1*3"]] },
  ]);
  let view: any = await ai.inspect(d.id, owner.identity, { range: "D1" });
  expect(view.values[0][0].v).toBe(21);
  await ai.execute(d.id, owner.identity, [
    { op: "insert_rows", index: 0, count: 1 },
  ]);
  view = await ai.inspect(d.id, owner.identity, { range: "D2" });
  expect(view.values[0][0].f).toBe("=C2*3");
  expect(view.values[0][0].v).toBe(21);
});

test("parallel writers on different documents persist all their operations", async () => {
  const { service, owner } = await setup();
  const docs = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      service.create(owner.identity, "Parallel " + i),
    ),
  );
  await Promise.all(
    docs.map((d, i) =>
      new OfficeAI(service).execute(d.id, owner.identity, [
        { op: "set_cells", range: "B1", values: [[i + 100]] },
      ]),
    ),
  );
  for (let i = 0; i < docs.length; i++)
    expect(
      (await service.get(docs[i].id, owner.identity)).snapshot.sheets.main
        .cellData[0][1].v,
    ).toBe(i + 100);
});

test("simultaneous CRDT submissions to one document produce continuous persisted revisions", async () => {
  const { service, owner } = await setup();
  const d = await service.create(owner.identity);
  const base = fromUpdate(
    (await import("../src/shared/documents/model")).unbase64(d.update),
  );
  const changes = Array.from({ length: 8 }, (_, i) => {
    const branch = fromUpdate(encode(base));
    const vector = Y.encodeStateVector(branch);
    const a = snapshot(branch),
      b = structuredClone(a);
    b.sheets.main.cellData[i] ??= {};
    b.sheets.main.cellData[i][2] = { v: i + 30 };
    writeSnapshot(branch, a, b);
    return {
      update: base64(Y.encodeStateAsUpdate(branch, vector)),
      requestId: "parallel-" + i,
    };
  });
  await Promise.all(
    changes.map((c) => service.update(d.id, owner.identity, c)),
  );
  const saved = await service.get(d.id, owner.identity);
  expect(saved.revision).toBe(8);
  for (let i = 0; i < 8; i++)
    expect(saved.snapshot.sheets.main.cellData[i][2].v).toBe(i + 30);
  expect(
    (await service.history(d.id, owner.identity)).map((h) => h.revision),
  ).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test("rich text Unicode offsets and overlapping formatting survive synchronization", () => {
  const data = doc();
  data.body.dataStream = "A😀Б\r\n";
  data.body.paragraphs = [{ startIndex: 4, paragraphId: "p" }];
  data.body.textRuns = [];
  const initial = createModel(data);
  const a = branch(initial, (s) =>
    applyOperation(
      s,
      { op: "format_text", start: 1, end: 3, style: { bl: 1 } },
      "doc",
    ),
  );
  const b = branch(initial, (s) =>
    applyOperation(s, { op: "insert_text", index: 0, text: "Ж" }, "doc"),
  );
  Y.applyUpdate(a, encode(b));
  expect(snapshot(a).body.dataStream).toBe("ЖA😀Б\r\n");
  expect(
    snapshot(a).body.textRuns.some(
      (r: any) => r.st === 2 && r.ed === 4 && r.ts.bl === 1,
    ),
  ).toBe(true);
});

test("replace all handles a match at offset zero without reprocessing replacement text", async () => {
  const { service, owner } = await setup("doc");
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  await ai.execute(d.id, owner.identity, [
    { op: "find_replace", find: "Hello", replace: "Hello!", all: true },
  ]);
  expect(
    (await service.get(d.id, owner.identity)).snapshot.body.dataStream,
  ).toBe("Hello! world\r\n");
  await ai.execute(d.id, owner.identity, [
    { op: "find_replace", find: "Hello!", replace: "", all: true },
  ]);
  expect(
    (await service.get(d.id, owner.identity)).snapshot.body.dataStream,
  ).toBe(" world\r\n");
});

test("a concurrently edited formula follows its referenced row through insertion", () => {
  const initial = createModel(sheet());
  const a = branch(initial, (s) =>
    applyOperation(s, { op: "insert_rows", index: 0, count: 1 }, "sheet"),
  );
  const b = branch(initial, (s) =>
    applyOperation(
      s,
      { op: "set_cells", range: "C2", values: [["=$B$2*4"]] },
      "sheet",
    ),
  );
  Y.applyUpdate(a, encode(b));
  Y.applyUpdate(b, encode(a));
  expect(snapshot(a).sheets.main.cellData[2][2].f).toBe("=$B$3*4");
  expect(snapshot(a)).toEqual(snapshot(b));
});

test("formula anchoring leaves quoted string literals intact", () => {
  const data = sheet();
  (data.sheets.main.cellData[0] as any)[2] = { f: '=IF(B1>0,"B2",B2)' };
  const initial = createModel(data);
  const a = branch(initial, (s) =>
    applyOperation(s, { op: "insert_rows", index: 0, count: 1 }, "sheet"),
  );
  expect(snapshot(a).sheets.main.cellData[1][2].f).toBe('=IF(B2>0,"B2",B3)');
});

test("independent plugin changes merge without replacing the entire resource list", () => {
  const data: any = sheet();
  data.resources = [
    {
      name: "VALIDATION",
      data: JSON.stringify({
        main: { first: { rule: "A" }, second: { rule: "B" } },
      }),
    },
  ];
  const initial = createModel(data);
  const a = branch(initial, (s) => {
    const d = JSON.parse(s.resources[0].data);
    d.main.first.rule = "Alice";
    s.resources[0].data = JSON.stringify(d);
  });
  const b = branch(initial, (s) => {
    const d = JSON.parse(s.resources[0].data);
    d.main.second.rule = "Bob";
    s.resources[0].data = JSON.stringify(d);
  });
  Y.applyUpdate(a, encode(b));
  const resource = JSON.parse(snapshot(a).resources[0].data);
  expect(resource.main.first.rule).toBe("Alice");
  expect(resource.main.second.rule).toBe("Bob");
});

test("relative cursors and selected cells follow remote text and row insertion", async () => {
  const { anchorSelection, resolveSelection } =
    await import("../src/shared/documents/model");
  const text = createModel(doc());
  const caret = anchorSelection(text, { start: 6, end: 11 });
  const next = branch(text, (s) =>
    applyOperation(s, { op: "insert_text", index: 0, text: "Dear " }, "doc"),
  );
  Y.applyUpdate(text, encode(next));
  expect(resolveSelection(text, caret)).toMatchObject({ start: 11, end: 16 });
  const grid = createModel(sheet());
  const selection = anchorSelection(grid, { sheetId: "main", range: "B2" });
  const moved = branch(grid, (s) =>
    applyOperation(s, { op: "insert_rows", index: 0, count: 1 }, "sheet"),
  );
  Y.applyUpdate(grid, encode(moved));
  expect(resolveSelection(grid, selection).range).toBe("B3:B3");
});

test("isolated agent draft merges with concurrent main edits only after owner review", async () => {
  const { service, owner, bob } = await setup();
  const source = await service.create(owner.identity);
  const draft = await service.createDraft(source.id, bob.identity);
  const ai = new OfficeAI(service);
  await ai.execute(draft.id, bob.identity, [
    { op: "set_cells", range: "A1", values: [["Draft proposal"]] },
  ]);
  await ai.execute(source.id, owner.identity, [
    { op: "set_cells", range: "B2", values: [[99]] },
  ]);
  expect(
    (await service.get(source.id, owner.identity)).snapshot.sheets.main
      .cellData[0][0].v,
  ).toBe("Item");
  await service.reviewDraft(draft.id, bob.identity, "ready");
  expect((await service.get(draft.id, bob.identity)).role).toBe("viewer");
  await expect(
    ai.execute(draft.id, bob.identity, [{ op: "rename", title: "Locked" }]),
  ).rejects.toThrow("Draft is closed for editing");
  await expect(
    service.reviewDraft(draft.id, bob.identity, "merge"),
  ).rejects.toThrow("Permission denied");
  const accepted = await service.reviewDraft(draft.id, owner.identity, "merge");
  const final = await service.get(source.id, owner.identity);
  expect(final.snapshot.sheets.main.cellData[0][0].v).toBe("Draft proposal");
  expect(final.snapshot.sheets.main.cellData[1][1].v).toBe(99);
  expect(final.revision).toBe(2);
  expect(await service.reviewDraft(draft.id, owner.identity, "merge")).toEqual(
    accepted,
  );
  expect((await service.get(source.id, owner.identity)).revision).toBe(2);
});

test("document draft preserves simultaneous rich text and can return from review to editing", async () => {
  const { service, owner, bob } = await setup("doc");
  const source = await service.create(owner.identity);
  const draft = await service.createDraft(source.id, bob.identity);
  const ai = new OfficeAI(service);
  await ai.execute(draft.id, bob.identity, [
    { op: "insert_text", index: 0, text: "Agent " },
  ]);
  await service.reviewDraft(draft.id, bob.identity, "ready");
  await service.reviewDraft(draft.id, bob.identity, "reopen");
  await ai.execute(draft.id, bob.identity, [
    { op: "format_text", start: 0, end: 5, style: { it: 1 } },
  ]);
  await ai.execute(source.id, owner.identity, [
    { op: "insert_text", index: 11, text: " from Alice" },
  ]);
  await service.reviewDraft(draft.id, bob.identity, "ready");
  await service.reviewDraft(draft.id, owner.identity, "merge");
  const s = (await service.get(source.id, owner.identity)).snapshot;
  expect(s.body.dataStream).toBe("Agent Hello world from Alice\r\n");
  expect(
    s.body.textRuns.some((x: any) => x.st === 0 && x.ed === 5 && x.ts.it === 1),
  ).toBe(true);
});

test("sheet agent operations preserve formatting and sheet structure through SQLite", async () => {
  const { service, owner } = await setup();
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  await ai.execute(d.id, owner.identity, [
    { op: "format_cells", range: "A1:B1", style: { bl: 1 } },
    { op: "freeze", rows: 1, columns: 1 },
    { op: "resize", axis: "column", index: 0, size: 220 },
    { op: "merge", range: "A4:B4" },
    { op: "add_sheet", name: "Notes" },
  ]);
  let s = (await service.get(d.id, owner.identity)).snapshot;
  expect(s.sheets.main.cellData[0][0].s.bl).toBe(1);
  expect(s.sheets.main.freeze.ySplit).toBe(1);
  expect(s.sheets.main.columnData[0].w).toBe(220);
  expect(s.sheets.main.mergeData).toHaveLength(1);
  expect(s.sheetOrder).toHaveLength(2);
  const other = s.sheetOrder[1];
  await ai.execute(d.id, owner.identity, [
    { op: "rename_sheet", sheet: other, name: "Agent notes" },
    { op: "move_sheet", sheet: other, index: 0 },
    {
      op: "set_cells",
      sheet: other,
      range: "A1:B2",
      values: [
        ["b", 2],
        ["a", 1],
      ],
    },
    { op: "sort", sheet: other, range: "A1:B2", column: 0 },
  ]);
  s = (await service.get(d.id, owner.identity)).snapshot;
  expect(s.sheetOrder[0]).toBe(other);
  expect(s.sheets[other].name).toBe("Agent notes");
  expect(s.sheets[other].cellData[0][0].v).toBe("a");
  await ai.execute(d.id, owner.identity, [
    { op: "unmerge", sheet: "main", range: "A4:B4" },
    { op: "clear_cells", sheet: other, range: "A1:B2" },
    { op: "remove_sheet", sheet: other },
  ]);
  s = (await service.get(d.id, owner.identity)).snapshot;
  expect(s.sheetOrder).toEqual(["main"]);
  expect(s.sheets.main.mergeData).toHaveLength(0);
});

test("document agent edits preserve paragraph style, page setup and imported content", async () => {
  const { service, owner } = await setup("doc");
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  await ai.execute(d.id, owner.identity, [
    { op: "replace_text", start: 6, end: 11, text: "team" },
    { op: "insert_text", index: 10, text: "\nNew paragraph" },
    {
      op: "format_paragraph",
      start: 0,
      end: 100,
      style: { horizontalAlign: 2 },
    },
    { op: "page_setup", style: { marginTop: 80 } },
  ]);
  const s = (await service.get(d.id, owner.identity)).snapshot;
  expect(s.body.dataStream).toBe("Hello team\rNew paragraph\r\n");
  expect(s.body.paragraphs).toHaveLength(2);
  expect(
    s.body.paragraphs.every((p: any) => p.paragraphStyle.horizontalAlign === 2),
  ).toBe(true);
  expect(s.documentStyle.marginTop).toBe(80);
  const imported = await service.create(owner.identity, "Imported", s);
  expect(imported.id).not.toBe(d.id);
  expect(imported.snapshot.body).toEqual(s.body);
  expect(imported.snapshot.documentStyle).toEqual(s.documentStyle);
});

test("readable export keeps sparse rows, columns and quoted values in their positions", async () => {
  const { readable } = await import("../src/shared/documents/text");
  const s: any = sheet();
  s.sheets.main.cellData = { 2: { 2: { v: "one\ttwo" } } };
  expect(readable(s, "sheet")).toBe('Main\n\t\t\n\t\t\n\t\t"one\ttwo"');
  expect(readable(doc(), "doc")).toBe("Hello world");
});

test("headless agent edits retain plugin resources and move their ranges with rows", async () => {
  const { service, owner } = await setup();
  const data: any = sheet();
  data.resources = [
    {
      name: "SHEET_FILTER_PLUGIN",
      data: JSON.stringify({
        main: {
          ref: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
          filterColumns: [],
        },
      }),
    },
    {
      name: "SHEET_DATA_VALIDATION_PLUGIN",
      data: JSON.stringify({
        main: [
          {
            uid: "status",
            type: "list",
            formula1: "A,B",
            ranges: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }],
          },
        ],
      }),
    },
    { name: "CUSTOM_EXTENSION", data: JSON.stringify({ enabled: true }) },
  ];
  const d = await service.create(owner.identity, "Resources", data);
  await new OfficeAI(service).execute(d.id, owner.identity, [
    { op: "insert_rows", index: 0, count: 1 },
  ]);
  const s = (await service.get(d.id, owner.identity)).snapshot;
  const resource = (name: string) =>
    JSON.parse(s.resources.find((r: any) => r.name === name).data);
  expect(resource("SHEET_FILTER_PLUGIN").main.ref.startRow).toBe(1);
  expect(
    resource("SHEET_DATA_VALIDATION_PLUGIN").main[0].ranges[0].startRow,
  ).toBe(2);
  expect(resource("CUSTOM_EXTENSION")).toEqual({ enabled: true });
});

test("text inspection accepts HTTP numeric offsets and bounds large output", async () => {
  const { service, owner } = await setup("doc");
  const d = await service.create(owner.identity);
  const ai = new OfficeAI(service);
  const part: any = await ai.inspect(d.id, owner.identity, {
    start: "6",
    end: "11",
  } as any);
  expect(part.text).toBe("world");
  const large = doc();
  large.body = {
    dataStream: "x".repeat(20000) + "\r\n",
    paragraphs: [{ startIndex: 20000, paragraphId: "large" }],
    textRuns: [],
  };
  const long = await service.create(owner.identity, "Long", large);
  const bounded: any = await ai.inspect(long.id, owner.identity, {
    start: 0,
    end: 20000,
  });
  expect(bounded.text.length).toBe(10000);
  const search: any = await ai.inspect(long.id, owner.identity, { query: "x" });
  expect(search.matches).toHaveLength(500);
  await expect(
    ai.inspect(d.id, owner.identity, { start: "invalid" } as any),
  ).rejects.toThrow("Invalid text range");
});

test("image and link anchors follow concurrent text insertion instead of last-writer offsets", () => {
  const data: any = doc();
  data.body.dataStream = "Hello \bworld\r\n";
  data.body.customBlocks = [{ startIndex: 6, blockId: "picture" }];
  data.body.customRanges = [{ startIndex: 0, endIndex: 6, rangeId: "link" }];
  const initial = createModel(data);
  const a = branch(initial, (s) =>
    applyOperation(s, { op: "insert_text", index: 0, text: "A" }, "doc"),
  );
  const b = branch(initial, (s) =>
    applyOperation(s, { op: "insert_text", index: 0, text: "B" }, "doc"),
  );
  Y.applyUpdate(a, encode(b));
  Y.applyUpdate(b, encode(a));
  const result = snapshot(a);
  expect(result.body.customBlocks[0].startIndex).toBe(8);
  expect(result.body.dataStream[8]).toBe("\b");
  expect(result.body.customRanges[0].endIndex).toBe(8);
  expect(snapshot(a)).toEqual(snapshot(b));
  expect(JSON.stringify(result)).not.toContain("$positions");
});

test("a causal update received before its dependency survives restart", async () => {
  const fixture = await setup();
  const { owner, dir } = fixture;
  let service = fixture.service;
  const created = await service.create(owner.identity);
  const local = fromUpdate(Buffer.from(created.update, "base64"));
  try {
    const start = Y.encodeStateVector(local);
    const metadata = new Y.Map();
    local.getMap("unit").set("customMetadata", metadata);
    const dependency = base64(Y.encodeStateAsUpdate(local, start));
    const middle = Y.encodeStateVector(local);
    metadata.set("value", "Resolved after restart");
    const pending = base64(Y.encodeStateAsUpdate(local, middle));
    const accepted = await service.update(created.id, owner.identity, {
      update: pending,
      requestId: "pending-dependency",
    });
    expect(accepted.revision).toBe(0);
    service = await reopen(service, dir);
    await service.update(created.id, owner.identity, {
      update: dependency,
      requestId: "dependency",
    });
    const current = await service.get(created.id, owner.identity);
    expect(current.revision).toBe(1);
    expect(current.snapshot.customMetadata.value).toBe(
      "Resolved after restart",
    );
    expect(
      (await service.version(created.id, 0, owner.identity)).customMetadata,
    ).toBeUndefined();
  } finally {
    local.destroy();
  }
});

test("failed persistence exposes no candidate and permits retry of the same request", async () => {
  const { service, owner, dir } = await setup();
  const created = await service.create(owner.identity);
  const local = fromUpdate(Buffer.from(created.update, "base64"));
  const vector = Y.encodeStateVector(local);
  local.getMap("unit").set("name", "Committed later");
  const input = {
    update: base64(Y.encodeStateAsUpdate(local, vector)),
    requestId: "retry-after-failure",
  };
  local.destroy();
  const events: any[] = [];
  const unsubscribe = service.subscribe(created.id, (event) =>
    events.push(event),
  );
  const removeFailure = service.onPersist(async () => {
    throw new Error("Persistence rejected");
  });
  try {
    await expect(
      service.update(created.id, owner.identity, input),
    ).rejects.toThrow("Persistence rejected");
    expect(events).toEqual([]);
    expect((await service.get(created.id, owner.identity)).title).toBe(
      "Budget",
    );
    removeFailure();
    expect(
      await service.update(created.id, owner.identity, input),
    ).toMatchObject({ revision: 1, duplicate: false });
    expect(events.map((event) => event.title)).toEqual(["Committed later"]);
    const reopened = await reopen(service, dir);
    expect((await reopened.get(created.id, owner.identity)).title).toBe(
      "Committed later",
    );
    expect(
      await reopened.update(created.id, owner.identity, input),
    ).toMatchObject({ revision: 1, duplicate: true });
    expect(
      (await reopened.history(created.id, owner.identity)).map(
        (r) => r.revision,
      ),
    ).toEqual([1, 0]);
  } finally {
    removeFailure();
    unsubscribe();
  }
});

test("an asynchronous mutation permits other edits and rejects its stale result", async () => {
  const { service, owner } = await setup();
  const created = await service.create(owner.identity);
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = service
    .mutate(
      created.id,
      owner.identity,
      async (data) => {
        started();
        await gate;
        data.name = "Stale calculation";
      },
      "Slow calculation",
    )
    .then(
      () => "committed",
      (error: Error) => error.message,
    );
  await ready;
  const local = fromUpdate(Buffer.from(created.update, "base64"));
  const vector = Y.encodeStateVector(local);
  local.getMap("unit").set("name", "Concurrent edit");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      service.update(created.id, owner.identity, {
        update: base64(Y.encodeStateAsUpdate(local, vector)),
        requestId: "while-calculating",
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Document lock held during calculation")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    release();
    local.destroy();
  }
  expect(await slow).toContain("changed");
  const current = await service.get(created.id, owner.identity);
  expect(current.title).toBe("Concurrent edit");
  expect(current.revision).toBe(1);
});
