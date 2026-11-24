import type { Snapshot, Kind } from "./documents/model";

/** Persistent reference. Presentation belongs to the current Gateway profile. */
export interface IdentityReference {
  id: string;
  type: "human" | "agent";
}

/** Transient presentation for the current viewer and live presence. */
export interface Identity extends IdentityReference {
  name: string;
  color: string;
}

export function identityReference(who: IdentityReference): IdentityReference {
  return { id: who.id, type: who.type };
}

export interface Presence extends Identity {
  connectionId: string;
  selection?: {
    sheetId?: string;
    range?: string;
    start?: number;
    end?: number;
  };
  updatedAt: number;
}

export interface DocumentRevision {
  revision: number;
  actor: IdentityReference;
  message: string;
  createdAt: number;
}

export interface DocumentInfo {
  id: string;
  title: string;
  kind: Kind;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  ownerId: string;
  canPurge?: boolean;
  starred: boolean;
  draft?: {
    id: string;
    sourceId: string;
    baseRevision: number;
    status: string;
    mergedRevision: number | null;
  } | null;
}

export interface DocumentRecord extends DocumentInfo {
  snapshot: Snapshot;
  update: string;
  role: "owner" | "editor" | "viewer";
}

export const palette = [
  "#387755",
  "#6264bb",
  "#b55b33",
  "#b44879",
  "#2b7f91",
  "#8a752b",
];

export function identity(
  name: string,
  id: string,
  type: "human" | "agent" = "human",
): Identity {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return {
    id,
    name: name.trim().slice(0, 60) || "Participant",
    color: palette[hash % palette.length],
    type,
  };
}
