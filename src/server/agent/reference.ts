import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ReferenceSymbol = {
  id: string;
  kind: string;
  signatures: string[];
  documentation: string;
  packages: string[];
  version: string;
};
type ReferenceCatalog = { sdkVersion: string; symbols: ReferenceSymbol[] };

let cache: Promise<ReferenceCatalog> | undefined;

export function referenceCatalog() {
  return (cache ??= readFile(resolve("public/agent-api.json"), "utf8").then(
    (text) => JSON.parse(text) as ReferenceCatalog,
  ));
}

const loadReferenceIndex = () =>
  referenceCatalog().then((catalog) => ({
    catalog,
    byId: new Map(catalog.symbols.map((symbol) => [symbol.id, symbol])),
    entries: catalog.symbols.map((symbol) => ({
      symbol,
      id: symbol.id.toLowerCase(),
      text: (
        symbol.documentation +
        " " +
        symbol.signatures.join(" ")
      ).toLowerCase(),
    })),
  }));

let index: ReturnType<typeof loadReferenceIndex> | undefined;

function referenceIndex() {
  return (index ??= loadReferenceIndex());
}

export async function findApi(input: {
  terms: string[];
  unit?: "sheet" | "doc" | "all";
  limit?: number;
}) {
  const { catalog, entries } = await referenceIndex();
  const terms = input.terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!terms.length) throw new Error("Provide API search terms");
  const matches = entries
    .filter(
      ({ symbol: s }) =>
        !input.unit ||
        input.unit === "all" ||
        s.packages.some(
          (p) =>
            p.includes(input.unit === "sheet" ? "sheets" : "docs") ||
            p.endsWith("/core"),
        ),
    )
    .map(({ symbol, id, text }) => {
      const score = terms.reduce(
        (n, t) =>
          n + (id === t ? 100 : id.includes(t) ? 20 : text.includes(t) ? 1 : 0),
        0,
      );
      return { symbol, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.symbol.id.localeCompare(b.symbol.id),
    )
    .slice(0, Math.min(50, Math.max(1, input.limit ?? 20)))
    .map(({ symbol: s }) => ({
      id: s.id,
      kind: s.kind,
      signatures: s.signatures,
      summary: s.documentation.split("\n")[0],
      packages: s.packages,
    }));
  return { sdkVersion: catalog.sdkVersion, matches };
}

export async function showApi(ids: string[]) {
  const { catalog, byId } = await referenceIndex();
  if (!ids.length || ids.length > 20)
    throw new Error("Request 1 to 20 API symbols");
  return {
    sdkVersion: catalog.sdkVersion,
    symbols: ids.map((id) => {
      const record = byId.get(id);
      if (!record) return { id, notFound: true };
      const members = ["class", "interface"].includes(record.kind)
        ? catalog.symbols
            .filter((s) => s.id.startsWith(id + "."))
            .map((s) => ({ id: s.id, signatures: s.signatures }))
        : undefined;
      return { ...record, ...(members ? { members } : {}) };
    }),
  };
}
