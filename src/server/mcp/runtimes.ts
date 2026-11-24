import { getAgentManager } from "../agent/manager";
import { findApi, showApi } from "../agent/reference";
import { z } from "zod";
import { OfficeService } from "../documents/service";
import type { RegisterTool } from "./types";

export function registerRuntimes(tool: RegisterTool, service: OfficeService) {
  const agents = getAgentManager(service);

  const runtime = { runtimeId: z.string() };

  tool(
    "agent_runtime_open",
    "Open a persistent agent document runtime. Facade writes are staged until explicit commit. Resume with a previously closed runtime ID.",
    { documentId: z.string(), resumeRuntimeId: z.string().optional() },
    (a, who) => agents.open(a.documentId, who, a.resumeRuntimeId),
  );

  tool(
    "agent_runtime_state",
    "Inspect revision, pending writes, remote changes, target identity and worker-pool state.",
    runtime,
    (a, who) => agents.state(a.runtimeId, who),
  );

  tool(
    "agent_capabilities",
    "List the actual public Facade methods installed in this runtime, its execution limits and SDK version.",
    runtime,
    (a, who) => agents.capabilities(a.runtimeId, who),
  );

  tool(
    "agent_runtime_pull",
    "Merge the latest confirmed document changes into this runtime while preserving pending agent edits.",
    runtime,
    (a, who) => agents.pull(a.runtimeId, who),
  );

  tool(
    "agent_execute",
    "Run public Univer Facade JavaScript in isolated QuickJS. Bindings: univerAPI and workbook (Sheets) or document (Docs). read mode forbids content changes. write stages changes; call agent_runtime_commit to publish. No Node globals or module imports.",
    {
      ...runtime,
      mode: z.enum(["read", "write"]),
      code: z.string().min(1).max(200000),
      timeoutMs: z.number().int().min(50).max(30000).optional(),
      resourceIds: z.array(z.string()).max(100).optional(),
    },
    (a, who) => agents.execute(a.runtimeId, who, a),
  );

  tool(
    "agent_runtime_commit",
    "Durably publish staged changes. Inspect status: confirmed, nothing-to-commit, pull-required or unknown. If pull-required, pull/review/retry. If unknown, retry the same runtime commit to recover its durable receipt before further writes.",
    runtime,
    (a, who) => agents.commit(a.runtimeId, who),
  );

  tool(
    "agent_runtime_export",
    "Export complete current runtime UnitData including staged changes and target/revision metadata.",
    runtime,
    (a, who) => agents.export(a.runtimeId, who),
  );

  tool(
    "agent_runtime_discard",
    "Discard uncommitted agent edits and reload the latest confirmed state.",
    runtime,
    (a, who) => agents.discard(a.runtimeId, who),
  );

  tool(
    "agent_runtime_close",
    "Release execution resources. Pending state is retained in SQLite and can be resumed by its owner.",
    runtime,
    (a, who) => agents.close(a.runtimeId, who),
  );

  tool(
    "agent_inspect",
    "Structured read-only inspection of workbook, worksheet, A1 range, document, paragraph, features or literal search. Sheet selectors accept name:, id:, index: prefixes. Output is bounded and paginated.",
    {
      ...runtime,
      kind: z.enum([
        "overview",
        "workbook",
        "worksheet",
        "range",
        "document",
        "paragraph",
        "search",
        "features",
      ]),
      sheet: z.string().optional(),
      range: z.string().optional(),
      paragraphId: z.string().optional(),
      index: z.number().int().nonnegative().optional(),
      segment: z.string().optional(),
      feature: z.string().optional(),
      query: z.string().optional(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    (a, who) => agents.inspect(a.runtimeId, who, a),
  );

  tool(
    "agent_api_find",
    "Search the offline versioned public Facade API reference. Discover methods, classes, types and enums before generating code.",
    {
      terms: z.array(z.string()).min(1).max(20),
      unit: z.enum(["sheet", "doc", "all"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    (a) => findApi(a),
  );

  tool(
    "agent_api_show",
    "Read exact public API signatures, documentation, types and enum members from installed Apache-2.0 declaration files.",
    { symbols: z.array(z.string()).min(1).max(20) },
    (a) => showApi(a.symbols),
  );
}
