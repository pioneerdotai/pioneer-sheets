import { AgentLibraryRepository } from "./library-repository";
import { createHash, randomUUID } from "node:crypto";
import type { OfficeService } from "../documents/service";
import { ServiceError } from "../documents/error";
import type { IdentityReference } from "../../shared/types";
import { MAX_BYTES } from "./resource-fetch";
import { fetchPublicResource } from "./resource-fetch";

export class AgentLibrary {
  private repository: AgentLibraryRepository;
  constructor(public service: OfficeService) {
    this.repository = new AgentLibraryRepository(service.storage);
  }
  async put(
    who: IdentityReference,
    input: { name: string; mimeType: string; data: Uint8Array; metadata?: any },
  ) {
    if (input.data.length > MAX_BYTES)
      throw new ServiceError(413, "RESOURCE_TOO_LARGE");
    const hash = createHash("sha256").update(input.data).digest("hex"),
      id = randomUUID(),
      usageId = randomUUID(),
      now = Date.now();
    const row = await this.repository.put(
      {
        id,
        identityId: who.id,
        name: input.name.slice(0, 200),
        mimeType: input.mimeType.slice(0, 100),
        sha256: hash,
        content: Buffer.from(input.data),
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: now,
      },
      {
        id: usageId,
        name: input.name.slice(0, 200),
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: now,
      },
    );
    return {
      id: row.id,
      usageId,
      name: input.name,
      mimeType: row.mimeType,
      sha256: row.sha256,
      size: row.size,
      metadata: input.metadata ?? {},
      createdAt: now,
      cacheHit: row.id !== id,
    };
  }
  async import(
    who: IdentityReference,
    input: {
      name?: string;
      mimeType?: string;
      base64?: string;
      url?: string;
      tags?: string[];
    },
  ) {
    if (!!input.base64 === !!input.url)
      throw new ServiceError(400, "Provide exactly one of base64 or url");
    if (input.url) {
      const fetched = await fetchPublicResource(input.url);
      return this.put(who, {
        name:
          input.name ??
          new URL(input.url).pathname.split("/").pop() ??
          "resource",
        mimeType: fetched.mimeType,
        data: fetched.data,
        metadata: { url: fetched.url, tags: input.tags ?? [] },
      });
    }
    const encoded = input.base64!;
    if (encoded.length > 28_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      throw new ServiceError(400, "INVALID_BASE64");
    return this.put(who, {
      name: input.name ?? "resource",
      mimeType: input.mimeType ?? "application/octet-stream",
      data: Buffer.from(encoded, "base64"),
      metadata: { tags: input.tags ?? [] },
    });
  }
  async export(who: IdentityReference, id: string) {
    const row = await this.repository.find(who.id, id);
    if (!row) throw new ServiceError(404, "RESOURCE_NOT_FOUND");
    const usages = await this.repository.usages(id);
    return {
      id,
      name: row.name,
      mimeType: row.mimeType,
      data: Buffer.from(row.content),
      sha256: row.sha256,
      metadata: JSON.parse(row.metadata),
      usages: usages.map((u) => ({ ...u, metadata: JSON.parse(u.metadata) })),
    };
  }
  async search(who: IdentityReference, query = "", limit = 50) {
    const needle = query.toLowerCase(),
      bounded = Math.min(100, Math.max(1, limit));
    const rows = await this.repository.search(who.id, needle, bounded);
    const owned = rows.map((r) => ({
      id: r.id,
      name: r.name,
      mimeType: r.mimeType,
      size: r.size,
      sha256: r.sha256,
      metadata: JSON.parse(r.metadata),
    }));
    const catalogs = (await this.repository.catalogs(who.id))
      .flatMap((c) =>
        JSON.parse(c.records)
          .filter((r: any) =>
            (r.name + " " + (r.tags ?? []).join(" "))
              .toLowerCase()
              .includes(needle),
          )
          .slice(0, bounded)
          .map((r: any) => ({ ...r, catalogId: c.id, cachedAt: c.updatedAt })),
      )
      .slice(0, bounded);
    return { owned, catalogs };
  }
  async catalog(who: IdentityReference, id: string, url: string) {
    const result = await fetchPublicResource(url);
    const records = JSON.parse(result.data.toString("utf8"));
    if (
      !Array.isArray(records) ||
      records.length > 10000 ||
      records.some(
        (r) =>
          !r ||
          typeof r.id !== "string" ||
          typeof r.name !== "string" ||
          typeof r.url !== "string",
      )
    )
      throw new ServiceError(400, "INVALID_RESOURCE_CATALOG");
    await this.repository.saveCatalog({
      identityId: who.id,
      id,
      url,
      records: JSON.stringify(records),
      updatedAt: Date.now(),
    });
    return { id, count: records.length };
  }
  async resolve(who: IdentityReference, catalogId: string, resourceId: string) {
    const row = await this.repository.catalog(who.id, catalogId);
    const resource = row
      ? JSON.parse(row.records).find((r: any) => r.id === resourceId)
      : null;
    if (!resource) throw new ServiceError(404, "RESOURCE_NOT_FOUND");
    const downloaded = await fetchPublicResource(resource.url);
    return this.put(who, {
      name: resource.name,
      mimeType: downloaded.mimeType,
      data: downloaded.data,
      metadata: {
        catalogId,
        resourceId,
        url: downloaded.url,
        license: resource.license ?? null,
        attribution: resource.attribution ?? null,
        tags: resource.tags ?? [],
      },
    });
  }
  async remove(who: IdentityReference, id: string) {
    await this.export(who, id);
    await this.repository.remove(who.id, id);
    return { deleted: true };
  }
  private async configRow(
    who: IdentityReference,
    namespace: string,
    kind: string,
  ) {
    const row = await this.repository.config(who.id, namespace, kind);
    return row ? JSON.parse(row.value) : {};
  }
  private async saveConfig(
    who: IdentityReference,
    namespace: string,
    kind: string,
    value: any,
  ) {
    if (
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(namespace) ||
      JSON.stringify(value).length > 100000
    )
      throw new ServiceError(400, "INVALID_CONFIGURATION");
    await this.repository.saveConfig({
      identityId: who.id,
      namespace,
      kind,
      value: JSON.stringify(value),
    });
  }
  async config(
    who: IdentityReference,
    input: {
      action: "declare" | "get" | "set" | "reset";
      namespace: string;
      values?: Record<string, any>;
      schema?: Record<
        string,
        { type: string; default?: any; description?: string; secret?: boolean }
      >;
    },
  ) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(input.namespace))
      throw new ServiceError(400, "INVALID_CONFIGURATION");
    const validKey = (key: string) =>
      /^[a-zA-Z0-9_.-]{1,100}$/.test(key) &&
      !["__proto__", "prototype", "constructor"].includes(key);
    const valueType = (value: any) =>
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const schema = await this.configRow(who, input.namespace, "schema"),
      values = await this.configRow(who, input.namespace, "values");
    if (input.action === "declare") {
      if (!input.schema) throw new ServiceError(400, "CONFIG_SCHEMA_REQUIRED");
      for (const [key, field] of Object.entries(input.schema)) {
        if (
          !validKey(key) ||
          !["string", "number", "boolean", "object", "array"].includes(
            field.type,
          ) ||
          ("default" in field && valueType(field.default) !== field.type) ||
          (key in values && valueType(values[key]) !== field.type)
        )
          throw new ServiceError(400, "INVALID_CONFIG_SCHEMA: " + key);
      }
      await this.saveConfig(who, input.namespace, "schema", input.schema);
      return { declared: Object.keys(input.schema) };
    }
    if (input.action === "set") {
      for (const [key, value] of Object.entries(input.values ?? {})) {
        if (!validKey(key)) throw new ServiceError(400, "INVALID_CONFIG_KEY");
        const field = schema[key];
        if (!field) throw new ServiceError(400, "UNKNOWN_CONFIG_KEY: " + key);
        const type = valueType(value);
        if (field && type !== field.type)
          throw new ServiceError(400, "INVALID_CONFIG_TYPE: " + key);
      }
      await this.saveConfig(who, input.namespace, "values", {
        ...values,
        ...input.values,
      });
    } else if (input.action === "reset")
      await this.saveConfig(who, input.namespace, "values", {});
    const saved = await this.configRow(who, input.namespace, "values");
    return {
      namespace: input.namespace,
      schema,
      values: {
        ...Object.fromEntries(
          Object.entries(schema)
            .filter(([, field]: any) => "default" in field)
            .map(([key, field]: any) => [key, field.default]),
        ),
        ...saved,
      },
    };
  }
}

const libraries = new WeakMap<OfficeService, AgentLibrary>();

export function getAgentLibrary(service: OfficeService) {
  let library = libraries.get(service);
  if (!library) {
    library = new AgentLibrary(service);
    libraries.set(service, library);
  }
  return library;
}
