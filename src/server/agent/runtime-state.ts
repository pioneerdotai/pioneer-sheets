import { createHash } from "node:crypto";

export interface RecordState {
  id: string;
  documentId: string;
  identityId: string;
  baseRevision: number;
  baseState: string;
  state: string;
  generation: number;
  committedGeneration: number;
  closed: boolean;
  updatedAt: number;
  conflict?: { message: string; remoteRevision: number };
  submission?: {
    requestId: string;
    generation: number;
    status: "submitting" | "unknown" | "rejected" | "confirmed";
    revision?: number;
  };
}

export function contentKey(value: any): string {
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .filter((k) => k !== "$axisEdits")
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
