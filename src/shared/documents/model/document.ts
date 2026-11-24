import * as Y from "yjs";
import { Snapshot, LOCAL } from "./types";
import { anchorBodyMetadata } from "./rich-text";
import { readMap, createValue, syncMap } from "./values";
import { editAxis } from "./sheets";
import { anchorFormulas } from "./formulas";

export function createModel(snapshot: Snapshot): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [k, v] of Object.entries(snapshot))
      if (v !== undefined) doc.getMap("unit").set(k, createValue(v));
    anchorFormulas(doc);
    anchorBodyMetadata(doc.getMap("unit"));
  });
  return doc;
}

export function snapshot(doc: Y.Doc): Snapshot {
  return readMap(doc.getMap("unit"));
}

export function writeSnapshot(
  doc: Y.Doc,
  before: Snapshot,
  after: Snapshot,
  origin: any = LOCAL,
) {
  doc.transact(() => {
    const edits = after.$axisEdits ?? [];
    for (const e of edits) {
      const sheet = (doc.getMap("unit").get("sheets") as Y.Map<any>)?.get(
        e.sheetId,
      );
      if (sheet?.has("$grid")) editAxis(sheet, e);
    }
    const clean = { ...after };
    delete clean.$axisEdits;
    syncMap(doc.getMap("unit"), before, clean);
    anchorFormulas(doc);
    anchorBodyMetadata(doc.getMap("unit"));
  }, origin);
}

export function fromUpdate(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

export function encode(doc: Y.Doc) {
  return Y.encodeStateAsUpdate(doc);
}

export function base64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unbase64(s: string): Uint8Array {
  if (typeof Buffer !== "undefined")
    return new Uint8Array(Buffer.from(s, "base64"));
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
