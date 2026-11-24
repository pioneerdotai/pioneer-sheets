import { requestDownload } from "./pioneer/download";
import { getAppClient } from "./pioneer/client";
import { newId } from "../shared/id";
import { api } from "./documents";

export async function uploadFile(
  file: File,
  fileId?: string,
  progress?: (received: number, total: number) => void,
) {
  const upload = await api("files/uploads", {
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    fileId,
    requestId: newId(),
  });
  try {
    let offset = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + upload.maxChunkBytes);
      let acknowledged = false;
      for (let attempt = 0; attempt < 3 && !acknowledged; attempt++) {
        try {
          const r = await fetch(
            (await getAppClient()).url(
              "api/files/uploads/" + upload.uploadId + "?offset=" + offset,
            ),
            {
              method: "PATCH",
              body: chunk,
            },
          );
          const b = await r.json();
          if (!r.ok) throw new Error(b.error);
          offset = b.received;
          acknowledged = true;
        } catch (e) {
          if (attempt === 2) throw e;
          const state = await api("files/uploads/" + upload.uploadId);
          if (state.received === offset + chunk.size) {
            offset = state.received;
            acknowledged = true;
          } else if (state.received !== offset)
            throw new Error("UPLOAD_OFFSET_MISMATCH");
        }
      }
      progress?.(offset, file.size);
    }
    return await api("files/uploads/" + upload.uploadId + "/finish", {});
  } catch (e) {
    await fetch(
      (await getAppClient()).url("api/files/uploads/" + upload.uploadId),
      {
        method: "DELETE",
      },
    ).catch(() => {});
    throw e;
  }
}

export async function downloadFile(fileId: string, version?: number) {
  const file = await api(
    "files/" + fileId + (version ? "?version=" + version : ""),
  );
  await requestDownload(
    "api/files/" + fileId + "/content" + (version ? "?version=" + version : ""),
    file.name,
  );
}

export async function waitExchange(id: string, onUpdate?: (job: any) => void) {
  for (let i = 0; i < 1800; i++) {
    const j = await api("exchange/" + id);
    onUpdate?.(j);
    if (j.status === "succeeded") return j;
    if (["failed", "cancelled"].includes(j.status))
      throw new Error(j.error ?? "Conversion cancelled");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The job is still running. Check the job list.");
}
