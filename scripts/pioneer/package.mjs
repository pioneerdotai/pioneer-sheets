import {
  cp,
  mkdir,
  readFile,
  writeFile,
  stat,
  rm,
  realpath,
} from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileIndex, sha256 } from "./files.mjs";
const root = process.cwd(),
  require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile("app.json", "utf8"));
const output = resolve("dist", `sheets-${manifest.version}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of [".output", "public", "drizzle"])
  await cp(name, join(output, name), {
    recursive: true,
    dereference: true,
    filter: (p) => {
      if (/(?:^|\/)node_modules\/(?:playwright(?:-core)?|@playwright)(?:\/|$)/.test(p))
        throw new Error("Playwright is test-only. Rebuild the Sheets runtime before packaging.");
      return !p.includes("/node_modules/") || !p.includes("/.cache/");
    },
  });
await mkdir(join(output, ".agent"));
for (const name of ["worker.mjs", "exchange-worker.mjs"])
  await cp(join(".agent", name), join(output, ".agent", name));
// Bundled workers have only QuickJS as a runtime package external. Copy its
// declared dependency closure, including actual WASM files; never copy dev deps.
const copied = new Set();
async function dependency(name, from = root) {
  const loader = createRequire(join(from, "package.json"));
  let file;
  try {
    file = loader.resolve(name + "/package.json");
  } catch {
    let directory = dirname(loader.resolve(name));
    while (true) {
      try {
        const candidate = join(directory, "package.json");
        if (JSON.parse(await readFile(candidate, "utf8")).name === name) {
          file = candidate;
          break;
        }
      } catch {}
      if (directory === dirname(directory))
        throw new Error("Cannot locate runtime package " + name);
      directory = dirname(directory);
    }
  }
  const directory = await realpath(dirname(file)),
    p = JSON.parse(await readFile(file, "utf8"));
  if (copied.has(p.name)) return;
  copied.add(p.name);
  await cp(directory, join(output, "node_modules", p.name), {
    recursive: true,
    dereference: true,
    filter: (p) => !relative(directory, p).split("/").includes("node_modules"),
  });
  for (const dep of Object.keys(p.dependencies || {}))
    await dependency(dep, directory);
}
await dependency("quickjs-emscripten");
await mkdir(join(output, "runtime"));
await cp("packaging/start.mjs", join(output, "runtime/start.mjs"));
for (const name of ["assets", "skills"])
  await cp(name, join(output, name), { recursive: true });
await cp(".mcp.json", join(output, ".mcp.json"));
await cp("app.json", join(output, "app.json"));
await writeFile(
  join(output, "files.json"),
  JSON.stringify(await fileIndex(output), null, 2) + "\n",
);
const archive = output + ".tar.gz";
execFileSync("tar", [
  "-czf",
  archive,
  "-C",
  dirname(output),
  output.split("/").pop(),
]);
const archiveBytes = (await stat(archive)).size,
  files = await fileIndex(output),
  expandedBytes = files.reduce((sum, f) => sum + f.size, 0),
  largestEntryBytes = Math.max(...files.map((f) => f.size));
const receipt = {
  version: manifest.version,
  archive: relative(root, archive),
  sha256: await sha256(archive),
  archiveBytes,
  expandedBytes,
  largestEntryBytes,
  fileCount: files.length,
  gatewayCurrentLimits: {
    archiveBytes: 64 * 1024 * 1024,
    expandedBytes: 256 * 1024 * 1024,
    entryBytes: 64 * 1024 * 1024,
  },
  requiresGatewayLimitUpdate:
    archiveBytes > 64 * 1024 * 1024 ||
    expandedBytes > 256 * 1024 * 1024 ||
    largestEntryBytes > 64 * 1024 * 1024,
};
await writeFile(archive + ".json", JSON.stringify(receipt, null, 2) + "\n");
await writeFile(
  archive + ".sha256",
  receipt.sha256 + "  " + archive.split("/").pop() + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
