import { formats } from "../../shared/exchange";
import { appConfig } from "../../app-config";
import Editor from "../editor/index";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { TooltipProvider } from "../ui/tooltip";
import { useWorkspace } from "./use-workspace";
import { WorkspaceHeader } from "./workspace-header";
import { Library } from "./library";
import { WorkspacePanels } from "./workspace-panels";

export default function Workspace() {
  const state = useWorkspace();
  const { viewer, error, themeReady } = state;
  if (!viewer || !themeReady)
    return (
      <main
        className="sheets-chrome flex h-dvh w-full min-w-0 items-center justify-center gap-3 overflow-hidden bg-background p-6"
        role="status"
      >
        {!error && themeReady ? (
          <>
            <Spinner aria-hidden />
            Opening your Pioneer workspace…
          </>
        ) : null}
      </main>
    );
  const model = { ...state, viewer };
  const {
    modal,
    client,
    current,
    panel,
    setError,
    file,
    run,
    importFile,
  } = model;

  return (
    <TooltipProvider>
      <div className="sheets-shell flex h-dvh w-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        {modal}
        <Input
          className="hidden"
          ref={file}
          type="file"
          accept={formats[appConfig.kind].import
            .map((format) => "." + format)
            .join(",")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(() => importFile(file));
            event.target.value = "";
          }}
        />
        <WorkspaceHeader {...model} />
        {!client ? (
          <Library {...model} />
        ) : (
          <main className="editor-area">
            <Editor client={client} onError={setError} />
            {(client.role === "viewer" || !client.connected) && (
              <div className="readonly-cover sheets-chrome absolute inset-0 z-40 flex items-start justify-center p-3">
                <Badge
                  variant="secondary"
                  className="max-w-full whitespace-normal text-center shadow-sm"
                >
                  {!client.connected
                    ? "Disconnected · editing paused"
                    : current?.draft?.status === "ready"
                      ? "Draft under review"
                      : current?.draft?.status === "merged"
                        ? "Draft merged"
                        : "View only"}
                </Badge>
              </div>
            )}
          </main>
        )}
        {panel && <WorkspacePanels {...model} />}
      </div>
    </TooltipProvider>
  );
}
