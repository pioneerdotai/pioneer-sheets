import {
  pgTable,
  text,
  bigint,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { units } from "./documents";

export const agentRuntimes = pgTable("agent_runtimes", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  identityId: text("identity_id").notNull(),
  data: text("data").notNull(),
});

export const agentResources = pgTable(
  "agent_resources",
  {
    id: text("id").primaryKey(),
    identityId: text("identity_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    content: bytea("content").notNull(),
    metadata: text("metadata").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [unique().on(t.identityId, t.sha256)],
);

export const agentResourceUsages = pgTable("agent_resource_usages", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id")
    .notNull()
    .references(() => agentResources.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  metadata: text("metadata").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const agentConfig = pgTable(
  "agent_config",
  {
    identityId: text("identity_id").notNull(),
    namespace: text("namespace").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identityId, t.namespace, t.kind] })],
);

export const agentCatalogs = pgTable(
  "agent_catalogs",
  {
    identityId: text("identity_id").notNull(),
    id: text("id").notNull(),
    url: text("url").notNull(),
    records: text("records").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identityId, t.id] })],
);
