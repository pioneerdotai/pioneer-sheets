import { pioneerIdentity } from "#sheets-authority";
import { getFileService } from "../files/service";
import { getAgentLibrary } from "../agent/library";
import { getRenderRuntime } from "../agent/rendering";
import { getAgentManager } from "../agent/manager";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OfficeService } from "../documents/service";

export function registerScreenshot(
  server: McpServer,
  service: OfficeService,
  request: Request,
) {
  const agents = getAgentManager(service);

  const library = getAgentLibrary(service);

  server.registerTool(
    "agent_screenshot",
    {
      description:
        "Render an exact materialized runtime state to PNG: sheet range. Includes staged edits; never modifies the live document. Returns actual MCP images and private cached resource IDs.",
      inputSchema: {
        runtimeId: z.string(),
        sheet: z.string().optional(),
        range: z.string().optional(),
        pages: z.array(z.number().int().nonnegative()).max(20).optional(),
        scale: z.number().min(0.25).max(3).optional(),
      },
    },
    async (a) => {
      try {
        const who = await pioneerIdentity(request.headers, true);
        const exported = await agents.export(a.runtimeId, who);
        const rendered = await getRenderRuntime().capture(
          await getFileService(service).materialize(exported.snapshot, who),
          service.kind,
          a,
        );
        const metadata = [];
        for (const image of rendered.images) {
          const stored = await library.put(who, {
            name: image.filename,
            mimeType: image.mimeType,
            data: image.data,
            metadata: { target: image.target, state: exported.state },
          });
          metadata.push({
            ...stored,
            width: image.width,
            height: image.height,
            target: image.target,
          });
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ state: exported.state, images: metadata }),
            },
            ...rendered.images.map((image) => ({
              type: "image" as const,
              mimeType: "image/png",
              data: image.data.toString("base64"),
            })),
          ],
          structuredContent: { state: exported.state, images: metadata },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );
}
