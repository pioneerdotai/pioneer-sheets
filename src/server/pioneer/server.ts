import {
  createAppServerContext,
  type AppServerContext,
} from "@pioneercompany/app-sdk/server";
import { appAuthority } from "./auth";

let context: Promise<AppServerContext> | undefined;

/** Installed backend execution authority. Development uses a separate entry. */
export function getPioneerContext() {
  return (context ??= createAppServerContext());
}

export const { authenticateService, pioneerIdentity } = appAuthority(getPioneerContext);

export async function closePioneerContext() {
  if (context) await (await context).close();
}

export async function getAppData() {
  return (await getPioneerContext()).appData;
}

export const development = false;
