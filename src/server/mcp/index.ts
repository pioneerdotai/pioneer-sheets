import { registerResources } from "./resources";
import { registerRuntimes } from "./runtimes";
import { registerDocuments } from "./documents";
import { registerCollaboration } from "./collaboration";
import { registerScreenshot } from "./screenshot";
import { pioneerIdentity } from "#sheets-authority";
import { registerFileTools } from "../files/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { OfficeService } from "../documents/service";
import type { RegisterTool } from "./types";

export async function handleMcp(request: Request, service: OfficeService) {
  const server = new McpServer({
    name: `pioneer-${service.kind === "sheet" ? "sheets" : "docs"}`,
    version: "1.1.0",
  });
  const tool: RegisterTool = (name, description, schema, fn) =>
    server.registerTool(
      name,
      { description, inputSchema: schema },
      async (args) => {
        try {
          const who = await pioneerIdentity(request.headers, true);
          const value = await fn(args, who);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            structuredContent: { result: value },
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: e instanceof Error ? e.message : String(e),
              },
            ],
          };
        }
      },
    );
  registerResources(tool, service);
  registerRuntimes(tool, service);
  registerDocuments(tool, service);
  registerCollaboration(tool, service);
  registerScreenshot(server, service, request);
  registerFileTools(tool, service);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
