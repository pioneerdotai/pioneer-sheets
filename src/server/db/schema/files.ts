import {
  pgTable,
  text,
  integer,
  bigint,
  primaryKey,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { units } from "./documents";

export const fileBlobs = pgTable("file_blobs", {
  hash: text("hash").primaryKey(),
  size: integer("size").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    head: integer("head").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deletedAt: bigint("deleted_at", { mode: "number" }),
    requestKey: text("request_key"),
  },
  (t) => [uniqueIndex("files_request").on(t.ownerId, t.requestKey)],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    hash: text("hash")
      .notNull()
      .references(() => fileBlobs.hash),
    mime: text("mime").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.version] })],
);

export const fileRefs = pgTable(
  "file_refs",
  {
    fileId: text("file_id").notNull(),
    version: integer("version").notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.fileId, t.version, t.documentId, t.scope, t.scopeId],
    }),
    index("file_refs_document").on(t.documentId),
    foreignKey({
      columns: [t.fileId, t.version],
      foreignColumns: [fileVersions.fileId, fileVersions.version],
    }).onDelete("restrict"),
  ],
);

export const fileUploads = pgTable("file_uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  fileId: text("file_id"),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  received: integer("received").notNull(),
  checksum: text("checksum"),
  requestKey: text("request_key"),
  status: text("status").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  result: text("result"),
});

export const fileWrites = pgTable(
  "file_writes",
  {
    ownerId: text("owner_id").notNull(),
    requestKey: text("request_key").notNull(),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.requestKey] })],
);

export const fileLeases = pgTable(
  "file_leases",
  {
    fileId: text("file_id").notNull(),
    version: integer("version").notNull(),
    ownerId: text("owner_id").notNull(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.version, t.scope, t.scopeId] }),
    foreignKey({
      columns: [t.fileId, t.version],
      foreignColumns: [fileVersions.fileId, fileVersions.version],
    }).onDelete("restrict"),
  ],
);
