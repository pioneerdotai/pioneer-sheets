// Exercise the actual local entry with a fixture bootstrap.
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { theme } from "./installed/harness.mjs";
import { openRenderHost } from "./installed/render-host.mjs";

function launch(env, args = []) {
  const child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", ...args],
    {
      env: { ...process.env, PIONEER_BOOTSTRAP: "", APP_DATA: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (data) => {
    log += data;
  });
  child.stderr.on("data", (data) => {
    log += data;
  });
  const exited = once(child, "exit");
  return { child, exited, log: () => log };
}
async function openViewProxy(origin, authority) {
  const grantPath = "/storage/app-views/" + "A".repeat(43) + "/";
  const upstreamPath = (path) => "/" + path.slice(grantPath.length);
  const sockets = new WebSocketServer({ noServer: true });
  const server = createHttpServer((req, res) => {
    if (req.headers.origin !== origin || !req.url.startsWith(grantPath)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE",
        "Access-Control-Allow-Headers": "content-type",
      }).end();
      return;
    }
    const headers = { ...authority };
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    const upstream = httpRequest(origin + upstreamPath(req.url), {
      method: req.method,
      headers,
    }, (reply) => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.headers.origin !== origin || !req.url.startsWith(grantPath)) {
      socket.destroy();
      return;
    }
    const upstream = new WebSocket(origin.replace("http:", "ws:") + upstreamPath(req.url), {
      headers: authority,
    });
    upstream.once("error", () => socket.destroy());
    sockets.handleUpgrade(req, socket, head, (browser) => {
      browser.on("message", (data, binary) => {
        const send = () => upstream.send(data, { binary });
        if (upstream.readyState === WebSocket.CONNECTING) upstream.once("open", send);
        else if (upstream.readyState === WebSocket.OPEN) send();
      });
      upstream.on("message", (data, binary) => browser.send(data, { binary }));
      upstream.on("close", () => browser.close());
      browser.on("close", () => upstream.close());
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: "http://127.0.0.1:" + server.address().port + grantPath,
    close() {
      for (const socket of sockets.clients) socket.terminate();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
test(
  "dev keeps the browser on Vite and uses Gateway authority for HTTP, WS, MCP and PNG",
  { timeout: 120000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "sheets-local-dev-"));
    const env = {
      APP_DATA: join(dir, "data"),
      PIONEER_BOOTSTRAP: join(dir, "credential.json"),
    };
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const origin = "http://127.0.0.1:" + port;
    const userId = "U".repeat(21);
    const agentId = "AGENT-dev-test";
    const executionCredential = "a".repeat(64);
    const hostCredential = "b".repeat(64);
    const authority = {
      "pioneer-app-execution-credential": executionCredential,
      "pioneer-app-user-id": userId,
    };
    let run, client, socket, browser, proxy, render;
    async function start() {
      // HOST/NITRO_HOST from an outer shell must not expose the developer backend.
      run = launch({
        ...env,
        PORT: String(port),
        HOST: "0.0.0.0",
        NITRO_HOST: "0.0.0.0",
      });
      for (let i = 0; i < 600; i++) {
        assert.equal(run.child.exitCode, null, run.log());
        try {
          if (
            (
              await fetch(origin + "/api/health", {
                signal: AbortSignal.timeout(5000),
                headers: authority,
              })
            ).ok
          )
            return;
        } catch {}
        await delay(100);
      }
      throw Error("Dev readiness timeout: " + run.log());
    }
    async function stop() {
      if (run?.child.exitCode === null) {
        run.child.kill("SIGTERM");
        await Promise.race([
          run.exited,
          delay(20000, undefined, { ref: false }).then(() => {
            throw Error("Dev failed graceful shutdown");
          }),
        ]);
      }
    }
    async function connect() {
      client = new Client({ name: "dev-contract-test", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), {
          requestInit: {
            headers: { ...authority, "pioneer-app-agent-id": agentId },
          },
        }),
      );
    }
    async function tool(name, args = {}) {
      const response = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 10000 },
      );
      assert.ok(!response.isError, JSON.stringify(response));
      return response.structuredContent.result;
    }
    try {
      render = await openRenderHost(origin, executionCredential, hostCredential);
      proxy = await openViewProxy(origin, authority);
      await writeFile(env.PIONEER_BOOTSTRAP, JSON.stringify({
        execution_id: "a".repeat(21),
        ui_proxy: { credential: executionCredential },
        host_api: {
          endpoint: render.endpoint,
          credential: hostCredential,
          capabilities: ["host.render"],
        },
      }));
      await start();
      const pageResponse = await fetch(origin + "/");
      if (!pageResponse.ok)
        assert.fail(`Vite returned ${pageResponse.status}: ${(await pageResponse.text()).slice(0, 1500)}
${run.log()}`);
      assert.equal((await fetch(origin + "/api/health")).status, 401);
      const spoofed = await fetch(origin + "/api/context", {
        headers: { "Pioneer-App-User-Id": "A".repeat(21) },
      });
      assert.equal(spoofed.status, 401);
      const context = await (
        await fetch(origin + "/api/context", { headers: authority })
      ).json();
      assert.equal(context.identity.id, userId);
      const created = await fetch(origin + "/api/documents", {
        method: "POST",
        headers: { ...authority, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Dev human persistence",
        }),
      });
      assert.ok(created.ok);
      const humanDoc = await created.json();
      socket = new WebSocket(
        origin.replace("http:", "ws:") +
          "/collaboration?document=" +
          humanDoc.id,
        { headers: authority },
      );
      const frame = await once(socket, "message", {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(JSON.parse(frame[0].toString()).type, "sync");
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript((base) => {
        Object.defineProperty(window, "__pioneerAppBaseUrl", { value: base });
      }, proxy.base);
      const response = page.waitForResponse(proxy.base + "api/context");
      const url = origin + "/?document=" + humanDoc.id;
      await page.goto(url);
      assert.equal((await (await response).json()).identity.id, userId);
      assert.equal(page.url(), url);
      await page.evaluate((snapshot) => {
        window.postMessage({ type: "pioneer.theme", theme: snapshot }, location.origin);
      }, theme());
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator(".subtitle")).toContainText("Saved");
      const edit = await page.evaluate(async ({ base, id }) => {
        const response = await fetch(base + `api/documents/${id}/edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operations: [
              {
                op: "set_cells",
                range: "A1",
                values: [["Dev view writes"]],
              },
            ],
          }),
        });
        return { status: response.status, body: await response.json() };
      }, { base: proxy.base, id: humanDoc.id });
      assert.equal(edit.status, 200, JSON.stringify(edit));
      assert.deepEqual(pageErrors, []);
      await browser.close();
      browser = undefined;
      await connect();
      const agentDoc = await tool("document_create", {
        title: "Dev agent persistence",
      });
      const runtime = await tool("agent_runtime_open", { documentId: agentDoc.id });
      const result = await client.callTool({
        name: "agent_screenshot",
        arguments: { runtimeId: runtime.runtimeId, range: "A1:B2" },
      }, undefined, { timeout: 30000 });
      assert.ok(!result.isError, JSON.stringify(result));
      const png = result.content.find((item) => item.type === "image");
      assert.equal(png?.mimeType, "image/png");
      assert.equal(Buffer.from(png.data, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      await client.close();
      client = undefined;
      socket.close();
      await once(socket, "close", { signal: AbortSignal.timeout(5000) });
      socket = undefined;
      await stop();
      await start();
      const humanDocs = await (await fetch(origin + "/api/documents", { headers: authority })).json();
      assert.ok(humanDocs.some((doc) => doc.id === humanDoc.id));
      await connect();
      const agentDocs = await tool("documents_list");
      assert.ok(agentDocs.some((doc) => doc.id === agentDoc.id));
      assert.ok((await stat(join(env.APP_DATA, "sheets.pgdata"))).isDirectory());
    } finally {
      await browser?.close();
      socket?.terminate();
      await client?.close();
      await stop();
      await proxy?.close();
      await render?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
