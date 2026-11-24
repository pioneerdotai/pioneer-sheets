import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { posix } from "node:path";
import { createHash } from "node:crypto";
import type { Snapshot } from "../../shared/documents/model";

export type Package = Record<string, Uint8Array>;

export function readPackage(bytes: Uint8Array): Package {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50)
    throw new Error("INVALID_OFFICE_ZIP");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("ZIP_DIRECTORY_MISSING");
  const entries = view.getUint16(end + 10, true),
    start = view.getUint32(end + 16, true);
  if (entries === 65535 || entries > 10000)
    throw new Error("ZIP_ENTRY_LIMIT_OR_ZIP64");
  let cursor = start,
    total = 0;
  const names = new Set<string>();
  for (let n = 0; n < entries; n++) {
    if (
      cursor + 46 > bytes.length ||
      view.getUint32(cursor, true) !== 0x02014b50
    )
      throw new Error("INVALID_ZIP_DIRECTORY");
    const flags = view.getUint16(cursor + 8, true),
      size = view.getUint32(cursor + 24, true),
      nameLength = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true);
    if (flags & 1) throw new Error("ENCRYPTED_OFFICE_FILE");
    const name = strFromU8(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      name.includes("\0") ||
      names.has(name)
    )
      throw new Error("UNSAFE_ZIP_ENTRY");
    names.add(name);
    total += size;
    if (size > 50_000_000 || total > 150_000_000)
      throw new Error("OFFICE_UNCOMPRESSED_SIZE_LIMIT");
    cursor += 46 + nameLength + extra + comment;
  }
  const result = unzipSync(bytes);
  let actual = 0;
  for (const [name, data] of Object.entries(result)) {
    actual += data.length;
    if (actual > 150_000_000 || data.length > 50_000_000)
      throw new Error("OFFICE_UNCOMPRESSED_SIZE_LIMIT");
    if (name.endsWith(".xml") || name.endsWith(".rels"))
      if (/<!DOCTYPE|<!ENTITY/i.test(strFromU8(data)))
        throw new Error("OFFICE_XML_DTD_NOT_ALLOWED");
  }
  if (!result["[Content_Types].xml"]) throw new Error("NOT_AN_OFFICE_PACKAGE");
  return result;
}

export function writePackage(parts: Package) {
  return zipSync(parts, { level: 6 });
}

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text?: string;
}

export function localName(name: string) {
  return name.split(":").pop()!;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  ignoreDeclaration: true,
  allowBooleanAttributes: false,
});

export function xml(source: string): XmlNode {
  if (source.length > 50_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("UNSAFE_OFFICE_XML");
  const valid = XMLValidator.validate(source);
  if (valid !== true) throw new Error("INVALID_OFFICE_XML");
  const convert = (items: any[]): XmlNode[] =>
    items.flatMap((item) => {
      if ("#text" in item)
        return [
          {
            name: "#text",
            attrs: {},
            children: [],
            text: String(item["#text"]),
          },
        ];
      const name = Object.keys(item).find((k) => k !== ":@");
      return name
        ? [
            {
              name,
              attrs: item[":@"] ?? {},
              children: convert(item[name] ?? []),
            },
          ]
        : [];
    });
  return {
    name: "#document",
    attrs: {},
    children: convert(parser.parse(source)),
  };
}

export function children(node: XmlNode | undefined, name: string) {
  return node?.children.filter((n) => localName(n.name) === name) ?? [];
}

export function child(node: XmlNode | undefined, name: string) {
  return children(node, name)[0];
}

export function descendants(
  node: XmlNode | undefined,
  name: string,
): XmlNode[] {
  return node
    ? node.children.flatMap((n) => [
        ...(localName(n.name) === name ? [n] : []),
        ...descendants(n, name),
      ])
    : [];
}

export function attr(node: XmlNode | undefined, name: string) {
  const key = Object.keys(node?.attrs ?? {}).find((k) => localName(k) === name);
  return key ? node!.attrs[key] : undefined;
}

export function text(node: XmlNode | undefined): string {
  return node?.text ?? node?.children.map(text).join("") ?? "";
}

export function esc(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function serialize(node: XmlNode): string {
  if (node.name === "#text") return esc(node.text);
  if (node.name === "#document") return node.children.map(serialize).join("");
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => " " + k + '="' + esc(v) + '"')
    .join("");
  return (
    "<" +
    node.name +
    attrs +
    (node.children.length
      ? ">" + node.children.map(serialize).join("") + "</" + node.name + ">"
      : "/>")
  );
}

export function xmlPart(parts: Package, path: string) {
  const data = parts[path];
  if (!data) throw new Error("OFFICE_PART_MISSING: " + path);
  return xml(strFromU8(data));
}

export function packagePath(base: string, target: string) {
  if (target.includes("\\") || target.includes("\0"))
    throw new Error("UNSAFE_OFFICE_RELATIONSHIP");
  const path = target.startsWith("/")
    ? target.slice(1)
    : posix.normalize(posix.join(posix.dirname(base), target));
  if (path.startsWith("../") || path.includes("://"))
    throw new Error("UNSAFE_OFFICE_RELATIONSHIP");
  return path;
}

export function relationships(parts: Package, path: string) {
  const relPath = posix.join(
    posix.dirname(path),
    "_rels",
    posix.basename(path) + ".rels",
  );
  const result = new Map<
    string,
    { target: string; type: string; external: boolean }
  >();
  if (parts[relPath])
    for (const node of descendants(xmlPart(parts, relPath), "Relationship")) {
      const id = attr(node, "Id")!,
        external = attr(node, "TargetMode") === "External",
        target = attr(node, "Target") ?? "";
      result.set(id, {
        target: external ? target : packagePath(path, target),
        type: attr(node, "Type") ?? "",
        external,
      });
    }
  return result;
}

export function putXml(parts: Package, path: string, source: string) {
  parts[path] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + source,
  );
}

export const EXCHANGE_RESOURCE = "PIONEER_EXCHANGE";

export function exchangeMetadata(snapshot: Snapshot) {
  try {
    return JSON.parse(
      (snapshot.resources ?? []).find((r: any) => r.name === EXCHANGE_RESOURCE)
        ?.data ?? "null",
    );
  } catch {
    return null;
  }
}

export function setExchangeMetadata(snapshot: Snapshot, metadata: any) {
  snapshot.resources ??= [];
  const record = { name: EXCHANGE_RESOURCE, data: JSON.stringify(metadata) },
    index = snapshot.resources.findIndex(
      (r: any) => r.name === EXCHANGE_RESOURCE,
    );
  if (index < 0) snapshot.resources.push(record);
  else snapshot.resources[index] = record;
}

export function fingerprint(snapshot: Snapshot) {
  const data = structuredClone(snapshot);
  delete data.id;
  delete data.appVersion;
  delete data.locale;
  data.resources = (data.resources ?? [])
    .filter((r: any) => r.name !== EXCHANGE_RESOURCE)
    .map((r: any) => {
      try {
        return { name: r.name, data: JSON.parse(r.data) };
      } catch {
        return r;
      }
    })
    .filter(
      (r: any) =>
        r.data &&
        (!Array.isArray(r.data) || r.data.length) &&
        Object.keys(r.data).length,
    )
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      const keys = Object.keys(value)
        .filter(
          (k) =>
            !["unitId", "subUnitId"].includes(k) &&
            !(value.f && ["v", "t"].includes(k)),
        )
        .sort();
      return Object.fromEntries(keys.map((k) => [k, normalize(value[k])]));
    }
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(normalize(data)))
    .digest("hex");
}
