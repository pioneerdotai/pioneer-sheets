import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = new URL("../", import.meta.url);
if (
  !isAbsolute(process.env.PIONEER_BOOTSTRAP || "") ||
  !isAbsolute(process.env.APP_DATA || "")
)
  throw new Error("Pioneer must provide PIONEER_BOOTSTRAP and APP_DATA");
await access(process.env.PIONEER_BOOTSTRAP);
process.env.NODE_ENV = "production";
process.env.HOST = "0.0.0.0";
process.env.PORT = "3000";
process.chdir(fileURLToPath(appRoot));
await import(new URL(".output/server/index.mjs", appRoot).href);
