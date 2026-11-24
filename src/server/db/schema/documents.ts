import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";

export const units = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    ownerId: text("owner_id").notNull(),
    revision: integer("revision").notNull(),
    sequence: integer("sequence").notNull(),
    checkpointSequence: integer("checkpoint_sequence").notNull(),
    checkpointSize: integer("checkpoint_size").notNull(),
    deltaBytes: integer("delta_bytes").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deletedAt: bigint("deleted_at", { mode: "number" }),
    starred: boolean("starred").notNull().default(false),
  },
  (t) => [index("documents_modified").on(t.updatedAt)],
);

export const revisions = pgTable(
  "revisions",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    sequence: integer("sequence").notNull(),
    actor: text("actor").notNull(),
    message: text("message").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.revision] })],
);

// A checkpoint replaces the delta at its sequence; older records remain
// available for revisions before that checkpoint.
export const journal = pgTable(
  "document_journal",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind", { enum: ["checkpoint", "delta"] }).notNull(),
    codec: text("codec", { enum: ["raw", "zstd"] }).notNull(),
    data: bytea("data").notNull(),
    rawSize: integer("raw_size").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.sequence] }),
    index("document_journal_checkpoints").on(t.documentId, t.kind, t.sequence),
  ],
);

export const receipts = pgTable(
  "receipts",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    revision: integer("revision").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.id] })],
);

export const members = pgTable(
  "members",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    identityId: text("identity_id").notNull(),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.identityId] })],
);

export const drafts = pgTable("drafts", {
  id: text("id")
    .primaryKey()
    .references(() => units.id, { onDelete: "cascade" }),
  sourceId: text("source_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  baseRevision: integer("base_revision").notNull(),
  status: text("status").notNull(),
  mergedRevision: integer("merged_revision"),
});
