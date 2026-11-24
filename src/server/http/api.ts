import { authenticateService, pioneerIdentity } from "#sheets-authority";
import { fileHttp } from "../files/http";
import { getService } from "../runtime";
import { ServiceError } from "../documents/error";
import { OfficeAI } from "../documents/ai";
import { handleMcp } from "../mcp/index";

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").split("/");
  const json = (value: any, status = 200) =>
    Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  try {
    await authenticateService(request.headers);
    if (Number(request.headers.get("content-length") ?? 0) > 8 * 1024 * 1024)
      throw new ServiceError(413, "REQUEST_TOO_LARGE");
    const service = await getService();
    if (path[0] === "health") return json({ ok: true, kind: service.kind });
    if (path[0] === "mcp") return await handleMcp(request, service);
    const who = await pioneerIdentity(request.headers);
    if (path[0] === "context") {
      if (request.method !== "GET")
        throw new ServiceError(405, "PIONEER_MANAGES_IDENTITY");
      return json({ identity: who });
    }
    if (["files", "exchange"].includes(path[0]))
      return await fileHttp(request, service, who, path);
    if (path[0] !== "documents") throw new ServiceError(404, "Route not found");
    if (!path[1]) {
      if (request.method === "GET")
        return json(
          await service.list(who, url.searchParams.get("trash") === "1"),
        );
      if (request.method === "POST") {
        const body = await request.json();
        return json(await service.create(who, body.title, body.snapshot), 201);
      }
    }
    const id = path[1];
    const action = path[2];
    if (!action && request.method === "GET")
      return json(
        url.searchParams.get("metadata") === "1"
          ? await service.describe(id, who)
          : await service.get(id, who),
      );
    if (action === "update" && request.method === "POST")
      return json(await service.update(id, who, await request.json()));
    if (action === "meta" && request.method === "POST") {
      const b = await request.json();
      return json(await service.meta(id, who, b.action, b.value));
    }
    if (action === "draft") {
      if (request.method === "GET")
        return json(await service.draftInfo(id, who));
      const b = await request.json();
      return json(
        b.action === "create"
          ? await service.createDraft(id, who)
          : await service.reviewDraft(id, who, b.action),
      );
    }
    if (action === "history") return json(await service.history(id, who));
    if (action === "restore-version" && request.method === "POST") {
      const b = await request.json();
      return json(await service.restoreVersion(id, b.revision, who));
    }
    if (action === "edit" && request.method === "POST") {
      const b = await request.json();
      return json(
        await new OfficeAI(service).execute(
          id,
          who,
          b.operations,
          b.requestId,
          b.expectedRevision,
        ),
      );
    }
    if (action === "inspect")
      return json(
        await new OfficeAI(service).inspect(
          id,
          who,
          Object.fromEntries(url.searchParams),
        ),
      );
    if (action === "members" && request.method === "POST") {
      const b = await request.json();
      return json(await service.setMember(id, who, b.identityId, b.role));
    }
    throw new ServiceError(404, "Route not found");
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      e instanceof ServiceError ? e.status : 400,
    );
  }
}
