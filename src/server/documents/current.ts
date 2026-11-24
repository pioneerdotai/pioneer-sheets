import { base64, encode } from "../../shared/documents/model";
import type { IdentityReference } from "../../shared/types";
import type { OfficeService } from "./service";
import { ServiceError } from "./error";

// The caller owns the existing document lock. Shared by GET, WebSocket sync
// and draft review (which already holds that lock).
export async function readCurrent(
  service: Pick<OfficeService, "describe" | "storage" | "journal" | "info">,
  id: string,
  who: IdentityReference,
  includeTrash = false,
  includeSnapshot = true,
) {
  const info = await service.describe(id, who, includeTrash);
  const row = await service.storage.get(id);
  if (!row || (row.deletedAt && !includeTrash))
    throw new ServiceError(410, "Document is in trash");
  return service.journal.use(row, async (entry) => ({
    ...info,
    ...service.info(row),
    ...(includeSnapshot ? { snapshot: structuredClone(entry.data) } : {}),
    update: base64(encode(entry.doc)),
  }));
}
