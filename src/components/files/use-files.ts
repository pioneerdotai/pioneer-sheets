import { useDialog } from "../ui/use-dialog";
import { useState, useEffect, useRef } from "react";
import { api } from "../../client/documents";
import { equal } from "../../shared/documents/model";

export function useFiles({
  view,
  onError,
}: {
  view: "files" | "conversions";
  onError: (s: string) => void;
}) {
  const { ask, modal } = useDialog();

  const [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false);

  const [files, setFiles] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [trash, setTrash] = useState(false),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [versions, setVersions] = useState<any[]>([]),
    [references, setReferences] = useState<any[]>([]),
    [busy, setBusy] = useState("");

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const upload = useRef<HTMLInputElement>(null),
    newVersion = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<any>) => {
    try {
      onError("");
      await fn();
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      setUploadProgress(null);
    }
  };

  async function load(signal?: AbortSignal) {
    if (view === "files") {
      const f = await api(
        "files?trash=" +
          (trash ? "1" : "0") +
          "&q=" +
          encodeURIComponent(query) +
          "&offset=" +
          offset,
        undefined,
        undefined,
        signal,
      );
      if (signal?.aborted) return;
      setFiles((old) => (equal(old, f.items) ? old : f.items));
      setHasMore(f.hasMore);
    } else {
      const j = await api(
        "exchange?offset=" + offset,
        undefined,
        undefined,
        signal,
      );
      if (!signal?.aborted) {
        setJobs((old) => (equal(old, j.items) ? old : j.items));
        setHasMore(j.hasMore);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let lastError: string | undefined;
    const poll = async () => {
      try {
        if (document.visibilityState !== "hidden") {
          await load(controller.signal);
          lastError = undefined;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!controller.signal.aborted && message !== lastError) {
          lastError = message;
          onError(message);
        }
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(poll, view === "files" ? 5000 : 2500);
      }
    };
    timer = setTimeout(poll, query ? 200 : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trash, query, offset, view]);

  async function detail(f: any) {
    setSelected(f);
    const [versions, references] = await Promise.all([
      api("files/" + f.id + "/versions"),
      api("files/" + f.id + "/references"),
    ]);
    setVersions(versions);
    setReferences(references);
  }

  return {
    ask,
    modal,
    offset,
    setOffset,
    hasMore,
    files,
    jobs,
    trash,
    setTrash,
    query,
    setQuery,
    selected,
    setSelected,
    versions,
    references,
    busy,
    setBusy,
    uploadProgress,
    setUploadProgress,
    upload,
    newVersion,
    run,
    detail,
  };
}

export type FilesModel = ReturnType<typeof useFiles>;
