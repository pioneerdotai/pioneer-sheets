import { getFileService } from "./files/service";
import { getExchangeService } from "./exchange/service";
import { OfficeService } from "./documents/service";
import { Storage } from "./db/database";
import { getAppData } from "#sheets-authority";
import { join } from "node:path";
import { appConfig } from "../app-config";
import { createBlank } from "./documents/templates";

const globalKey = Symbol.for(
  `pioneer-office:${appConfig.kind}:${process.env.APP_DATA ?? "missing"}`,
);

export function getService(): Promise<OfficeService> {
  const g = globalThis as any;
  return (g[globalKey] ??= (async () => {
    const appData = await getAppData();
    const service = new OfficeService(
      new Storage(join(appData, "sheets.pgdata")),
      appConfig.kind,
      createBlank as any,
    );
    await service.init();
    await getFileService(service).ready;
    getFileService(service).startMaintenance();
    await getExchangeService(service).ready;
    return service;
  })());
}

export async function shutdownOfficeService() {
  const pending = (globalThis as any)[globalKey] as
    Promise<OfficeService> | undefined;
  if (pending) await (await pending).close();
}
