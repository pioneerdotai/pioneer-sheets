import { test, expect, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHarness } from "./harness.mjs";

let h: Awaited<ReturnType<typeof createHarness>>;

test.beforeAll(async () => {
  h = await createHarness();
});

test.afterAll(async () => {
  await h?.close();
});

async function open(
  page: Page,
  id?: string,
  view = "alice",
  initialTheme = "light",
) {
  await page.goto(
    h.origin +
      "/shell?view=" +
      view +
      (id ? "&document=" + id : "") +
      "&theme=" +
      initialTheme,
  );
  const frame = page.frameLocator("iframe");
  if (id) {
    await expect(frame.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(frame.locator("canvas").first()).toBeVisible();
    await expect(frame.getByRole("status")).toContainText("Saved");
  } else {
    await expect(frame.getByRole("textbox", { name: "Search documents" })).toBeVisible();
  }
  return frame;
}

async function mcp(name = "test-agent") {
  const client = new Client({
    name: "installed-sheets-agent",
    version: "1.0.0",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(h.origin + "/mcp/" + name)),
  );
  return client;
}

async function tool(c: Client, name: string, args: any = {}) {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(JSON.stringify(r.content));
  return (
    (r.structuredContent as any)?.result ??
    JSON.parse((r.content as any)[0].text)
  );
}

async function select(page: Page, range: string) {
  const f = page.frameLocator("iframe");
  const input = f
    .locator("input:not([aria-label]):not([type=file])")
    .filter({ visible: true })
    .first();
  await input.fill(range);
  await input.press("Enter");
}

async function enter(page: Page, range: string, value: string) {
  await page.bringToFront();
  await select(page, range);
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

async function download(page: Page, format: string) {
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "Download", exact: true }).click();
  const [result] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    frame.getByRole("menuitem", { name: format.toUpperCase(), exact: true }).click(),
  ]);
  return result;
}

test("execution credential, Pioneer principal and actor are required; custom login is absent", async ({
  page,
}) => {
  expect((await fetch(h.backend + "/api/health")).status).toBe(401);
  expect(
    (
      await fetch(h.backend + "/api/health", {
        headers: { "Pioneer-App-Execution-Credential": h.credential },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await fetch(h.backend + "/api/context", {
        headers: { "Pioneer-App-Execution-Credential": h.credential },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(h.view() + "api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Impostor", type: "agent" }),
      })
    ).status,
  ).toBe(404);
  const f = await open(page);
  await expect(f.getByLabel("Your name")).toHaveCount(0);
  const supplied = await h.api("context");
  expect(supplied.identity.id).toBe(h.principals.alice);
  const r = await fetch(h.view() + "api/context", {
    headers: { "Pioneer-App-User-Id": h.principals.bob },
  });
  expect((await r.json()).identity.id).toBe(h.principals.alice);
  const document = await h.api("documents", { title: "MCP authority" });
  const withoutAgent = new Client({ name: "missing-agent-probe", version: "1.0.0" });
  try {
    await withoutAgent.connect(new StreamableHTTPClientTransport(
      new URL(h.backend + "/api/mcp"),
      {
        requestInit: { headers: {
          "Pioneer-App-Execution-Credential": h.credential,
          "Pioneer-App-User-Id": h.principals.alice,
        } },
      },
    ));
    const denied = await withoutAgent.callTool({
      name: "document_read",
      arguments: { documentId: document.id },
    });
    expect(denied.isError).toBe(true);
    expect(denied.content).toContainEqual({
      type: "text",
      text: "PIONEER_AGENT_ID_REQUIRED",
    });
  } finally {
    await withoutAgent.close();
  }
});

test("opaque WebView uses only its grant root; theme and retained placement survive editing", async ({
  page,
}) => {
  const d = await h.api("documents", {
    title: "Theme and placement",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log(e.stack);
  });
  const f = await open(page, d.id, "alice", "dark");
  expect(
    await page.frames()[1].evaluate(() => {
      try {
        localStorage.getItem("x");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await expect(f.locator("body")).toHaveCSS(
    "background-color",
    "rgb(24, 28, 32)",
  );
  await expect(f.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(
    f.getByRole("button", { name: "Attachments", exact: true }),
  ).toHaveCSS("font-family", /Inter Variable/);
  await f.getByRole("button", { name: "Attachments", exact: true }).click();
  const panel = f.getByRole("dialog", {
    name: "Document attachments",
    exact: true,
  });
  await expect(
    panel.getByRole("button", { name: "Choose existing file" }),
  ).toBeVisible();
  await expect(panel).toHaveCSS("background-color", "rgb(37, 42, 48)");
  await expect(panel).toHaveCSS("font-family", /Inter Variable/);
  await page.evaluate(() => (window as any).sendTheme("light"));
  await expect(f.locator("body")).toHaveCSS(
    "background-color",
    "rgb(247, 249, 246)",
  );
  await expect(f.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  // Browser control defaults must not replace Univer's inherited UI typography.
  const insertTab = f.getByRole("tab", { name: "Insert", exact: true });
  await expect(insertTab).toHaveCSS(
    "font-family",
    /Arial|Helvetica|sans-serif/,
  );
  await expect(insertTab).toHaveCSS("font-size", "14px");
  await select(page, "B3");
  await f.getByRole("button", { name: "App placement", exact: true }).click();
  await expect(
    f.getByRole("menuitemradio", { name: "Expand app", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await f
    .getByRole("menuitemradio", { name: "Move app to right", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).viewRequests.filter(
            (x: any) => x.type === "pioneer.view.setPlacement",
          ).length,
      ),
    )
    .toBe(1);
  await expect(f.locator("canvas").first()).toBeVisible();
  await f.getByLabel("Close app").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).viewRequests.some(
          (x: any) => x.type === "pioneer.view.close",
        ),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("library scroll belongs to its viewport while the document stays within the app frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 500 });
  for (let index = 0; index < 16; index++) {
    await h.api("documents", {
      title: "Scroll owner " + index,
    });
  }
  const frame = await open(page);
  const viewport = frame.locator('[data-slot="scroll-area-viewport"]').filter({
    has: frame.getByRole("textbox", { name: "Search documents" }),
  });
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await viewport.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.mouse.wheel(0, 10000);
  await expect
    .poll(() =>
      viewport.evaluate((element) =>
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      ),
    )
    .toBeLessThan(2);
  await page.mouse.wheel(0, 600);
  const documentBounds = await frame.locator("body").evaluate((body) => ({
    fillsViewport: body.clientHeight === window.innerHeight,
    heightBounded: body.scrollHeight <= body.clientHeight,
    widthBounded: body.scrollWidth <= body.clientWidth,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
  expect(documentBounds).toEqual({
    fillsViewport: true,
    heightBounded: true,
    widthBounded: true,
    scrollX: 0,
    scrollY: 0,
  });
});

test("two Pioneer users and MCP agent edit, display presence, persist history", async ({
  browser,
}) => {
  const d = await h.api("documents", {
    title: "Installed collaboration",
  });
  const a = await browser.newPage(),
    b = await browser.newPage(),
    c = await mcp("C".repeat(21));
  try {
    const fa = await open(a, d.id);
    await open(b, d.id, "bob");
    const cellValue = async (row: number, column: number) => {
      const current = await h.api("documents/" + d.id);
      const sheet = current.snapshot.sheets[current.snapshot.sheetOrder[0]];
      return sheet.cellData[row]?.[column]?.v;
    };
    await enter(a, "B2", "123");
    await expect.poll(() => cellValue(1, 1)).toBe(123);
    await enter(b, "B3", "456");
    await expect.poll(() => cellValue(2, 1)).toBe(456);
    await tool(c, "document_edit", {
      documentId: d.id,
      operations: [{ op: "set_cells", range: "B4", values: [[789]] }],
    });
    await tool(c, "presence_set", {
      documentId: d.id,
      connectionId: "selection",
      selection: { sheetId: d.snapshot?.sheetOrder?.[0], range: "B4" },
    });
    await expect(
      fa.getByLabel("Fixture agent · Agent", { exact: true }),
    ).toBeVisible();
    await expect(
      fa.locator(".peer-cursor").filter({ hasText: "Fixture agent" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const v = await h.api("documents/" + d.id);
        const s = v.snapshot.sheets[v.snapshot.sheetOrder[0]];
        return [
          s.cellData[1]?.[1]?.v,
          s.cellData[2]?.[1]?.v,
          s.cellData[3]?.[1]?.v,
        ];
      })
      .toEqual([123, 456, 789]);
    await a.reload();
    await expect(a.frameLocator("iframe").locator(".subtitle")).toContainText(
      "Saved",
    );
    const history = await h.api("documents/" + d.id + "/history");
    expect(history.some((r: any) => r.actor.id === "C".repeat(21))).toBe(
      true,
    );
  } finally {
    await c.close();
    await a.close();
    await b.close();
  }
});

test("Facade staging, API reference, screenshot, commit and service restart retain the platform actor", async ({
  page,
}) => {
  const d = await h.api("documents", {
      title: "Agent runtime persistence",
    }),
    c = await mcp("facade-agent");
  try {
    await open(page, d.id);
    const runtime = await tool(c, "agent_runtime_open", { documentId: d.id });
    const api = await tool(c, "agent_api_find", { terms: ["setValue"] });
    expect(JSON.stringify(api)).toContain("setValue");
    const executed = await tool(c, "agent_execute", {
      runtimeId: runtime.runtimeId,
      mode: "write",
      code: 'const sheet = univerAPI.getActiveWorkbook().getActiveSheet(); sheet.getRange("C7").setValue("Installed agent");',
    });
    expect(executed).toBeTruthy();
    const shot = await c.callTool({
      name: "agent_screenshot",
      arguments: { runtimeId: runtime.runtimeId, range: "A1:D8" },
    });
    expect(shot.isError).not.toBe(true);
    expect((shot.content as any[]).some((x) => x.type === "image")).toBe(true);
    let committed = await tool(c, "agent_runtime_commit", {
      runtimeId: runtime.runtimeId,
    });
    if (committed.status === "pull-required") {
      await tool(c, "agent_runtime_pull", { runtimeId: runtime.runtimeId });
      committed = await tool(c, "agent_runtime_commit", {
        runtimeId: runtime.runtimeId,
      });
    }
    expect(committed.status).toBe("confirmed");
    await h.restart();
    const restored = await h.api("documents/" + d.id);
    expect(
      restored.snapshot.sheets[restored.snapshot.sheetOrder[0]].cellData[6][2]
        .v,
    ).toBe("Installed agent");
    await page.reload();
    await expect(
      page.frameLocator("iframe").locator(".subtitle"),
    ).toContainText("Saved");
  } finally {
    await c.close();
  }
});

test("uploads larger than the proxy request limit work without Authorization or Upload-Offset headers", async ({
  page,
}) => {
  const f = await open(page);
  await f.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    f.getByRole("textbox", { name: "Search files", exact: true }),
  ).toBeVisible();
  await expect(f.getByRole("dialog")).toHaveCount(0);
  const bytes = Buffer.alloc(9 * 1024 * 1024, 65);
  await f.locator(".file-panel input[type=file]").first().setInputFiles({
    name: "large.txt",
    mimeType: "text/plain",
    buffer: bytes,
  });
  await expect(f.getByText("large.txt", { exact: true }).first()).toBeVisible();
  const files = await h.api("files?q=large.txt");
  expect(
    files.items.some(
      (x: any) => x.name === "large.txt" && x.size === bytes.length,
    ),
  ).toBe(true);
  await f
    .getByRole("textbox", { name: "Search files", exact: true })
    .fill("large.txt");
  await expect(f.getByText("large.txt", { exact: true }).first()).toBeVisible();
  await expect(
    f.getByRole("navigation", { name: "File and job pages" }),
  ).toHaveCount(0);
  await f
    .getByRole("textbox", { name: "Search files", exact: true })
    .fill("no-file-matches-this-query");
  await expect(f.getByText("No files yet", { exact: true })).toBeVisible();
  await expect(
    f.getByRole("navigation", { name: "File and job pages" }),
  ).toHaveCount(0);
  await f.getByRole("button", { name: "Conversions", exact: true }).click();
  await expect(
    f.getByText("No jobs yet", { exact: true }),
  ).toBeVisible();
  await expect(
    f.getByRole("textbox", { name: "Search files", exact: true }),
  ).toHaveCount(0);
  await expect(f.getByRole("dialog")).toHaveCount(0);
});

test("native download bridge exports XLSX with the latest edit", async ({
  page,
}) => {
  const d = await h.api("documents", {
    title: "Office export",
  });
  await open(page, d.id);
  await enter(page, "B2", "987");
  // Export must flush the just-committed cell, including a pending save batch.
  const out = await download(page, "xlsx");
  expect(out.suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(
    (await import("node:fs/promises")).stat((await out.path()) as string),
  ).resolves.toMatchObject({ size: expect.any(Number) });
  const bytes = await (
    await import("node:fs/promises")
  ).readFile((await out.path()) as string);
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.default.Workbook();
  await book.xlsx.load(bytes as any);
  expect(book.worksheets[0].getCell("B2").value).toBe(987);
});

test("library rename, duplicate, trash and restore use HTML dialogs allowed by the App sandbox", async ({
  page,
}) => {
  const f = await open(page);
  await f.getByRole("button", { name: "Create document", exact: true }).click();
  await expect(f.locator(".subtitle")).toContainText("Saved");
  await f.getByRole("button", { name: "All documents", exact: true }).click();
  const title = "Renamed in Pioneer " + Date.now();
  const card = f
    .locator(".document-card")
    .filter({
      has: f.getByRole("heading", { name: "New spreadsheet", exact: true }),
    })
    .first();
  await card.getByRole("button", { name: "Rename", exact: true }).click();
  await f
    .getByRole("dialog")
    .getByRole("textbox", { name: "Document name" })
    .fill(title);
  await f
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const renamed = f
    .locator(".document-card")
    .filter({ has: f.getByRole("heading", { name: title, exact: true }) });
  await renamed.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    f.getByRole("heading", { name: title + " — copy", exact: true }),
  ).toBeVisible();
  await renamed
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await f
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await page.setViewportSize({ width: 640, height: 800 });
  await f.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  const navigation = f.getByRole("dialog", { name: "Sidebar", exact: true });
  await navigation.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(navigation).not.toBeVisible();
  const trashed = f
    .locator(".document-card")
    .filter({ has: f.getByRole("heading", { name: title, exact: true }) });
  await trashed.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    f.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(0);
});

test("MCP upload chunks, Office import and file reads require no application sessions", async () => {
  const c = await mcp("exchange-agent");
  try {
    const empty = await tool(c, "files_put", {
      name: "empty.txt",
      mime: "text/plain",
      base64: "",
    });
    expect((await tool(c, "files_read", { fileId: empty.id })).base64).toBe("");
    const bytes = Buffer.from("Name,Value\r\nPioneer,42\r\n");
    const upload = await tool(c, "files_upload_start", {
      name: "agent.csv",
      size: bytes.length,
      mime: "text/csv",
      requestId: "agent-upload",
    });
    const first = await tool(c, "files_upload_append", {
      uploadId: upload.uploadId,
      offset: 0,
      base64: bytes.subarray(0, 10).toString("base64"),
    });
    expect(first.received).toBe(10);
    await tool(c, "files_upload_append", {
      uploadId: upload.uploadId,
      offset: 10,
      base64: bytes.subarray(10).toString("base64"),
    });
    const file = await tool(c, "files_upload_finish", {
      uploadId: upload.uploadId,
    });
    const link = await tool(c, "files_download", { fileId: file.id });
    expect(link.url).toBe(
      `api/files/${file.id}/content?version=${file.version}`,
    );
    expect((await fetch(h.view() + link.url)).status).toBe(403);
    expect((await fetch(h.view() + link.url + "&ticket=ignored")).status).toBe(
      403,
    );
    expect((await fetch(h.backend + "/" + link.url)).status).toBe(401);
    const read = await tool(c, "files_read", {
      fileId: file.id,
      length: bytes.length,
    });
    expect(Buffer.from(read.base64, "base64")).toEqual(bytes);
    const job = await tool(c, "exchange_create", {
      operation: "import",
      format: "csv",
      fileId: file.id,
    });
    let result: any;
    await expect
      .poll(async () => {
        result = await tool(c, "exchange_get", { jobId: job.id });
        return result.status;
      })
      .toBe("succeeded");
    const doc = await h.api("documents/" + result.result.documentId);
    const sheet = doc.snapshot.sheets[doc.snapshot.sheetOrder[0]];
    expect(sheet.cellData[1][0].v).toBe("Pioneer");
    expect(sheet.cellData[1][1].v).toBe("42");
  } finally {
    await c.close();
  }
});

test("agent draft is reviewed by the Pioneer owner and merged with concurrent main-document edits", async ({
  page,
}) => {
  const d = await h.api("documents", {
      title: "Draft review",
    }),
    c = await mcp("draft-agent");
  try {
    const draft = await tool(c, "document_draft", {
      documentId: d.id,
      action: "create",
    });
    await tool(c, "document_edit", {
      documentId: draft.id,
      operations: [
        { op: "set_cells", range: "A5", values: [["Reviewed agent"]] },
      ],
    });
    await tool(c, "document_draft", { documentId: draft.id, action: "ready" });
    await h.api("documents/" + d.id + "/edit", {
      operations: [
        { op: "set_cells", range: "B5", values: [["Main preserved"]] },
      ],
    });
    const f = await open(page, draft.id);
    await f.getByRole("button", { name: "Drafts", exact: true }).click();
    await f
      .getByRole("button", { name: "Merge into main document", exact: true })
      .click();
    await expect
      .poll(async () => {
        const v = await h.api("documents/" + d.id);
        const s = v.snapshot.sheets[v.snapshot.sheetOrder[0]];
        return [s.cellData[4]?.[0]?.v, s.cellData[4]?.[1]?.v];
      })
      .toEqual(["Reviewed agent", "Main preserved"]);
  } finally {
    await c.close();
  }
});

test("Pioneer viewer receives live edits while browser and MCP cannot bypass document permissions", async ({
  page,
}) => {
  const d = await h.api("documents", {
    title: "Viewer policy",
  });
  await h.api("documents/" + d.id + "/members", {
    identityId: h.principals.bob,
    role: "viewer",
  });
  const f = await open(page, d.id, "bob");
  await expect(f.locator(".readonly-cover")).toBeVisible();
  const denied = await fetch(
    h.view("bob") + "api/documents/" + d.id + "/edit",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operations: [{ op: "set_cells", range: "A8", values: [["forbidden"]] }],
      }),
    },
  );
  expect(denied.status).toBe(403);
  await h.api("documents/" + d.id + "/edit", {
    operations: [
      { op: "set_cells", range: "A8", values: [["Live viewer update"]] },
    ],
  });
  await expect(f.locator(".subtitle")).toContainText("Saved");
  const exported = await download(page, "json");
  const bytes = await (
    await import("node:fs/promises")
  ).readFile((await exported.path()) as string, "utf8");
  expect(bytes).toContain("Live viewer update");
  expect(bytes).not.toContain("forbidden");
});

test("large collaboration state crosses the 1 MiB Gateway boundary in both directions", async () => {
  const { WebSocket } = await import("ws");
  const { snapshot, writeSnapshot, encode, base64, unbase64, fromUpdate } =
    await import("../../src/shared/documents/model");
  const d = await h.api("documents", {
    title: "Framed collaboration",
  });
  const model = fromUpdate(unbase64(d.update)),
    before = snapshot(model),
    after = structuredClone(before),
    sheet = after.sheets[after.sheetOrder[0]];
  const text = "uncompressed-state-".repeat(90000);
  sheet.cellData = { 0: { 0: { v: text } } };
  writeSnapshot(model, before, after);
  // Independent wire reader exercises the transport, rather than calling the
  // application's framer to generate both expected and actual values.
  const received: any[] = [];
  let fragments: string[] = [],
    total = 0,
    largest = 0;
  const socket = new WebSocket(
    h.view().replace("http:", "ws:") + "collaboration?document=" + d.id,
    { maxPayload: 1024 * 1024 },
  );
  socket.on("message", (data: any) => {
    largest = Math.max(largest, data.length);
    const item = JSON.parse(data.toString());
    if (item.type === "frame") {
      if (item.index === 0) {
        fragments = [];
        total = item.total;
      }
      fragments.push(item.data);
      if (fragments.length === total)
        received.push(JSON.parse(fragments.join("")));
    } else received.push(item);
  });
  try {
    await expect.poll(() => received.some((x) => x.type === "sync")).toBe(true);
    const payload = JSON.stringify({
        type: "update",
        requestId: "large-write",
        update: base64(encode(model)),
      }),
      size = 64 * 1024,
      total = Math.ceil(payload.length / size);
    for (let index = 0; index < total; index++)
      socket.send(
        JSON.stringify({
          type: "frame",
          id: "large-client-write",
          index,
          total,
          data: payload.slice(index * size, (index + 1) * size),
        }),
      );
    await expect
      .poll(() =>
        received.some((x) => x.type === "ack" && x.requestId === "large-write"),
      )
      .toBe(true);
    const update = received.find((x) => x.type === "update");
    expect(update).toBeTruthy();
    const decoded = fromUpdate(unbase64(update.update));
    expect(snapshot(decoded).sheets[after.sheetOrder[0]].cellData[0][0].v).toBe(
      text,
    );
    decoded.destroy();
    expect(largest).toBeLessThan(1024 * 1024);
    const restored = await h.api("documents/" + d.id);
    expect(restored.snapshot.sheets[after.sheetOrder[0]].cellData[0][0].v).toBe(
      text,
    );
  } finally {
    socket.close();
    model.destroy();
  }
});

test("native image upload paints in two opaque views and survives reopening", async ({
  browser,
}) => {
  const d = await h.api("documents", {
      title: "Installed image IO",
    }),
    a = await browser.newPage(),
    b = await browser.newPage();
  async function painted(page: Page) {
    const { execFileSync } = await import("node:child_process");
    return Number(
      execFileSync(
        process.env.OFFICE_PYTHON || ".agent/office-python/bin/python",
        ["tests/installed/pixels.py"],
        { input: await page.screenshot(), encoding: "utf8", timeout: 10000 },
      ),
    );
  }
  try {
    const fa = await open(a, d.id);
    await open(b, d.id, "bob");
    await fa.getByRole("tab", { name: "Insert", exact: true }).click();
    const chooser = a.waitForEvent("filechooser");
    await fa.getByRole("button", { name: "Image", exact: true }).click();
    await fa
      .getByRole("menuitem", { name: "Float Image", exact: true })
      .click();
    await (await chooser).setFiles("tests/fixtures/office/pixel.png");
    await expect
      .poll(async () =>
        JSON.stringify((await h.api("documents/" + d.id)).snapshot),
      )
      .toContain("pioneer-file:");
    await expect.poll(() => painted(a)).toBeGreaterThan(50);
    await expect.poll(() => painted(b)).toBeGreaterThan(50);
    await a.reload();
    await expect(a.frameLocator("iframe").locator(".subtitle")).toContainText(
      "Saved",
    );
    await expect.poll(() => painted(a)).toBeGreaterThan(50);
  } finally {
    await a.close();
    await b.close();
  }
});

test("own undo/redo preserves an MCP edit and disconnected views pause editing", async ({
  page,
}) => {
  const d = await h.api("documents", {
      title: "Undo and reconnection",
    }),
    c = await mcp("undo-agent");
  try {
    const f = await open(page, d.id);
    await enter(page, "A2", "Undo marker");
    await expect
      .poll(async () =>
        JSON.stringify((await h.api("documents/" + d.id)).snapshot),
      )
      .toContain("Undo marker");
    await tool(c, "document_edit", {
      documentId: d.id,
      operations: [
        { op: "set_cells", range: "B2", values: [["Other participant"]] },
      ],
    });
    await f.getByTitle("Undo your change", { exact: true }).click();
    await expect
      .poll(async () =>
        JSON.stringify((await h.api("documents/" + d.id)).snapshot),
      )
      .not.toContain("Undo marker");
    expect(
      JSON.stringify((await h.api("documents/" + d.id)).snapshot),
    ).toContain("Other participant");
    await f.getByTitle("Redo your change", { exact: true }).click();
    await expect
      .poll(async () =>
        JSON.stringify((await h.api("documents/" + d.id)).snapshot),
      )
      .toContain("Undo marker");
    await page.context().setOffline(true);
    await expect(f.locator(".subtitle")).toContainText("Disconnected");
    await expect(f.locator(".readonly-cover")).toBeVisible();
    await page.context().setOffline(false);
    await expect(f.locator(".subtitle")).toContainText("Saved");
  } finally {
    await c.close();
  }
});
