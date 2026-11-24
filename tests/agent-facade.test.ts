import { actor } from "./identity";
import { test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/server/db/database";
import { OfficeService } from "../src/server/documents/service";
import { AgentManager } from "../src/server/agent/manager";
import { AgentLibrary } from "../src/server/agent/library";

const clean: Array<() => void | Promise<void>> = [];

beforeAll(() => execFileSync("bun", ["scripts/build-agent.ts"]));

afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});

async function setup(kind: "sheet" | "doc") {
  const dir = mkdtempSync(join(tmpdir(), "agent-facade-"));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const storage = new Storage(join(dir, "db.pgdata"));
  const seed = () =>
    kind === "doc"
      ? {
          id: "doc",
          title: "Base",
          body: { dataStream: "Old text\r\n", paragraphs: [{ startIndex: 8 }] },
          documentStyle: { documentFlavor: 1 },
        }
      : {
          id: "book",
          name: "Base",
          sheetOrder: ["sheet"],
          sheets: {
            sheet: {
              id: "sheet",
              name: "Main",
              rowCount: 30,
              columnCount: 20,
              cellData: {},
            },
          },
          styles: {},
        };
  const service = new OfficeService(storage, kind, seed);
  clean.push(() => service.close());
  await service.init();
  const owner = actor("Owner").identity,
    other = actor("Other").identity;
  const document = await service.create(owner);
  const manager = new AgentManager(service);
  clean.push(() => manager.shutdown());
  const runtime = await manager.open(document.id, owner);
  return {
    service,
    owner,
    other,
    document,
    manager,
    runtime,
    library: new AgentLibrary(service),
  };
}

test("scoped Facade replacement consumes authorized resource data and remains staged until explicit commit", async () => {
  const e = await setup("doc");
  const data = {
    id: e.document.id,
    title: "Compiled",
    body: {
      dataStream: "New editable text\r\n",
      paragraphs: [{ startIndex: 17 }],
    },
    documentStyle: { marginTop: 50 },
  };
  const resource = await e.library.put(e.owner, {
    name: "document.json",
    mimeType: "application/json",
    data: Buffer.from(JSON.stringify(data)),
  });
  const code =
    "const id=document.getId();const data=resources.json(" +
    JSON.stringify(resource.id) +
    ');univerAPI.disposeUnit(id);const next=univerAPI.createDocument(data);next.insertText(0,"Facade ");return next.getId();';
  await e.manager.execute(e.runtime.runtimeId, e.owner, {
    mode: "write",
    code,
    resourceIds: [String(resource.id)],
  });
  expect(
    (await e.manager.export(e.runtime.runtimeId, e.owner)).snapshot.body
      .dataStream,
  ).toBe("Facade New editable text\r\n");
  expect(
    (await e.service.get(e.document.id, e.owner)).snapshot.body.dataStream,
  ).toBe("Old text\r\n");
  await e.manager.commit(e.runtime.runtimeId, e.owner);
  expect((await e.service.get(e.document.id, e.owner)).snapshot.title).toBe(
    "Compiled",
  );
});

test("lifecycle calls cannot create foreign units, destroy read targets or bind another actor resources", async () => {
  const e = await setup("doc");
  await expect(
    e.manager.execute(e.runtime.runtimeId, e.owner, {
      mode: "read",
      code: "univerAPI.disposeUnit(document.getId());",
    }),
  ).rejects.toThrow("SCOPE_VIOLATION");
  await expect(
    e.manager.execute(e.runtime.runtimeId, e.owner, {
      mode: "write",
      code: 'univerAPI.createDocument({id:"foreign"});',
    }),
  ).rejects.toThrow("SCOPE_VIOLATION");
  await expect(
    e.manager.execute(e.runtime.runtimeId, e.owner, {
      mode: "write",
      code: "univerAPI.disposeUnit(document.getId());",
    }),
  ).rejects.toThrow("SCOPE_VIOLATION");
  expect(
    (await e.manager.export(e.runtime.runtimeId, e.owner)).snapshot.body
      .dataStream,
  ).toBe("Old text\r\n");
  const privateResource = await e.library.put(e.other, {
    name: "private",
    mimeType: "text/plain",
    data: Buffer.from("secret"),
  });
  await expect(
    e.manager.execute(e.runtime.runtimeId, e.owner, {
      mode: "read",
      code: "return 1;",
      resourceIds: [String(privateResource.id)],
    }),
  ).rejects.toThrow("RESOURCE_NOT_FOUND");
});

test("Sheets Facade supports real filters, sorting, formatting, validation and table resources", async () => {
  const e = await setup("sheet");
  const id = e.runtime.runtimeId;
  const result = await e.manager.execute(id, e.owner, {
    mode: "write",
    code: 'const s=workbook.getActiveSheet();s.getRange("A1:B4").setValues([["Name","Score"],["Z",3],["A",1],["M",2]]);s.getRange("A2:B4").sort({column:1,ascending:true});s.getRange("A1:B1").setFontWeight("bold");s.getRange("A1:B4").createFilter();const rule=univerAPI.newDataValidation().requireNumberBetween(0,100).build();s.getRange("B2:B4").setDataValidation(rule);return s.getRange("A2:B4").getValues();',
  });
  expect(result.value).toEqual([
    ["A", 1],
    ["M", 2],
    ["Z", 3],
  ]);
  const exported = await e.manager.export(id, e.owner);
  expect(
    exported.snapshot.resources.some((r: any) => r.name.includes("FILTER")),
  ).toBe(true);
  expect(
    exported.snapshot.resources.some((r: any) => r.name.includes("VALIDATION")),
  ).toBe(true);
  await e.manager.commit(id, e.owner);
  const reopened = await e.manager.open(e.document.id, e.owner);
  expect(
    (
      await e.manager.execute(reopened.runtimeId, e.owner, {
        mode: "read",
        code: 'return workbook.getActiveSheet().getRange("B2").getDataValidation().getCriteriaType();',
      })
    ).value,
  ).toBeDefined();
});

test("native Docs paragraph formatting, sections, headers and images survive staging, commit and reload", async () => {
  const e = await setup("doc");
  const id = e.runtime.runtimeId;
  const result = await e.manager.execute(id, e.owner, {
    mode: "write",
    code: 'const p=document.findParagraphByText("Old text");p.getTextRange().setTextStyle({bl:1,fs:18});const header=document.ensurePageHeader(0);document.insertText(0,"Agent header",header);const image=await document.insertImage({source:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAz8AAAAASUVORK5CYII=",imageSourceType:univerAPI.Enum.ImageSourceType.BASE64,width:40,textRange:{startOffset:8,endOffset:8}});return {imageId:image.getId(),header};',
  });
  expect(result.value.imageId).toBeDefined();
  const snapshot = (await e.manager.export(id, e.owner)).snapshot;
  expect(
    snapshot.body.textRuns.some((r: any) => r.ts.bl === 1 && r.ts.fs === 18),
  ).toBe(true);
  expect(snapshot.headers[result.value.header].body.dataStream).toContain(
    "Agent header",
  );
  expect(Object.keys(snapshot.drawings)).toHaveLength(1);
  await e.manager.commit(id, e.owner);
  const reopened = await e.manager.open(e.document.id, e.owner);
  expect(
    (
      await e.manager.execute(reopened.runtimeId, e.owner, {
        mode: "read",
        code: "return document.getImages().map(image=>image.getSize());",
      })
    ).value[0],
  ).toEqual({ width: 40, height: 40 });
});

test("native Sheets table Facade materializes persistent structured table resources", async () => {
  const e = await setup("sheet"),
    id = e.runtime.runtimeId;
  const result = await e.manager.execute(id, e.owner, {
    mode: "write",
    code: 'const s=workbook.getActiveSheet();s.getRange("A1:B3").setValues([["Name","Value"],["A",1],["B",2]]);const added=await s.addTable("Results",{startRow:0,endRow:2,startColumn:0,endColumn:1},"results");return {added,table:workbook.getTableInfo("results")};',
  });
  expect(result.value.added).toBe(true);
  expect(result.value.table).toBeDefined();
  await e.manager.commit(id, e.owner);
  const reopened = await e.manager.open(e.document.id, e.owner);
  expect(
    (
      await e.manager.execute(reopened.runtimeId, e.owner, {
        mode: "read",
        code: 'return workbook.getTableInfo("results").name;',
      })
    ).value,
  ).toBe("Results");
});

test("authorized JSON resource keys beginning with underscores survive the agent bridge", async () => {
  const e = await setup("doc"),
    resource = await e.library.put(e.owner, {
      name: "Drawing map.json",
      mimeType: "application/json",
      data: Buffer.from(
        JSON.stringify({
          _asset: { label: "Retained drawing metadata" },
          normal: "ordinary",
        }),
      ),
    });
  const result = await e.manager.execute(e.runtime.runtimeId, e.owner, {
    mode: "read",
    resourceIds: [String(resource.id)],
    code:
      "const payload=resources.json(" +
      JSON.stringify(resource.id) +
      ");return payload._asset.label;",
  });
  expect(result.value).toBe("Retained drawing metadata");
});
