import { readCurrent } from "./current";
import { insertDocument } from "./persistence";
import { DocumentJournal } from "./journal";
import { updateDocument, mutateDocument, type UpdateRequest } from "./updates";
import type { PersistHook } from "./persistence";
import * as history from "./history";
import * as draftsOperations from "./drafts";
import * as permissions from "./permissions";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  Storage,
  type DatabaseReader,
  type DatabaseTransaction,
} from "../db/database";
import { units, drafts } from "../db/schema/documents";
import {
  createModel,
  snapshot,
  validateSnapshot,
  equal,
  type Kind,
  type Snapshot,
} from "../../shared/documents/model";
import {
  type IdentityReference,
  type Identity,
  identityReference,
  type Presence,
  type DocumentRecord,
} from "../../shared/types";
import { ServiceError } from "./error";

export class OfficeService {
  readonly journal: DocumentJournal;
  private persistenceHooks = new Set<PersistHook>();
  onPersist(hook: PersistHook) {
    this.persistenceHooks.add(hook);
    return () => this.persistenceHooks.delete(hook);
  }
  private async persisted(
    tx: DatabaseTransaction,
    data: Snapshot,
    who: IdentityReference,
    id: string,
    revision: number,
  ) {
    for (const hook of this.persistenceHooks)
      await hook(tx, data, who, id, revision);
  }
  private locks = new Map<string, Promise<unknown>>();
  private listeners = new Map<string, Set<(event: any) => void>>();
  private presenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private peers = new Map<string, Map<string, Presence>>();
  constructor(
    public storage: Storage,
    public kind: Kind,
    private blank: () => Snapshot,
  ) {
    this.journal = new DocumentJournal(storage);
  }
  async init() {
    await this.storage.init();
  }
  async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const old = this.locks.get(id) ?? Promise.resolve();
    const p = old.catch(() => {}).then(fn);
    this.locks.set(id, p);
    try {
      return await p;
    } finally {
      if (this.locks.get(id) === p) this.locks.delete(id);
    }
  }
  subscribe(id: string, fn: (e: any) => void) {
    let s = this.listeners.get(id);
    if (!s) this.listeners.set(id, (s = new Set()));
    s.add(fn);
    return () => {
      s!.delete(fn);
      if (!s!.size) this.listeners.delete(id);
    };
  }
  broadcast(id: string, event: any) {
    for (const fn of this.listeners.get(id) ?? [])
      try {
        fn(event);
      } catch {}
  }
  role(id: string, who: IdentityReference, reader?: DatabaseReader) {
    return permissions.role(this, id, who, reader);
  }
  require(
    id: string,
    who: IdentityReference,
    write = false,
    owner = false,
    reader?: DatabaseReader,
  ) {
    return permissions.require(this, id, who, write, owner, reader);
  }
  info(row: any) {
    const {
      sequence,
      checkpointSequence,
      checkpointSize,
      deltaBytes,
      ...rest
    } = row;
    return rest;
  }
  async list(who: IdentityReference, trash = false) {
    const branches = new Map(
      (await this.storage.db.select().from(drafts)).map((b) => [b.id, b]),
    );
    return (await this.storage.list(trash)).map(({ creator, ...row }) => ({
      ...this.info(row),
      canPurge:
        trash &&
        (row.ownerId === who.id ||
          permissions.mayDeleteAgentSheet(row, creator, who)),
      draft: branches.get(row.id) ?? null,
    }));
  }
  async describe(id: string, who: IdentityReference, includeTrash = false) {
    let role = await this.require(id, who);
    const [branches, row] = await Promise.all([
      this.storage.db.select().from(drafts).where(eq(drafts.id, id)),
      this.storage.info(id),
    ]);
    if (!row || (row.deletedAt && !includeTrash))
      throw new ServiceError(410, "Document is in trash");
    const draft = branches[0] ?? null;
    if (draft && draft.status !== "draft") role = "viewer";
    return { ...row, role, draft };
  }
  async get(
    id: string,
    who: IdentityReference,
    includeTrash = false,
  ): Promise<DocumentRecord> {
    return this.locked(
      id,
      async () =>
        readCurrent(this, id, who, includeTrash) as Promise<DocumentRecord>,
    );
  }
  sync(id: string, who: IdentityReference) {
    return this.locked(id, () => readCurrent(this, id, who, false, false));
  }
  async version(
    id: string,
    revision: number,
    who: IdentityReference,
  ): Promise<Snapshot> {
    await this.require(id, who);
    const row = await this.storage.version(id, revision);
    if (!row) throw new ServiceError(404, "Revision not found");
    const doc = await this.journal.read(id, row.sequence);
    try {
      return snapshot(doc);
    } finally {
      doc.destroy();
    }
  }

  async create(
    who: IdentityReference,
    title?: string,
    imported?: Snapshot,
    creationKey?: string,
  ) {
    const hash = creationKey
      ? createHash("sha256")
          .update(who.id + ":" + creationKey)
          .digest("hex")
      : undefined;
    const id = hash
      ? [
          hash.slice(0, 8),
          hash.slice(8, 12),
          "5" + hash.slice(13, 16),
          "a" + hash.slice(17, 20),
          hash.slice(20, 32),
        ].join("-")
      : randomUUID();
    if (creationKey && (await this.storage.get(id))) return this.get(id, who);
    const data = structuredClone(imported ?? this.blank());
    const oldId = data.id;
    if (oldId && oldId !== id && Array.isArray(data.resources))
      for (const r of data.resources)
        if (typeof r.data === "string")
          r.data = r.data.split(JSON.stringify(oldId)).join(JSON.stringify(id));
    data.id = id;
    if (this.kind === "sheet")
      data.name = title?.trim() || data.name || "New spreadsheet";
    else data.title = title?.trim() || data.title || "New document";
    validateSnapshot(data, this.kind);
    const doc = createModel(data);
    try {
      await insertDocument(
        this,
        doc,
        data,
        who,
        "Create document",
        this.persisted.bind(this),
      );
    } finally {
      doc.destroy();
    }
    return this.get(id, who);
  }
  update(id: string, who: IdentityReference, input: UpdateRequest) {
    return updateDocument(this, id, who, input, this.persisted.bind(this));
  }
  mutate(
    id: string,
    who: IdentityReference,
    fn: (data: Snapshot) => void | Promise<void>,
    message: string,
    requestId: string = randomUUID(),
    expectedRevision?: number,
  ) {
    return mutateDocument(
      this,
      id,
      who,
      fn,
      { message, requestId, expectedRevision },
      this.persisted.bind(this),
    );
  }

  async meta(id: string, who: IdentityReference, action: string, value?: any) {
    if (action === "rename")
      return this.mutate(
        id,
        who,
        (s) => {
          s[this.kind === "sheet" ? "name" : "title"] =
            String(value).trim().slice(0, 200) || "Untitled";
        },
        "Rename",
      );
    if (action === "duplicate") {
      await this.require(id, who, true);
      const current = await this.get(id, who);
      return this.create(who, current.title + " — copy", current.snapshot);
    }
    return this.locked(id, async () => {
      if (action === "trash" || action === "purge") {
        const row = await this.storage.info(id);
        if (!row) throw new ServiceError(404, "Document not found");
        if (row.ownerId !== who.id) {
          const creator = (await this.storage.version(id, 0))?.actor;
          if (!permissions.mayDeleteAgentSheet(row, creator, who))
            await this.require(id, who, true, action === "purge");
        }
        if (action === "purge" && !row.deletedAt)
          throw new ServiceError(400, "Move the document to trash first");
      } else {
        await this.require(id, who, true);
      }
      if (action === "purge") {
        if (
          (
            await this.storage.db
              .select()
              .from(drafts)
              .where(eq(drafts.sourceId, id))
          ).length
        )
          throw new ServiceError(409, "Delete linked drafts first");
        await this.storage.write(() =>
          this.storage.db.delete(units).where(eq(units.id, id)),
        );
        this.journal.discard(id);
        this.broadcast(id, { type: "deleted" });
        return { ok: true };
      }
      const change =
        action === "trash"
          ? { deletedAt: Date.now() }
          : action === "restore"
            ? { deletedAt: null }
            : action === "star"
              ? { starred: !!value }
              : null;
      if (!change) throw new ServiceError(400, "Unknown action");
      await this.storage.write(() =>
        this.storage.db
          .update(units)
          .set({ ...change, updatedAt: Date.now() })
          .where(eq(units.id, id)),
      );
      this.broadcast(id, { type: "meta", action, ...change });
      return { ok: true };
    });
  }
  async close() {
    await Promise.allSettled([...this.locks.values()]);
    for (const timer of this.presenceTimers.values()) clearTimeout(timer);
    this.presenceTimers.clear();
    this.peers.clear();
    this.listeners.clear();
    this.journal.close();
    await this.storage.close();
  }
  history(id: string, who: IdentityReference) {
    return history.history(this, id, who);
  }
  restoreVersion(id: string, revision: number, who: IdentityReference) {
    return history.restoreVersion(this, id, revision, who);
  }
  setMember(
    id: string,
    who: IdentityReference,
    identityId: string,
    role: "editor" | "viewer",
  ) {
    return permissions.setMember(this, id, who, identityId, role);
  }
  draftInfo(id: string, who: IdentityReference) {
    return draftsOperations.draftInfo(this, id, who);
  }
  createDraft(id: string, who: IdentityReference) {
    return draftsOperations.createDraft(
      this,
      id,
      who,
      this.persisted.bind(this),
    );
  }
  reviewDraft(
    id: string,
    who: IdentityReference,
    action: "ready" | "reopen" | "merge",
  ) {
    return draftsOperations.reviewDraft(this, id, who, action);
  }
  presence(
    id: string,
    who: Identity,
    connectionId: string,
    selection?: Presence["selection"],
  ) {
    let room = this.peers.get(id);
    if (!room) this.peers.set(id, (room = new Map()));
    const key = id + ":" + connectionId;
    clearTimeout(this.presenceTimers.get(key));
    const timer = setTimeout(() => this.leave(id, connectionId), 60000);
    timer.unref?.();
    this.presenceTimers.set(key, timer);
    const previous = room.get(connectionId);
    room.set(connectionId, {
      ...who,
      connectionId,
      selection,
      updatedAt: Date.now(),
    });
    if (
      !previous ||
      !equal(previous.selection, selection) ||
      !equal(identityReference(previous), identityReference(who)) ||
      previous.name !== who.name ||
      previous.color !== who.color
    )
      this.broadcast(id, { type: "presence", members: this.members(id) });
  }
  leave(id: string, connectionId: string) {
    const key = id + ":" + connectionId;
    clearTimeout(this.presenceTimers.get(key));
    this.presenceTimers.delete(key);
    this.peers.get(id)?.delete(connectionId);
    if (!this.peers.get(id)?.size) this.peers.delete(id);
    this.broadcast(id, { type: "presence", members: this.members(id) });
  }
  members(id: string) {
    return [...(this.peers.get(id)?.values() ?? [])];
  }
}
