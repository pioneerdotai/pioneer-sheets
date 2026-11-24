import * as uploads from "./uploads";
import * as retention from "./retention";
import * as download from "./download";
import * as catalog from "./catalog";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { OfficeService } from "../documents/service";
import type { IdentityReference } from "../../shared/types";
import type { Snapshot } from "../../shared/documents/model";
import type { DatabaseReader, DatabaseTransaction } from "../db/database";

export class FileService {
  private maintenance?: ReturnType<typeof setInterval>;
  startMaintenance() {
    if (this.maintenance) return;
    allFiles.add(this);
    this.maintenance = setInterval(
      () =>
        void this.gc().catch((error) =>
          console.error("File maintenance:", error),
        ),
      3600000,
    );
    this.maintenance.unref?.();
    void this.gc().catch((error) => console.error("File maintenance:", error));
  }
  shutdown() {
    clearInterval(this.maintenance);
    allFiles.delete(this);
  }
  ready: Promise<void>;
  root: string;
  constructor(
    public service: OfficeService,
    root = service.storage.path + ".files",
  ) {
    this.root = resolve(root);
    this.ready = this.initialize();
  }
  private async initialize() {
    await mkdir(join(this.root, "blobs"), { recursive: true });
    await mkdir(join(this.root, "uploads"), { recursive: true });
    this.service.onPersist((tx, snapshot, who, documentId, revision) =>
      this.pinInTransaction(
        tx,
        snapshot,
        who,
        documentId,
        "revision",
        String(revision),
      ),
    );
  }
  require(
    id: string,
    who: IdentityReference,
    write = false,
    version?: number,
    reader?: DatabaseReader,
  ) {
    return catalog.require(this, id, who, write, version, reader);
  }
  begin(
    who: IdentityReference,
    input: {
      name: string;
      size: number;
      mime?: string;
      fileId?: string;
      checksum?: string;
      requestId?: string;
    },
  ) {
    return uploads.begin(this, who, input);
  }
  uploadStatus(id: string, who: IdentityReference) {
    return uploads.uploadStatus(this, id, who);
  }
  append(
    id: string,
    who: IdentityReference,
    offset: number,
    body: ReadableStream<Uint8Array> | null,
  ) {
    return uploads.append(this, id, who, offset, body);
  }
  commitPath(
    who: IdentityReference,
    path: string,
    input: {
      name: string;
      mime: string;
      size: number;
      fileId?: string | null;
      requestId?: string | null;
      checksum?: string | null;
    },
  ) {
    return uploads.commitPath(this, who, path, input);
  }
  finish(id: string, who: IdentityReference) {
    return uploads.finish(this, id, who);
  }
  cancelUpload(id: string, who: IdentityReference) {
    return uploads.cancelUpload(this, id, who);
  }
  put(
    who: IdentityReference,
    input: {
      name: string;
      mime: string;
      data: Uint8Array;
      fileId?: string;
      requestId?: string;
    },
  ) {
    return uploads.put(this, who, input);
  }
  read(id: string, who: IdentityReference, version?: number) {
    return download.read(this, id, who, version);
  }
  list(
    who: IdentityReference,
    query = "",
    trash = false,
    offset = 0,
    limit = 50,
  ) {
    return catalog.list(this, who, query, trash, offset, limit);
  }
  versions(id: string, who: IdentityReference) {
    return catalog.versions(this, id, who);
  }
  references(id: string, who: IdentityReference) {
    return catalog.references(this, id, who);
  }
  manage(
    id: string,
    who: IdentityReference,
    action: "rename" | "trash" | "restore" | "purge",
    name?: string,
  ) {
    return catalog.manage(this, id, who, action, name);
  }
  attach(
    documentId: string,
    who: IdentityReference,
    ref: { fileId: string; version?: number },
    remove = false,
  ) {
    return retention.attach(this, documentId, who, ref, remove);
  }
  pinInTransaction(
    tx: DatabaseTransaction,
    data: Snapshot,
    who: IdentityReference,
    documentId: string,
    scope: string,
    scopeId: string,
  ) {
    return retention.pinInTransaction(
      this,
      tx,
      data,
      who,
      documentId,
      scope,
      scopeId,
    );
  }
  leaseInTransaction(
    tx: DatabaseTransaction,
    who: IdentityReference,
    refs: Array<{ fileId: string; version: number }>,
    scope: string,
    scopeId: string,
  ) {
    return retention.leaseInTransaction(this, tx, who, refs, scope, scopeId);
  }
  releaseLease(scope: string, scopeId: string) {
    return retention.releaseLease(this, scope, scopeId);
  }
  materialize(data: Snapshot, who: IdentityReference) {
    return download.materialize(this, data, who);
  }
  response(
    id: string,
    who: IdentityReference,
    request: Request,
    version?: number,
  ) {
    return download.response(this, id, who, request, version);
  }
  gc(graceMs = 86400000) {
    return retention.gc(this, graceMs);
  }
}

const services = new WeakMap<OfficeService, FileService>();

export function getFileService(service: OfficeService) {
  let files = services.get(service);
  if (!files) {
    files = new FileService(service);
    services.set(service, files);
  }
  return files;
}

const allFiles = new Set<FileService>();

export function shutdownFileServices() {
  for (const files of allFiles) files.shutdown();
}
