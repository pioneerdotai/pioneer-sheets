import { connectApp, type AppClient } from "@pioneercompany/app-sdk/client";

// Register before iframe load so the first Pioneer theme message is retained.
const connection: Promise<AppClient> | null =
  typeof window === "undefined" ? null : connectApp();

void connection?.catch(() => {});

export function getAppClient() {
  if (!connection) throw new Error("PIONEER_BROWSER_REQUIRED");
  return connection;
}

/** The authenticated backend renders the exact relative view root in <base>. */
export function viewUrl(path = "") {
  const base = document.querySelector("base[href]")?.getAttribute("href");
  if (!base) throw new Error("PIONEER_BASE_REQUIRED");
  return new URL(path, new URL(base, location.href)).href;
}
