import { mkdir } from "node:fs/promises";
await mkdir(".agent", { recursive: true });
const quickJS = ["quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"];
const build = await Bun.build({
  entrypoints: ["src/server/agent/worker-entry.ts"],
  outdir: ".agent",
  naming: "worker.mjs",
  target: "node",
  packages: "bundle",
  external: quickJS,
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}
console.log("Built isolated agent worker");


const exchange = await Bun.build({
  entrypoints: ["src/server/exchange/worker.ts"],
  outdir: ".agent",
  naming: "exchange-worker.mjs",
  target: "node",
  packages: "bundle",
  external: quickJS,
});
if (!exchange.success) {
  for (const log of exchange.logs) console.error(log);
  process.exit(1);
}
console.log("Built Office Exchange worker");
