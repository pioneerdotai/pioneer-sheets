import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Download,
  ChevronDown,
  Paperclip,
  History,
  GitPullRequest,
  Undo2,
  Redo2,
  X,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Maximize2,
} from "lucide-react";
import { getAppClient } from "../../client/pioneer/client";
import { formats, type ExchangeFormat } from "../../shared/exchange";
import { appConfig } from "../../app-config";
import type { WorkspaceModel } from "./use-workspace";
import { Button } from "../ui/button";
import { AvatarGroup } from "../ui/avatar";
import { IdentityAvatar } from "./identity-avatar";
import {
  identityPresentation, loadProfiles, profilesVersion, subscribeProfiles,
} from "../../client/pioneer/profiles";
import { ButtonGroup } from "../ui/button-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const placements = [
  { value: "bottom", label: "Move app to bottom", icon: PanelBottom },
  { value: "right", label: "Move app to right", icon: PanelRight },
  { value: "fullscreen", label: "Expand app", icon: Maximize2 },
] as const;

export function WorkspaceHeader({
  placement,
  setPlacement,
  client,
  current,
  panel,
  run,
  back,
  closeApp,
  showPanel,
  download,
}: Pick<
  WorkspaceModel,
  | "placement"
  | "setPlacement"
  | "client"
  | "current"
  | "panel"
  | "run"
  | "back"
  | "closeApp"
  | "showPanel"
  | "download"
>) {
  const [moving, setMoving] = useState(false);
  const members = client?.members;
  useSyncExternalStore(subscribeProfiles, profilesVersion, () => 0);
  useEffect(() => {
    if (members) void loadProfiles(members);
  }, [members]);
  return (
    <header className="sheets-chrome flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-1 h-8.5 text-muted-foreground">
      <div className="flex gap-4 flex-row items-center">
        <div className="flex min-w-0 items-center gap-1">
          {client && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void run(() => back())}
              aria-label="All documents"
            >
              <ArrowLeft />
            </Button>
          )}
          {client && (
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {current?.title}
              </h1>
            </div>
          )}
        </div>
        {client && (
          <>
            <Separator orientation="vertical" className="my-1" />
            <div className="flex flex-wrap items-center gap-0 -ml-3">
              <Button
                size="sm"
                variant={panel === "history" ? "secondary" : "ghost"}
                onClick={() => void run(() => showPanel("history"))}
              >
                <History />
                History
              </Button>
              <Button
                size="sm"
                variant={panel === "review" ? "secondary" : "ghost"}
                onClick={() => void run(() => showPanel("review"))}
              >
                <GitPullRequest />
                Drafts
              </Button>
              <Button
                size="sm"
                variant={panel === "attachments" ? "secondary" : "ghost"}
                onClick={() => void run(() => showPanel("attachments"))}
              >
                <Paperclip />
                Attachments
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                  <Download />
                  Download
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="sheets-chrome" align="end">
                  {formats[appConfig.kind].export.map((format) => (
                    <DropdownMenuItem
                      key={format}
                      className="text-xs"
                      onClick={() =>
                        void run(() => download(format as ExchangeFormat))
                      }
                    >
                      {format.toUpperCase()}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {client && (
          <div className="flex flex-row gap-4 items-center">
            <div>
              <div
                className="subtitle text-sm"
                role="status"
              >
                {!client.editorReady
                  ? "Preparing editor…"
                  : client.connected
                    ? client.pending.size
                      ? "Saving…"
                      : `Saved`
                    : "Disconnected · editing paused"}
              </div>
            </div>
            <ButtonGroup className="-mr-1.5" aria-label="Edit history">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={client.role === "viewer"}
                onClick={() => client.undoEdit()}
                title="Undo your change"
                aria-label="Undo your change"
              >
                <Undo2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={client.role === "viewer"}
                onClick={() => client.redoEdit()}
                title="Redo your change"
                aria-label="Redo your change"
              >
                <Redo2 />
              </Button>
            </ButtonGroup>
            <Separator orientation="vertical" className="my-1" />
            <AvatarGroup aria-label="Participants">
              {members?.map((member) => (
                <Tooltip key={member.connectionId}>
                  <TooltipTrigger
                    render={
                      <IdentityAvatar
                        identity={member}
                        tabIndex={0}
                        className="size-6 border-2 border-background"
                      />
                    }
                  />
                  <TooltipContent className="sheets-chrome">
                    {identityPresentation(member).label}
                  </TooltipContent>
                </Tooltip>
              ))}
            </AvatarGroup>
            <Separator orientation="vertical" className="my-1" />
          </div>
        )}
        <div className="-ml-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="App placement"
              title="App placement"
              disabled={moving}
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="sheets-chrome w-56" align="end">
              <DropdownMenuRadioGroup
                aria-label="App placement"
                value={placement}
                onValueChange={(value) => {
                  if (moving || value === placement) return;
                  const next = value as "fullscreen" | "bottom" | "right";
                  setMoving(true);
                  void run(async () => {
                    try {
                      await (await getAppClient()).view.setPlacement(next);
                      setPlacement(next);
                    } finally {
                      setMoving(false);
                    }
                  });
                }}
              >
                {placements.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    disabled={moving}
                  >
                    <Icon aria-hidden />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close app"
            onClick={() => void run(closeApp)}
          >
            <X />
          </Button>
        </div>
      </div>
    </header>
  );
}
