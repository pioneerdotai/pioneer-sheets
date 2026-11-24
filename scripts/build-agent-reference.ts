import ts from "typescript-api";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const selected = [
  "core",
  "sheets",
  "sheets-formula",
  "sheets-filter",
  "sheets-sort",
  "sheets-table",
  "sheets-numfmt",
  "sheets-data-validation",
  "sheets-conditional-formatting",
  "sheets-hyper-link",
  "sheets-drawing",
  "engine-formula",
  "drawing",
  "docs",
  "docs-drawing",
  "docs-hyper-link",
];
const symbols = new Map<string, any>();
async function files(path: string): Promise<string[]> {
  const items = await readdir(path, { withFileTypes: true }).catch(() => []);
  return (
    await Promise.all(
      items.map((item) =>
        item.isDirectory()
          ? files(join(path, item.name))
          : item.name.endsWith(".d.ts")
            ? [join(path, item.name)]
            : [],
      ),
    )
  ).flat();
}
for (const name of selected) {
  const base = join("node_modules/@univerjs", name);
  const meta = JSON.parse(await readFile(join(base, "package.json"), "utf8"));
  for (const path of await files(join(base, "lib/types"))) {
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const aliases = new Map<string, string>();
    function findAliases(node: ts.Node) {
      if (ts.isInterfaceDeclaration(node) && /^F[A-Z]/.test(node.name.text))
        for (const heritage of node.heritageClauses ?? [])
          for (const parent of heritage.types)
            aliases.set(parent.expression.getText(source), node.name.text);
      ts.forEachChild(node, findAliases);
    }
    findAliases(source);
    const docs = (node: any) =>
      (node.jsDoc ?? [])
        .map((doc: any) =>
          doc
            .getText(source)
            .replace(/^\/\*\*|\*\/$/g, "")
            .replace(/^\s*\* ?/gm, ""),
        )
        .join("\n")
        .trim();
    function add(id: string, kind: string, signature: string, node: any) {
      const record = symbols.get(id) ?? {
        id,
        kind,
        signatures: [],
        documentation: "",
        packages: [],
        version: meta.version,
      };
      if (!record.signatures.includes(signature))
        record.signatures.push(signature);
      const documentation = docs(node);
      if (documentation && !record.documentation.includes(documentation))
        record.documentation +=
          (record.documentation ? "\n" : "") + documentation;
      if (!record.packages.includes("@univerjs/" + name))
        record.packages.push("@univerjs/" + name);
      symbols.set(id, record);
    }
    function visit(node: ts.Node) {
      if (
        (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
        node.name
      ) {
        const owner = aliases.get(node.name.text) ?? node.name.text;
        if (!owner.startsWith("_")) {
          add(
            owner,
            ts.isClassDeclaration(node) ? "class" : "interface",
            node.name.text,
            node,
          );
          for (const member of node.members) {
            const key = member.name?.getText(source);
            if (
              !key ||
              key.startsWith("_") ||
              key === "constructor" ||
              member.modifiers?.some(
                (m) =>
                  m.kind === ts.SyntaxKind.PrivateKeyword ||
                  m.kind === ts.SyntaxKind.ProtectedKeyword,
              )
            )
              continue;
            add(owner + "." + key, "member", member.getText(source), member);
          }
        }
      } else if (
        ts.isEnumDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)
      ) {
        add(
          node.name.text,
          ts.isEnumDeclaration(node) ? "enum" : "type",
          node.getText(source),
          node,
        );
        if (ts.isEnumDeclaration(node))
          for (const member of node.members)
            add(
              node.name.text + "." + member.name.getText(source),
              "enum-member",
              member.getText(source),
              member,
            );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
await writeFile(
  "public/agent-api.json",
  JSON.stringify({
    schemaVersion: 1,
    generatedFrom: "Installed Apache-2.0 public declaration files",
    sdkVersion: "1.5.0",
    packages: selected.map((n) => "@univerjs/" + n),
    symbols: [...symbols.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }),
);
console.log("Generated offline API reference: " + symbols.size + " symbols");
