import type { OfficeService } from "../documents/service";
import { ServiceError } from "../documents/error";
import type { Identity } from "../../shared/types";
import { getFileService } from "./service";
import { getExchangeService } from "../exchange/service";
import { formats } from "../../shared/exchange";

export async function fileHttp(
  request: Request,
  service: OfficeService,
  who: Identity,
  path: string[],
) {
  const url = new URL(request.url),
    files = getFileService(service),
    json = (v: any, status = 200) =>
      Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
  if (path[0] === "exchange") {
    const exchange = getExchangeService(service);
    if (path[1] === "formats") return json(formats[service.kind]);
    if (!path[1]) {
      if (request.method === "GET")
        return json(
          await exchange.list(
            who,
            Math.max(0, Number(url.searchParams.get("offset") ?? 0)),
          ),
        );
      if (request.method === "POST")
        return json(await exchange.create(who, await request.json()), 202);
    } else if (request.method === "GET")
      return json(await exchange.get(path[1], who));
    else if (request.method === "POST") {
      const b = await request.json();
      if (!["cancel", "retry", "purge"].includes(b.action))
        throw new ServiceError(400, "INVALID_JOB_ACTION");
      return json(await exchange.manage(path[1], who, b.action));
    }
  }
  if (path[0] === "files") {
    if (!path[1] && request.method === "GET")
      return json(
        await files.list(
          who,
          url.searchParams.get("q") ?? "",
          url.searchParams.get("trash") === "1",
          Math.max(0, Number(url.searchParams.get("offset") ?? 0)),
        ),
      );
    if (path[1] === "uploads") {
      if (!path[2] && request.method === "POST")
        return json(await files.begin(who, await request.json()), 201);
      const id = path[2];
      if (request.method === "GET")
        return json(await files.uploadStatus(id, who));
      if (request.method === "PATCH")
        return json(
          await files.append(
            id,
            who,
            Number(url.searchParams.get("offset")),
            request.body,
          ),
        );
      if (request.method === "DELETE")
        return json(await files.cancelUpload(id, who));
      if (request.method === "POST" && path[3] === "finish")
        return json(await files.finish(id, who), 201);
    }
    const id = path[1],
      action = path[2],
      version = url.searchParams.has("version")
        ? Number(url.searchParams.get("version"))
        : undefined;
    if (action === "content" && ["GET", "HEAD"].includes(request.method))
      return files.response(id, who, request, version);
    if (action === "versions") return json(await files.versions(id, who));
    if (action === "references") return json(await files.references(id, who));
    if (action === "attach" && request.method === "POST") {
      const b = await request.json();
      return json(
        await files.attach(
          b.documentId,
          who,
          { fileId: id, version: b.version },
          b.remove === true,
        ),
      );
    }
    if (!action && request.method === "GET")
      return json(await files.require(id, who, false, version));
    if (!action && request.method === "POST") {
      const b = await request.json();
      if (!["rename", "trash", "restore", "purge"].includes(b.action))
        throw new ServiceError(400, "INVALID_FILE_ACTION");
      return json(await files.manage(id, who, b.action, b.name));
    }
  }
  throw new ServiceError(404, "FILE_ROUTE_NOT_FOUND");
}
