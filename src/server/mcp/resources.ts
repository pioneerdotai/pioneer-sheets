import { getAgentLibrary } from "../agent/library";
import { z } from "zod";
import { OfficeService } from "../documents/service";
import type { RegisterTool } from "./types";

export function registerResources(tool: RegisterTool, service: OfficeService) {
  const library = getAgentLibrary(service);

  tool(
    "agent_resource_import",
    "Import/cache an owned binary visual resource from base64 or a public HTTPS URL. Content is deduplicated by SHA-256 and stored in application SQLite.",
    {
      name: z.string().optional(),
      mimeType: z.string().optional(),
      base64: z.string().optional(),
      url: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    (a, who) => library.import(who, a),
  );

  tool(
    "agent_resource_search",
    "Search owned cached resources and registered catalog metadata.",
    {
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    (a, who) => library.search(who, a.query, a.limit),
  );

  tool(
    "agent_resource_catalog",
    "Register or refresh a public HTTPS JSON visual resource catalog. Records: id,name,url,tags,license,attribution.",
    { id: z.string().min(1), url: z.string().url() },
    (a, who) => library.catalog(who, a.id, a.url),
  );

  tool(
    "agent_resource_resolve",
    "Download and cache a selected registered-catalog resource, preserving attribution and license metadata.",
    { catalogId: z.string(), resourceId: z.string() },
    (a, who) => library.resolve(who, a.catalogId, a.resourceId),
  );

  tool(
    "agent_resource_export",
    "Export owned resource bytes as base64 with MIME type and content hash.",
    { resourceId: z.string() },
    async (a, who) => {
      const r = await library.export(who, a.resourceId);
      return { ...r, data: undefined, base64: r.data.toString("base64") };
    },
  );

  tool(
    "agent_resource_delete",
    "Remove an owned cached resource.",
    { resourceId: z.string() },
    (a, who) => library.remove(who, a.resourceId),
  );

  tool(
    "agent_config",
    "Declare typed application settings, read defaults/current values, persist updates or reset a namespace. Configuration is isolated by caller identity.",
    {
      action: z.enum(["declare", "get", "set", "reset"]),
      namespace: z.string().min(1).max(100),
      schema: z
        .record(
          z.string(),
          z.object({
            type: z.enum(["string", "number", "boolean", "object", "array"]),
            default: z.any().optional(),
            description: z.string().optional(),
            secret: z.boolean().optional(),
          }),
        )
        .optional(),
      values: z.record(z.string(), z.any()).optional(),
    },
    (a, who) => library.config(who, a),
  );
}
