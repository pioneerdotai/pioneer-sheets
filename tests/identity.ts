import { identity } from "../src/shared/types";
import { randomUUID } from "node:crypto";

export function actor(name: string, type: "human" | "agent" = "human") {
  return { identity: identity(name, randomUUID(), type) };
}
