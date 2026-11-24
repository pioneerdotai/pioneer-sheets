// Test-only contract fixture. Does not import, build, launch or modify Pioneer.
import { createServer, request as httpRequest } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { THEME_COLOR_KEYS } from "@pioneercompany/app-sdk/client";
import { openRenderHost } from "./render-host.mjs";
export const principals = { alice: "A".repeat(21), bob: "B".repeat(21) };
async function availablePort() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export function theme(mode = "light") {
  const colors = Object.fromEntries(
    THEME_COLOR_KEYS.map((key) => [
      key,
      mode === "dark" ? "#252a30" : "#f7f9f6",
    ]),
  );
  Object.assign(colors, {
    background: mode === "dark" ? "#181c20" : "#f7f9f6",
    foreground: mode === "dark" ? "#f0f2f5" : "#26382d",
    popover: mode === "dark" ? "#252a30" : "#ffffff",
    button_primary: "#387755",
    muted_foreground: "#86968d",
  });
  return {
    mode,
    colors,
    light_theme: { name: "Light", mode: "light", colors: {} },
    dark_theme: { name: "Dark", mode: "dark", colors: {} },
    font_family: "Arial",
    mono_font_family: "monospace",
    font_size: 14,
    mono_font_size: 13,
    radius: 6,
    radius_lg: 8,
    window_radius: 8,
    shadow: false,
    focus_ring: true,
    scrollbar_mode: "hover",
    transparent: "#00000000",
    tokens: {},
    semantic_tokens: {},
    highlight_theme: {},
    list: {},
    sheet: {},
  };
}
export async function createHarness(options = {}) {
  const cwd = options.cwd || process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "sheets-installed-"));
  const credential = randomBytes(32).toString("hex");
  const backendPort = await availablePort();
  const backend = "http://127.0.0.1:" + backendPort;
  const hostCredential = randomBytes(32).toString("hex");
  const render = await openRenderHost(backend, credential, hostCredential);
  const bootstrapPath = join(directory, "bootstrap.json");
  await writeFile(
    bootstrapPath,
    JSON.stringify({
      execution_id: "E".repeat(21),
      host_api: {
        endpoint: render.endpoint,
        credential: hostCredential,
        capabilities: ["host.render"],
      },
      ui_base_path: "/",
      ui_proxy: { credential },
    }),
    { mode: 0o600 },
  );
  let child,
    log = "",
    stopping = false;
  async function start() {
    child = spawn(
      process.execPath,
      [options.entry || ".output/server/index.mjs"],
      {
        cwd,
        env: {
          ...process.env,
          // The installed process inherits Gateway's runtime, not the test runner's
          // CI flags, which cause srvx to suppress its shutdown signal handlers.
          CI: undefined,
          TEST: undefined,
          PIONEER_BOOTSTRAP: bootstrapPath,
          APP_DATA: join(directory, "data"),
          HOST: "127.0.0.1",
          PORT: String(backendPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (d) => {
      log = (log + d).slice(-12000);
    });
    child.stderr.on("data", (d) => {
      log = (log + d).slice(-12000);
    });
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null)
        throw new Error("Installed backend exited: " + log);
      try {
        if (
          (
            await fetch(backend + "/api/health", {
              headers: { "Pioneer-App-Execution-Credential": credential },
            })
          ).ok
        )
          return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Backend readiness timeout: " + log);
  }
  async function stopBackend() {
    if (!child || child.exitCode !== null) return;
    const owned = child;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        owned.kill("SIGKILL");
        reject(new Error("Backend failed graceful shutdown: " + log));
      }, 10000);
      owned.once("exit", () => {
        clearTimeout(deadline);
        resolve();
      });
      owned.kill("SIGTERM");
    });
  }
  try {
    await start();
  } catch (error) {
    await render.close();
    throw error;
  }
  const sockets = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  function upstream(req, res, target, who, extra = {}, native = false) {
    const headers = {
      "pioneer-app-execution-credential": credential,
      "pioneer-app-user-id": who,
      "pioneer-app-base-path": "./",
      ...extra,
    };
    for (const key of [
      "content-type",
      "accept",
      "accept-language",
      "range",
      "if-range",
      "if-none-match",
      "if-modified-since",
    ])
      if (req.headers[key]) headers[key] = req.headers[key];
    const remote = httpRequest(
      backend + target,
      { method: req.method, headers },
      (r) => {
        res.statusCode = r.statusCode;
        for (const key of [
          "content-type",
          "content-length",
          "content-encoding",
          "etag",
          "last-modified",
          "content-range",
          "accept-ranges",
          "location",
          ...(native ? ["content-disposition"] : []),
        ])
          if (r.headers[key]) res.setHeader(key, r.headers[key]);
        if (!native) {
          res.setHeader("access-control-allow-origin", "null");
          res.setHeader(
            "access-control-expose-headers",
            "content-range, accept-ranges, etag, last-modified",
          );
          res.setHeader(
            "content-security-policy",
            `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://${req.headers.host} ws://${req.headers.host}; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'self'`,
          );
        }
        r.pipe(res);
      },
    );
    remote.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(remote);
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/shell") {
      const view = url.searchParams.get("view") === "bob" ? "bob" : "alice";
      const document = url.searchParams.get("document");
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html><head><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style></head><body><iframe title="Sheets" sandbox="allow-scripts allow-forms" src="/gateway/apps/views/${view}/${document ? "?document=" + encodeURIComponent(document) : ""}"></iframe><script>
      const frame=document.querySelector('iframe');window.viewRequests=[];
      function sendTheme(mode){frame.contentWindow.postMessage({type:'pioneer.theme',theme:mode==='dark'?${JSON.stringify(theme("dark"))}:${JSON.stringify(theme())}},'*')};window.sendTheme=sendTheme;frame.onload=()=>sendTheme('${url.searchParams.get("theme") === "dark" ? "dark" : "light"}');
      addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;const m=event.data;window.viewRequests.push(m);
      if(m.type==='pioneer.view.setPlacement')frame.contentWindow.postMessage({type:'pioneer.view.result',id:m.id,placement:m.placement},'*');
      if(m.type==='pioneer.view.download'){
        const a=document.createElement('a');a.href='/native-download/${view}?path='+encodeURIComponent(m.path);a.download=m.filename;a.click();
        frame.contentWindow.postMessage({type:'pioneer.view.download.result',id:m.id},'*');
      }});</script></body></html>`);
      return;
    }
    const native = /^\/native-download\/(alice|bob)$/.exec(url.pathname);
    if (native) {
      const path = url.searchParams.get("path") || "";
      if (!/^api\/files\/[\w-]+\/content(?:\?version=\d+)?$/.test(path)) {
        res.writeHead(400);
        res.end();
        return;
      }
      upstream(req, res, "/" + path, principals[native[1]], {}, true);
      return;
    }
    const tool = /^\/mcp\/([\w-]{1,128})$/.exec(url.pathname);
    if (tool) {
      upstream(req, res, "/api/mcp", principals.alice, {
        "pioneer-app-agent-id": tool[1],
        "pioneer-app-agent-name": "Fixture agent",
      });
      return;
    }
    const view = /^\/gateway\/apps\/views\/(alice|bob)\/(.*)$/.exec(
      url.pathname,
    );
    if (!view) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.headers.origin && req.headers.origin !== "null") {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "null",
        "access-control-allow-methods":
          "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers":
          "content-type, range, if-range, if-none-match, if-modified-since",
      });
      res.end();
      return;
    }
    if (req.method === "POST" && view[2] === "_pioneer/profiles/resolve") {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { include_self, identities } = JSON.parse(body);
        const profile = (type, id, display_name) => ({
          type, id, display_name, nickname: "", avatar_revision: null,
        });
        const available = [
          profile("human", principals.alice, "Alice"),
          profile("human", principals.bob, "Bob"),
          profile("agent", "C".repeat(21), "Fixture agent"),
        ];
        const profiles = available.filter((entry) =>
          identities.some(({ type, id }) => type === entry.type && id === entry.id),
        );
        res.writeHead(200, {
          "access-control-allow-origin": "null",
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          profiles,
          ...(include_self && { self: available.find((entry) => entry.id === principals[view[1]]) }),
        }));
      } catch {
        res.writeHead(400).end();
      }
      return;
    }
    upstream(req, res, "/" + view[2] + url.search, principals[view[1]]);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    const view = /^\/gateway\/apps\/views\/(alice|bob)\/(.*)$/.exec(
      new URL(req.url, "http://fixture").pathname,
    );
    if (!view || (req.headers.origin && req.headers.origin !== "null")) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, "http://fixture");
    const remote = new WebSocket(
      backend.replace("http:", "ws:") + "/" + view[2] + url.search,
      {
        headers: {
          "pioneer-app-execution-credential": credential,
          "pioneer-app-user-id": principals[view[1]],
          "pioneer-app-base-path": "./",
        },
        maxPayload: 1024 * 1024,
      },
    );
    remote.on("error", () => socket.destroy());
    remote.once("open", () =>
      wss.handleUpgrade(req, socket, head, (client) => {
        client.on(
          "message",
          (d, binary) => remote.readyState === 1 && remote.send(d, { binary }),
        );
        remote.on(
          "message",
          (d, binary) => client.readyState === 1 && client.send(d, { binary }),
        );
        client.on("close", () => remote.close());
        remote.on("close", () => client.close());
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  return {
    origin,
    directory,
    backend,
    credential,
    principals,
    view: (name = "alice") => origin + "/gateway/apps/views/" + name + "/",
    async api(path, body, user = "alice", method) {
      const r = await fetch(
        origin + "/gateway/apps/views/" + user + "/api/" + path,
        {
          method: method || (body === undefined ? "GET" : "POST"),
          headers:
            body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      const value = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(value));
      return value;
    },
    async restart() {
      await stopBackend();
      await start();
    },
    async close() {
      if (stopping) return;
      stopping = true;
      for (const socket of sockets) socket.destroy();
      wss.close();
      await new Promise((resolve) => server.close(resolve));
      await stopBackend();
      await render.close();
      await rm(directory, { recursive: true, force: true });
    },
    log: () => log,
  };
}
