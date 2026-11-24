import { toast } from "../ui/toast";
import { useDialog } from "../ui/use-dialog";
import { getAppClient, viewUrl } from "../../client/pioneer/client";
import { loadViewerProfile } from "../../client/pioneer/profiles";
import { usePioneerTheme } from "../../client/pioneer/theme";
import { uploadFile, downloadFile, waitExchange } from "../../client/files";
import { formats, type ExchangeFormat } from "../../shared/exchange";
import { useCallback, useEffect, useRef, useState } from "react";
import { appConfig } from "../../app-config";
import { api, OfficeClient } from "../../client/documents";
import type { DocumentInfo, DocumentRevision, Identity } from "../../shared/types";

export type LibrarySection = "documents" | "trash" | "files" | "conversions";

type ViewerContext = { identity: Identity };

export function useWorkspace() {
  const [viewer, setViewer] = useState<ViewerContext | null>(null);

  const { ask, modal } = useDialog();

  const [placement, setPlacement] = useState("fullscreen");

  const [documents, setDocuments] = useState<DocumentInfo[]>([]);

  const [client, setClient] = useState<OfficeClient | null>(null);

  const [current, setCurrent] = useState<DocumentInfo | null>(null);

  const [, refresh] = useState(0);

  const [query, setQuery] = useState("");

  const [section, setSection] = useState<LibrarySection>("documents");
  const trash = section === "trash";

  const [sort, setSort] = useState("modified");

  const sidebarWidth = useRef<number | null>(null);

  const [panel, setPanel] = useState<
    "history" | "review" | "attachments" | null
  >(null);

  const [comparison, setComparison] = useState("");

  const [error, setErrorState] = useState("");
  const setError = useCallback((message: string) => {
    setErrorState(message);
    if (message) toast.add({ title: message, type: "error", priority: "high" });
  }, []);
  const themeReady = usePioneerTheme(setError);

  const [history, setHistory] = useState<DocumentRevision[]>([]);

  const file = useRef<HTMLInputElement>(null);

  const viewerRef = useRef(viewer);

  viewerRef.current = viewer;

  const clientRef = useRef(client);

  clientRef.current = client;

  const run = async (fn: () => Promise<any>) => {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  async function loadList(s = viewerRef.current, t = trash) {
    if (s) setDocuments(await api(`documents${t ? "?trash=1" : ""}`));
  }

  async function open(id: string, s = viewerRef.current) {
    if (!s) return;
    const doc = await api("documents/" + id + "?metadata=1");
    if (clientRef.current) await clientRef.current.flush();
    clientRef.current?.close();
    const c = new OfficeClient(id, s.identity);
    c.onStatus = () => {
      refresh((n) => n + 1);
      const unit = c.doc.getMap("unit");
      const title = unit.get("name") ?? unit.get("title");
      if (unit.get("id"))
        setCurrent((old) =>
          old && (old.title !== title || old.revision !== c.revision)
            ? { ...old, title: String(title), revision: c.revision }
            : old,
        );
    };
    c.onError = setError;
    c.onEvent = (e) => {
      if (e.type === "deleted" || (e.type === "meta" && e.deletedAt)) {
        toast.add({
          title: e.type === "deleted" ? "Document deleted" : "Document moved to trash",
          type: "success",
        });
        void back(true);
      }
      if (e.type === "permissions" || e.type === "draft-state") {
        void api("documents/" + id + "?metadata=1").then((value) => {
          c.role = value.role;
          c.onRole?.();
          if (value.role === "viewer")
            (document.activeElement as HTMLElement)?.blur?.();
          setCurrent(value);
          refresh((n) => n + 1);
        });
      }
    };
    setClient(c);
    setCurrent(doc);
    setPanel(null);
    historyPush(id);
  }

  function historyPush(id?: string) {
    window.history.pushState(
      {},
      "",
      viewUrl(id ? `?document=${encodeURIComponent(id)}` : ""),
    );
  }

  async function back(force = false) {
    if (!force && clientRef.current) await clientRef.current.flush();
    clientRef.current?.close();
    setClient(null);
    setCurrent(null);
    setSection("documents");
    setPanel(null);
    historyPush();
    void loadList();
  }

  useEffect(() => {
    let active = true;
    void loadViewerProfile();
    void run(async () => {
      const supplied = await api<ViewerContext>("context");
      if (!active) return;
      setViewer(supplied);
      viewerRef.current = supplied;
      await loadList(supplied);
      const id = new URLSearchParams(location.search).get("document");
      if (id) await open(id, supplied);
    });
    const pop = () => {
      const id = new URLSearchParams(location.search).get("document");
      if (id) void run(() => open(id));
      else back();
    };
    window.addEventListener("popstate", pop);
    return () => {
      active = false;
      window.removeEventListener("popstate", pop);
      clientRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (viewer) void run(() => loadList(viewer, trash));
  }, [trash]);

  async function closeApp() {
    if (clientRef.current) await clientRef.current.flush();
    (await getAppClient()).view.close();
  }

  async function create() {
    const d = await api("documents", {});
    await open(d.id);
  }

  async function meta(doc: DocumentInfo, action: string, value?: any) {
    await api(`documents/${doc.id}/meta`, { action, value });
    await loadList();
    if (client?.id === doc.id && action === "rename")
      setCurrent({ ...doc, title: value });
  }

  async function draftAction(action: string) {
    if (!client) return;
    await client.flush();
    const result = await api(`documents/${client.id}/draft`, {
      action,
    });
    if (action === "create") await open(result.id);
    else if (action === "merge") await open(result.sourceId);
    else {
      const d = await api("documents/" + client.id + "?metadata=1");
      client.role = d.role;
      client.onRole?.();
      setCurrent(d);
      refresh((n) => n + 1);
    }
  }

  async function showPanel(next: typeof panel) {
    setPanel(panel === next ? null : next);
    if (!client) return;
    if (next === "review") {
      const d = await api("documents/" + client.id);
      setCurrent(d);
      if (d.draft) {
        const source = await api("documents/" + d.draft.sourceId);
        const compact = (s: any) =>
          JSON.stringify(s.sheets, null, 2).slice(0, 6000);
        setComparison(
          `MAIN DOCUMENT · revision ${source.revision}\n${compact(source.snapshot)}\n\nDRAFT · revision ${d.revision}\n${compact(d.snapshot)}`,
        );
      }
    }
    if (next === "history")
      setHistory(await api(`documents/${client.id}/history`));
  }

  async function download(format: ExchangeFormat = "json") {
    if (!client) return;
    const revision = await client.flush();
    const progress = toast.add({
      title: `Preparing ${format.toUpperCase()} from revision ${revision}…`,
      type: "loading",
      timeout: 0,
    });
    try {
      const job = await api("exchange", {
        operation: "export",
        format,
        documentId: client.id,
        revision,
      });
      const result = await waitExchange(job.id);
      await downloadFile(result.result.file.id, result.result.file.version);
      toast.add({
        title: "File ready",
        description: result.result.diagnostics?.map((d: { message: string }) => d.message).join(" · "),
        type: "success",
      });
    } finally {
      toast.close(progress);
    }
  }

  async function importFile(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase(),
      format = ext as ExchangeFormat;
    if (!formats[appConfig.kind].import.includes(format))
      throw new Error("Unsupported import format");
    const progress = toast.add({
      title: `Uploading ${f.name}…`,
      type: "loading",
      timeout: 0,
    });
    try {
      const source = await uploadFile(f);
      const job = await api("exchange", {
        operation: "import",
        format,
        fileId: source.id,
        fileVersion: source.version,
      });
      const result = await waitExchange(job.id);
      await loadList();
      await open(result.result.documentId);
      toast.add({
        title: "Document imported",
        description: result.result.diagnostics?.map((d: { message: string }) => d.message).join(" · "),
        type: "success",
      });
    } finally {
      toast.close(progress);
    }
  }

  const list = documents
    .filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "star"
          ? Number(b.starred) - Number(a.starred)
          : b.updatedAt - a.updatedAt,
    );

  const date = (n: number) =>
    new Date(n).toLocaleString("en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });
  return {
    viewer,
    ask,
    modal,
    themeReady,
    placement,
    setPlacement,
    documents,
    client,
    current,
    query,
    setQuery,
    trash,
    section,
    setSection,
    sidebarWidth,
    sort,
    setSort,
    panel,
    setPanel,
    comparison,
    error,
    setError,
    history,
    setHistory,
    file,
    run,
    loadList,
    open,
    back,
    closeApp,
    create,
    meta,
    draftAction,
    showPanel,
    download,
    importFile,
    list,
    date,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;

export type WorkspaceModel = WorkspaceState & {
  viewer: NonNullable<WorkspaceState["viewer"]>;
};
