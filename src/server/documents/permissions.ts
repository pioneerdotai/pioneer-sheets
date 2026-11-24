import { eq, and } from "drizzle-orm";
import type { DatabaseReader } from "../db/database";
import { members } from "../db/schema/documents";
import { type IdentityReference } from "../../shared/types";
import type { OfficeService } from "./service";
import { ServiceError } from "./error";

type Service = Pick<
  OfficeService,
  "storage" | "role" | "require" | "broadcast"
>;

export function mayDeleteAgentSheet(
  document: { kind: string; ownerId: string },
  creator: string | null | undefined,
  who: IdentityReference,
) {
  if (who.type !== "human" || document.kind !== "sheet" || !creator)
    return false;
  try {
    const actor = JSON.parse(creator) as IdentityReference | null;
    return actor?.type === "agent" && actor.id === document.ownerId;
  } catch {
    return false;
  }
}

export async function role(
  service: Service,
  id: string,
  who: IdentityReference,
  reader: DatabaseReader = service.storage.db,
) {
  const row = await service.storage.info(id, reader);
  if (!row) throw new ServiceError(404, "Document not found");
  if (row.ownerId === who.id) return "owner";
  const member = (
    await reader
      .select()
      .from(members)
      .where(and(eq(members.documentId, id), eq(members.identityId, who.id)))
  )[0];
  return member?.role ?? "editor";
}

export async function require(
  service: Service,
  id: string,
  who: IdentityReference,
  write = false,
  owner = false,
  reader?: DatabaseReader,
) {
  const role = await service.role(id, who, reader);
  if ((write && role === "viewer") || (owner && role !== "owner"))
    throw new ServiceError(403, "Permission denied");
  return role;
}

export async function setMember(
  service: Service,
  id: string,
  who: IdentityReference,
  identityId: string,
  role: "editor" | "viewer",
) {
  if (!["editor", "viewer"].includes(role) || !identityId)
    throw new ServiceError(400, "Invalid participant permissions");
  await service.require(id, who, false, true);
  await service.storage.write(() =>
    service.storage.db
      .insert(members)
      .values({ documentId: id, identityId, role })
      .onConflictDoUpdate({
        target: [members.documentId, members.identityId],
        set: { role },
      }),
  );
  service.broadcast(id, { type: "permissions" });
  return { ok: true };
}
