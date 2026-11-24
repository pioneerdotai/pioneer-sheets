import { and, desc, eq, exists, or, sql } from "drizzle-orm";
import type { Storage } from "../db/database";
import {
  agentResources,
  agentResourceUsages,
  agentCatalogs,
  agentConfig,
} from "../db/schema/agents";

const summary = {
  id: agentResources.id,
  name: agentResources.name,
  mimeType: agentResources.mimeType,
  sha256: agentResources.sha256,
  size: sql<number>`octet_length(${agentResources.content})`,
  metadata: agentResources.metadata,
  createdAt: agentResources.createdAt,
};

export class AgentLibraryRepository {
  constructor(private storage: Storage) {}

  async put(
    resource: typeof agentResources.$inferInsert,
    usage: Omit<typeof agentResourceUsages.$inferInsert, "resourceId">,
  ) {
    return this.storage.transaction(async (tx) => {
      await tx
        .insert(agentResources)
        .values(resource)
        .onConflictDoNothing({
          target: [agentResources.identityId, agentResources.sha256],
        });
      const [row] = await tx
        .select(summary)
        .from(agentResources)
        .where(
          and(
            eq(agentResources.identityId, resource.identityId),
            eq(agentResources.sha256, resource.sha256),
          ),
        )
        .limit(1);
      await tx
        .insert(agentResourceUsages)
        .values({ ...usage, resourceId: row.id });
      return row;
    });
  }
  async find(identityId: string, id: string) {
    return (
      await this.storage.db
        .select()
        .from(agentResources)
        .where(
          and(
            eq(agentResources.identityId, identityId),
            eq(agentResources.id, id),
          ),
        )
        .limit(1)
    )[0];
  }
  usages(id: string) {
    return this.storage.db
      .select({
        id: agentResourceUsages.id,
        name: agentResourceUsages.name,
        metadata: agentResourceUsages.metadata,
        createdAt: agentResourceUsages.createdAt,
      })
      .from(agentResourceUsages)
      .where(eq(agentResourceUsages.resourceId, id))
      .orderBy(desc(agentResourceUsages.createdAt))
      .limit(100);
  }
  search(identityId: string, needle: string, limit: number) {
    return this.storage.db
      .select(summary)
      .from(agentResources)
      .where(
        and(
          eq(agentResources.identityId, identityId),
          or(
            sql`strpos(lower(${agentResources.name}), ${needle}) > 0`,
            sql`strpos(lower(${agentResources.metadata}), ${needle}) > 0`,
            exists(
              this.storage.db
                .select({ id: agentResourceUsages.id })
                .from(agentResourceUsages)
                .where(
                  and(
                    eq(agentResourceUsages.resourceId, agentResources.id),
                    or(
                      sql`strpos(lower(${agentResourceUsages.name}), ${needle}) > 0`,
                      sql`strpos(lower(${agentResourceUsages.metadata}), ${needle}) > 0`,
                    ),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(desc(agentResources.createdAt))
      .limit(limit);
  }
  catalogs(identityId: string) {
    return this.storage.db
      .select({
        id: agentCatalogs.id,
        records: agentCatalogs.records,
        updatedAt: agentCatalogs.updatedAt,
      })
      .from(agentCatalogs)
      .where(eq(agentCatalogs.identityId, identityId));
  }
  saveCatalog(value: typeof agentCatalogs.$inferInsert) {
    return this.storage.write(() =>
      this.storage.db
        .insert(agentCatalogs)
        .values(value)
        .onConflictDoUpdate({
          target: [agentCatalogs.identityId, agentCatalogs.id],
          set: {
            url: value.url,
            records: value.records,
            updatedAt: value.updatedAt,
          },
        }),
    );
  }
  async catalog(identityId: string, id: string) {
    return (
      await this.storage.db
        .select({ records: agentCatalogs.records })
        .from(agentCatalogs)
        .where(
          and(
            eq(agentCatalogs.identityId, identityId),
            eq(agentCatalogs.id, id),
          ),
        )
        .limit(1)
    )[0];
  }
  remove(identityId: string, id: string) {
    return this.storage.write(() =>
      this.storage.db
        .delete(agentResources)
        .where(
          and(
            eq(agentResources.identityId, identityId),
            eq(agentResources.id, id),
          ),
        ),
    );
  }
  async config(identityId: string, namespace: string, kind: string) {
    return (
      await this.storage.db
        .select({ value: agentConfig.value })
        .from(agentConfig)
        .where(
          and(
            eq(agentConfig.identityId, identityId),
            eq(agentConfig.namespace, namespace),
            eq(agentConfig.kind, kind),
          ),
        )
        .limit(1)
    )[0];
  }
  saveConfig(value: typeof agentConfig.$inferInsert) {
    return this.storage.write(() =>
      this.storage.db
        .insert(agentConfig)
        .values(value)
        .onConflictDoUpdate({
          target: [
            agentConfig.identityId,
            agentConfig.namespace,
            agentConfig.kind,
          ],
          set: { value: value.value },
        }),
    );
  }
}
