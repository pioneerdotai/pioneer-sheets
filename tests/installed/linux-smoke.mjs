// Acceptance driver for the App in a separately provisioned Linux runtime.
// This never starts/builds/changes Pioneer and is not part of the payload.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const [endpoint, bootstrapPath] = process.argv.slice(2);
if (!endpoint || !bootstrapPath)
  throw new Error(
    "Usage: node tests/installed/linux-smoke.mjs http://127.0.0.1:PORT /private/bootstrap.json",
  );
const url = new URL(endpoint);
if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
  throw new Error(
    "This fixture only targets an explicitly provisioned loopback App",
  );
const boot = JSON.parse(await readFile(bootstrapPath, "utf8"));
const headers = {
  "Pioneer-App-Execution-Credential": boot.ui_proxy.credential,
  "Pioneer-App-User-Id": "A".repeat(21),
  "Pioneer-App-Agent-Id": "linux-package-agent",
  "Pioneer-App-Agent-Name": "Linux package agent",
};
const client = new Client({ name: "packaged-app-qualification", version: "1" });
try {
  if ((await fetch(endpoint + "/api/health")).status !== 401)
    throw Error("Unauthenticated health was accepted");
  const response = await fetch(endpoint + "/api/documents", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Packaged Linux verification",
    }),
  });
  if (!response.ok) throw Error("Document create failed " + response.status);
  const doc = await response.json();
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint + "/api/mcp"), {
      requestInit: { headers },
    }),
  );
  async function tool(name, args) {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw Error(JSON.stringify(r.content));
    return r.structuredContent?.result ?? JSON.parse(r.content[0].text);
  }
  const runtime = await tool("agent_runtime_open", { documentId: doc.id });
  await tool("agent_execute", {
    runtimeId: runtime.runtimeId,
    mode: "write",
    code: 'workbook.getActiveSheet().getRange("C7").setValue(2468);',
  });
  const commit = await tool("agent_runtime_commit", {
    runtimeId: runtime.runtimeId,
  });
  if (commit.status !== "confirmed") throw Error("Commit not confirmed");
  const shot = await client.callTool({
    name: "agent_screenshot",
    arguments: { runtimeId: runtime.runtimeId, range: "A1:F9" },
  });
  if (shot.isError) throw Error(JSON.stringify(shot.content));
  const image = shot.content.find((x) => x.type === "image");
  if (!image) throw Error("No screenshot");
  const png = Buffer.from(image.data, "base64");
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw Error("Invalid PNG");
  const job = await tool("exchange_create", {
    operation: "export",
    format: "pdf",
    documentId: doc.id,
  });
  let result;
  for (let i = 0; i < 180; i++) {
    result = await tool("exchange_get", { jobId: job.id });
    if (["failed", "cancelled", "succeeded"].includes(result.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (result.status !== "succeeded")
    throw Error("PDF conversion failed " + result.error);
  const read = await tool("files_read", {
    fileId: result.result.file.id,
    length: 1048576,
  });
  if (
    !Buffer.from(read.base64, "base64")
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-"))
  )
    throw Error("Invalid PDF");
  await mkdir("artifacts/installed", { recursive: true });
  await writeFile("artifacts/installed/linux-arm64.png", png);
  await writeFile(
    "artifacts/installed/linux-arm64.pdf",
    Buffer.from(read.base64, "base64"),
  );
  const confirmedResponse = await fetch(endpoint + "/api/documents/" + doc.id, {
    headers,
  });
  const confirmed = await confirmedResponse.json();
  if (
    confirmed.snapshot.sheets[confirmed.snapshot.sheetOrder[0]].cellData[6][2]
      .v !== 2468
  )
    throw Error("Saved cell differs");
  const receipt = {
    verified: true,
    documentId: doc.id,
    pngBytes: png.length,
    pdfFileId: result.result.file.id,
  };
  await writeFile(
    "artifacts/installed/linux-arm64-smoke.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt));
} finally {
  await client.close();
}
