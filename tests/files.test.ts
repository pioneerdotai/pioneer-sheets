import { actor } from "./identity";
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Storage } from "../src/server/db/database";
import { OfficeService } from "../src/server/documents/service";
import { FileService } from "../src/server/files/service";
import { fileSource } from "../src/shared/files";

const clean: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const fn of clean.splice(0).reverse()) await fn();
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "office-files-"));
  clean.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Storage(join(dir, "db.pgdata"));
  const seed = () => ({
    id: "doc",
    title: "Files",
    body: { dataStream: "Hello\r\n", paragraphs: [{ startIndex: 5 }] },
    documentStyle: { documentFlavor: 1 },
  });
  const service = new OfficeService(store, "doc", seed);
  clean.push(() => service.close());
  await service.init();
  const owner = actor("Owner").identity,
    other = actor("Other").identity;
  const files = new FileService(service);
  await files.ready;
  return { dir, store, service, owner, other, files };
}

const stream = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Buffer.from(text));
      c.close();
    },
  });

test("resumable chunks, checksum, durable immutable versions and idempotent finish", async () => {
  const e = await setup(),
    u = await e.files.begin(e.owner, {
      name: "Пример.txt",
      mime: "text/plain",
      size: 6,
      checksum:
        "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
    });
  await e.files.append(u.uploadId, e.owner, 0, stream("abc"));
  await expect(
    e.files.append(u.uploadId, e.owner, 0, stream("xyz")),
  ).rejects.toThrow("OFFSET");
  const reopened = new FileService(e.service, e.files.root);
  await reopened.ready;
  expect((await reopened.uploadStatus(u.uploadId, e.owner)).received).toBe(3);
  await reopened.append(u.uploadId, e.owner, 3, stream("def"));
  const file = await reopened.finish(u.uploadId, e.owner);
  expect((await reopened.finish(u.uploadId, e.owner)).id).toBe(file.id);
  expect((await reopened.read(file.id, e.owner, 1)).data.toString()).toBe(
    "abcdef",
  );
  const v2 = await reopened.put(e.owner, {
    name: file.name,
    mime: "text/plain",
    fileId: file.id,
    data: Buffer.from("second"),
    requestId: "version-two",
  });
  expect(v2.version).toBe(2);
  expect(
    (
      await reopened.put(e.owner, {
        name: file.name,
        mime: "text/plain",
        fileId: file.id,
        data: Buffer.from("second"),
        requestId: "version-two",
      })
    ).version,
  ).toBe(2);
  expect((await reopened.read(file.id, e.owner, 1)).data.toString()).toBe(
    "abcdef",
  );
  expect(await reopened.versions(file.id, e.owner)).toHaveLength(2);
});

test("private blobs become document-scoped, remain pinned by history/drafts, and survive trash", async () => {
  const e = await setup();
  const file = await e.files.put(e.owner, {
    name: "image.png",
    mime: "image/png",
    data: Buffer.from("image bytes"),
  });
  await expect(e.files.read(file.id, e.other)).rejects.toThrow("ACCESS");
  const doc = await e.service.create(e.owner);
  await e.files.attach(doc.id, e.owner, { fileId: file.id });
  expect((await e.files.read(file.id, e.other)).data.toString()).toBe(
    "image bytes",
  );
  const draft = await e.service.createDraft(doc.id, e.other);
  await e.files.attach(doc.id, e.owner, { fileId: file.id }, true);
  const refs = await e.files.references(file.id, e.owner);
  expect(refs.some((r) => r.documentId === doc.id)).toBe(true);
  expect(refs.some((r) => r.documentId === draft.id)).toBe(true);
  await e.files.manage(file.id, e.owner, "trash");
  expect((await e.files.read(file.id, e.other)).data.toString()).toBe(
    "image bytes",
  );
  await expect(e.files.manage(file.id, e.owner, "purge")).rejects.toThrow(
    "REFERENCED",
  );
});

test("snapshot references reject guessed private IDs without committing a document", async () => {
  const e = await setup();
  const file = await e.files.put(e.owner, {
    name: "private",
    mime: "text/plain",
    data: Buffer.from("private"),
  });
  const doc = await e.service.create(e.other);
  await expect(
    e.service.mutate(
      doc.id,
      e.other,
      (s) => {
        s.drawings = {
          a: { source: fileSource(file.id, 1), imageSourceType: "UUID" },
        };
      },
      "Unauthorized reference",
    ),
  ).rejects.toThrow("ACCESS");
  expect((await e.service.get(doc.id, e.other)).revision).toBe(0);
});

test("stream downloads implement HEAD, immutable version ranges, ETag and owner access", async () => {
  const e = await setup();
  const file = await e.files.put(e.owner, {
    name: "../測試.txt",
    mime: "text/plain",
    data: Buffer.from("abcdefgh"),
  });
  const response = await e.files.response(
    file.id,
    e.owner,
    new Request("http://localhost/api/files/" + file.id, {
      headers: { Range: "bytes=2-4" },
    }),
  );
  expect(response.status).toBe(206);
  expect(await response.text()).toBe("cde");
  expect(response.headers.get("content-range")).toBe("bytes 2-4/8");
  const head = await e.files.response(
    file.id,
    e.owner,
    new Request("http://localhost/x", { method: "HEAD" }),
  );
  expect(head.headers.get("content-length")).toBe("8");
  expect(await head.text()).toBe("");
  await expect(e.files.require(file.id, e.other)).rejects.toThrow(
    "FILE_ACCESS_DENIED",
  );
});

test("purge frees only unreferenced content and never deletes a deduplicated live blob", async () => {
  const e = await setup();
  const a = await e.files.put(e.owner, {
      name: "a",
      mime: "text/plain",
      data: Buffer.from("same"),
    }),
    b = await e.files.put(e.other, {
      name: "b",
      mime: "text/plain",
      data: Buffer.from("same"),
    });
  expect(a.hash).toBe(b.hash);
  await e.files.manage(a.id, e.owner, "trash");
  await e.files.manage(a.id, e.owner, "purge");
  await e.files.gc(0);
  expect((await e.files.read(b.id, e.other)).data.toString()).toBe("same");
  await e.files.manage(b.id, e.other, "trash");
  await e.files.manage(b.id, e.other, "purge");
  expect((await e.files.gc(0)).removed).toBe(1);
});

test("a document editor can publish a new version of a shared file without moving historical references", async () => {
  const e = await setup(),
    file = await e.files.put(e.owner, {
      name: "Shared.txt",
      mime: "text/plain",
      data: Buffer.from("First"),
    }),
    doc = await e.service.create(e.owner);
  await e.files.attach(doc.id, e.owner, { fileId: file.id, version: 1 });
  const second = await e.files.put(e.other, {
    name: "Shared.txt",
    mime: "text/plain",
    fileId: file.id,
    data: Buffer.from("Second"),
    requestId: "editor-version",
  });
  expect(second.version).toBe(2);
  expect((await e.files.read(file.id, e.other, 2)).data.toString()).toBe(
    "Second",
  );
  expect((await e.files.read(file.id, e.owner, 1)).data.toString()).toBe(
    "First",
  );
  expect(
    (await e.files.references(file.id, e.owner)).every((r) => r.version === 1),
  ).toBe(true);
  await e.files.attach(doc.id, e.other, { fileId: file.id, version: 2 });
  expect((await e.service.get(doc.id, e.owner)).revision).toBe(2);
});

test("runtime retention pins do not grant document readers access to unpublished agent files", async () => {
  const e = await setup(),
    doc = await e.service.create(e.owner),
    secret = await e.files.put(e.other, {
      name: "Pending.txt",
      mime: "text/plain",
      data: Buffer.from("Unpublished"),
    });
  const pending = {
    ...doc.snapshot,
    resources: [
      {
        name: "PIONEER_ATTACHMENTS",
        data: JSON.stringify([{ fileId: secret.id, version: 1 }]),
      },
    ],
  };
  await e.store.transaction((tx) =>
    e.files.pinInTransaction(
      tx,
      pending,
      e.other,
      doc.id,
      "runtime",
      "private-runtime",
    ),
  );
  await expect(e.files.read(secret.id, e.owner)).rejects.toThrow("ACCESS");
  await expect(e.files.versions(secret.id, e.owner)).rejects.toThrow("ACCESS");
  await e.files.manage(secret.id, e.other, "trash");
  await expect(e.files.manage(secret.id, e.other, "purge")).rejects.toThrow(
    "REFERENCED",
  );
  await e.files.attach(doc.id, e.other, { fileId: secret.id, version: 1 });
  expect((await e.files.read(secret.id, e.owner)).data.toString()).toBe(
    "Unpublished",
  );
});
