import { units, revisions, journal } from "./schema/documents";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getTableColumns, isNull, isNotNull } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, desc, asc, gt, lte } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const {
  sequence: _sequence,
  checkpointSequence: _checkpointSequence,
  checkpointSize: _checkpointSize,
  deltaBytes: _deltaBytes,
  ...documentInfo
} = getTableColumns(units);

export class Storage {
  client;
  db;
  path: string;
  private writer: Promise<unknown> = Promise.resolve();
  async write<T>(operation: () => PromiseLike<T>): Promise<T> {
    const pending = this.writer.catch(() => {}).then(() => operation());
    this.writer = pending;
    return pending;
  }
  async transaction<T>(
    operation: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.write(() => this.db.transaction(operation));
  }
  constructor(path: string) {
    const full = resolve(path);
    this.path = full;
    mkdirSync(dirname(full), { recursive: true });
    this.client = new PGlite(full);
    this.db = drizzle(this.client);
  }
  async init() {
    await migrate(this.db, { migrationsFolder: resolve("drizzle") });
  }
  async list(trash = false) {
    return this.db
      .select({ ...documentInfo, creator: revisions.actor })
      .from(units)
      .leftJoin(
        revisions,
        and(eq(revisions.documentId, units.id), eq(revisions.revision, 0)),
      )
      .where(trash ? isNotNull(units.deletedAt) : isNull(units.deletedAt))
      .orderBy(desc(units.updatedAt));
  }
  async info(id: string, reader: DatabaseReader = this.db) {
    return (
      await reader.select(documentInfo).from(units).where(eq(units.id, id))
    )[0];
  }
  async get(id: string) {
    return (await this.db.select().from(units).where(eq(units.id, id)))[0];
  }
  async history(id: string) {
    return this.db
      .select({
        revision: revisions.revision,
        actor: revisions.actor,
        message: revisions.message,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .where(eq(revisions.documentId, id))
      .orderBy(desc(revisions.revision))
      .limit(100);
  }
  async version(id: string, revision: number) {
    return (
      await this.db
        .select()
        .from(revisions)
        .where(
          and(eq(revisions.documentId, id), eq(revisions.revision, revision)),
        )
    )[0];
  }
  async checkpoint(id: string, sequence: number) {
    return (
      await this.db
        .select()
        .from(journal)
        .where(
          and(
            eq(journal.documentId, id),
            eq(journal.kind, "checkpoint"),
            lte(journal.sequence, sequence),
          ),
        )
        .orderBy(desc(journal.sequence))
        .limit(1)
    )[0];
  }
  async deltas(id: string, after: number, through: number) {
    return this.db
      .select()
      .from(journal)
      .where(
        and(
          eq(journal.documentId, id),
          gt(journal.sequence, after),
          lte(journal.sequence, through),
        ),
      )
      .orderBy(asc(journal.sequence));
  }
  async close() {
    await this.writer.catch(() => {});
    await this.client.close();
  }
}

export type DatabaseTransaction = Parameters<
  Parameters<Storage["db"]["transaction"]>[0]
>[0];

export type DatabaseReader = Pick<DatabaseTransaction, "select">;
