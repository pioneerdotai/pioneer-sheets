import { resolve } from "node:path";
import {
  createAppServerContext,
  type AppServerContext,
} from "@pioneercompany/app-sdk/server";
import { appAuthority } from "./auth.ts";

export const development = true;
let context: Promise<AppServerContext> | undefined;

export const { authenticateService, pioneerIdentity } = appAuthority(getPioneerContext);

export async function getAppData() {
  return resolve(process.env.APP_DATA || ".sheets-data");
}

export async function closePioneerContext() {
  if (context) await (await context).close();
}

export async function getPioneerContext() {
  return (context ??= createDevelopmentContext());
}

export async function createDevelopmentContext() {
  const bootstrapPath = process.env.PIONEER_BOOTSTRAP || resolve("credential.json");
  try {
    const app = await createAppServerContext({
      bootstrapPath,
      appData: await getAppData(),
    });
    if (!app.host.capabilities.includes("host.render")) {
      await app.close();
      throw new Error("The dev credential does not grant host.render.");
    }
    return app;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "sdk.invalid_bootstrap"
    ) {
      throw new Error("Save the JSON from pioneer dev app add as credential.json beside app.json.");
    }
    throw error;
  }
}
