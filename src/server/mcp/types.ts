import type { Identity } from "../../shared/types";

export type RegisterTool = (
  name: string,
  description: string,
  schema: Record<string, any>,
  fn: (args: any, who: Identity) => Promise<any>,
) => unknown;
