import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const exchangeJobs = pgTable(
  "exchange_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    operation: text("operation").notNull(),
    format: text("format").notNull(),
    status: text("status").notNull(),
    payload: text("payload").notNull(),
    result: text("result"),
    error: text("error"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    attempt: integer("attempt").notNull(),
    requestKey: text("request_key"),
    cancelled: boolean("cancelled")
      .notNull()
      .default(false),
  },
  (t) => [uniqueIndex("exchange_request").on(t.ownerId, t.requestKey)],
);
