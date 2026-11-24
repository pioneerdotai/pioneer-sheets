import { newId } from "../../shared/id";

/** Native host owns the save dialog: sandboxed App frames cannot download. */
export function requestDownload(path: string, filename: string): Promise<void> {
  if (!/^api\/files\/[A-Za-z0-9-]+\/content(?:\?version=\d+)?$/.test(path))
    return Promise.reject(new Error("INVALID_DOWNLOAD_PATH"));
  return new Promise((resolve, reject) => {
    const id = newId();
    const finish = (error?: string) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      error ? reject(new Error(error)) : resolve();
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.data?.type !== "pioneer.view.download.result" ||
        event.data.id !== id
      )
        return;
      finish(event.data.error);
    };
    const timer = setTimeout(
      () => finish("Pioneer must support app downloads to save files."),
      10000,
    );
    window.addEventListener("message", receive);
    window.parent.postMessage(
      { type: "pioneer.view.download", id, path, filename },
      "*",
    );
  });
}
