import { useEffect, useSyncExternalStore } from "react";
import {
  identityPresentation, loadProfiles, profilesVersion, subscribeProfiles,
} from "../../client/pioneer/profiles";
import { IdentityAvatar } from "./identity-avatar";
import { Textarea } from "../ui/textarea";
import { ChevronDown, GitPullRequest, History } from "lucide-react";
import { DocumentAttachments } from "../files/document-attachments";
import { api } from "../../client/documents";
import type { WorkspaceModel } from "./use-workspace";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../ui/sheet";
import { ScrollArea } from "../ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "../ui/empty";

export function WorkspacePanels({
  ask,
  client,
  current,
  panel,
  setPanel,
  comparison,
  setError,
  history,
  setHistory,
  run,
  open,
  draftAction,
  date,
}: Pick<
  WorkspaceModel,
  | "ask"
  | "client"
  | "current"
  | "panel"
  | "setPanel"
  | "comparison"
  | "setError"
  | "history"
  | "setHistory"
  | "run"
  | "open"
  | "draftAction"
  | "date"
>) {
  useSyncExternalStore(subscribeProfiles, profilesVersion, () => 0);
  useEffect(() => {
    if (panel === "history") void loadProfiles(history.map(({ actor }) => actor));
  }, [history, panel]);
  const title =
    panel === "attachments"
      ? "Document attachments"
      : panel === "history"
        ? "Revision history"
        : "Review changes";
  return (
    <Sheet
      modal={false}
      open={panel !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) setPanel(null);
      }}
    >
      <SheetContent
        className="side-panel sheets-chrome flex flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        side="right"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {panel === "attachments"
              ? "Files attached to the open document."
              : "Pioneer Sheets workspace."}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-4 p-4">
            {panel === "attachments" && client && (
              <DocumentAttachments client={client} onError={setError} />
            )}
            {panel === "history" &&
              (history.length ? (
                history.map((revision) => (
                  <Card key={revision.revision}>
                    <CardHeader>
                      <CardTitle>Revision {revision.revision}</CardTitle>
                      <CardDescription className="flex items-center gap-1.5">
                        <IdentityAvatar identity={revision.actor} className="size-5" />
                        {identityPresentation(revision.actor).label} · {date(revision.createdAt)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{revision.message}</p>
                    </CardContent>
                    <CardFooter>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void run(async () => {
                            if (
                              !(await ask(
                                `Restore revision ${revision.revision}? This will create a new revision.`,
                              ))
                            )
                              return;
                            await api(
                              `documents/${client!.id}/restore-version`,
                              { revision: revision.revision },
                            );
                            setHistory(
                              await api(`documents/${client!.id}/history`),
                            );
                          })
                        }
                      >
                        Restore
                      </Button>
                    </CardFooter>
                  </Card>
                ))
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <History />
                    </EmptyMedia>
                    <EmptyTitle>No history yet</EmptyTitle>
                    <EmptyDescription>
                      Saved document revisions will appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ))}
            {panel === "review" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <GitPullRequest className="size-4" />
                    {current?.draft ? "Draft" : "Review changes"}
                  </CardTitle>
                  <CardDescription>
                    {current?.draft
                      ? `Draft from revision ${current.draft.baseRevision}`
                      : "An isolated draft for an agent or teammate. The owner reviews and merges the changes."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {current?.draft ? (
                    <>
                      <Badge variant="secondary" className="w-fit">
                        {current.draft.status === "ready"
                          ? "Under review"
                          : current.draft.status === "merged"
                            ? "Merged"
                            : "In progress"}
                      </Badge>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void run(() => open(current.draft!.sourceId))
                        }
                      >
                        Open main document
                      </Button>
                      {current.draft.status === "draft" && (
                        <Button
                          onClick={() => void run(() => draftAction("ready"))}
                        >
                          Submit for review
                        </Button>
                      )}
                      {current.draft.status === "ready" && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() =>
                              void run(() => draftAction("reopen"))
                            }
                          >
                            Reopen draft
                          </Button>
                          <Button
                            onClick={() => void run(() => draftAction("merge"))}
                          >
                            Merge into main document
                          </Button>
                          <p className="text-sm text-muted-foreground">
                            Only the main document owner can merge changes.
                            Concurrent edits to the main document are preserved.
                          </p>
                        </>
                      )}
                      <Collapsible>
                        <CollapsibleTrigger
                          render={
                            <Button
                              variant="ghost"
                              className="w-full justify-between"
                            />
                          }
                        >
                          Compare content
                          <ChevronDown />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <Textarea
                            readOnly
                            value={comparison}
                            aria-label="Content comparison"
                            className="h-72 resize-none font-mono text-xs"
                          />
                        </CollapsibleContent>
                      </Collapsible>
                    </>
                  ) : (
                    <Button
                      onClick={() => void run(() => draftAction("create"))}
                    >
                      Create draft
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
