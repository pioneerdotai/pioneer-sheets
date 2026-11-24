import { type IdentityReference, identityReference } from "../../shared/types";
import type { OfficeService } from "./service";

type Service = Pick<
  OfficeService,
  "require" | "storage" | "mutate" | "version"
>;

export async function history(
  service: Service,
  id: string,
  who: IdentityReference,
) {
  await service.require(id, who);
  return (await service.storage.history(id)).map((r) => ({
    ...r,
    actor: identityReference(JSON.parse(r.actor)),
  }));
}

export async function restoreVersion(
  service: Service,
  id: string,
  revision: number,
  who: IdentityReference,
) {
  await service.require(id, who, true);
  const old = await service.version(id, revision, who);
  return service.mutate(
    id,
    who,
    (s) => {
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, old, { id });
    },
    `Restore revision ${revision}`,
  );
}
