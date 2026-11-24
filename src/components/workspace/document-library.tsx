import {
  FileSpreadsheet,
  Search,
  Trash2,
  Star,
  Copy,
  Pencil,
  RefreshCw,
  Plus,
  Undo2,
} from "lucide-react";
import type { WorkspaceModel } from "./use-workspace";
import { Button } from "../ui/button";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "../ui/input-group";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "../ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";

export function DocumentLibrary({
  ask,
  query,
  setQuery,
  trash,
  sort,
  setSort,
  run,
  loadList,
  open,
  create,
  meta,
  list,
  date,
}: Pick<
  WorkspaceModel,
  | "ask"
  | "query"
  | "setQuery"
  | "trash"
  | "sort"
  | "setSort"
  | "run"
  | "loadList"
  | "open"
  | "create"
  | "meta"
  | "list"
  | "date"
>) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto grid gap-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-48 flex-1">
            <InputGroupInput
              aria-label="Search documents"
              placeholder="Find a document…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
          </InputGroup>
          <NativeSelect
            aria-label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <NativeSelectOption value="modified">
              Recently modified
            </NativeSelectOption>
            <NativeSelectOption value="title">Name</NativeSelectOption>
            <NativeSelectOption value="star">Starred first</NativeSelectOption>
          </NativeSelect>
          <Button variant="outline" onClick={() => void run(() => loadList())}>
            <RefreshCw />
            Refresh
          </Button>
        </div>
        {list.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((document) => (
              <Card className="document-card relative" key={document.id}>
                {!trash && (
                  <button
                    type="button"
                    aria-label={`Open ${document.title}`}
                    className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    onClick={() => void run(() => open(document.id))}
                  />
                )}
                <CardHeader>
                  <CardTitle
                    role="heading"
                    aria-level={3}
                    className="flex min-w-0 items-center gap-2 text-sm"
                  >
                    <span className="truncate">{document.title}</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Modified {date(document.updatedAt)}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex flex-wrap justify-between gap-2 py-1 [&_button]:relative [&_button]:z-20">
                  {trash ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Restore"
                        onClick={() =>
                          void run(() => meta(document, "restore"))
                        }
                      >
                        <Undo2/>
                      </Button>
                      {document.canPurge && (
                        <Button
                          size="icon-xs"
                          variant="destructive"
                          aria-label="Delete permanently"
                          onClick={() =>
                            void run(async () => {
                              if (await ask("Delete this document permanently?"))
                                await meta(document, "purge");
                            })
                          }
                        >
                          <Trash2/>
                        </Button>
                      )}
                    </>
                  ) : (
                      <>
                        <div>
                        <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Rename"
                        aria-label="Rename"
                        onClick={() =>
                          void run(async () => {
                            const name = await ask(
                              "Document name",
                              document.title,
                            );
                            if (name) await meta(document, "rename", name);
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Duplicate"
                        aria-label="Duplicate"
                        onClick={() =>
                          void run(() => meta(document, "duplicate"))
                        }
                      >
                        <Copy />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Move to trash"
                        aria-label="Move to trash"
                        onClick={() =>
                          void run(async () => {
                            if (await ask("Move this document to trash?"))
                              await meta(document, "trash");
                          })
                        }
                      >
                        <Trash2 />
                        </Button>
                        </div>
                        <div>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Starred"
                            aria-label={
                              document.starred
                                ? "Remove from starred"
                                : "Add to starred"
                            }
                            aria-pressed={document.starred}
                            onClick={() =>
                              void run(() =>
                                meta(document, "star", !document.starred),
                              )
                            }
                          >
                            <Star
                              className={document.starred ? "fill-current" : ""}
                            />
                          </Button>
                        </div>
                    </>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Empty className="min-h-80 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileSpreadsheet />
              </EmptyMedia>
              <EmptyTitle>
                {query
                  ? "No results"
                  : trash
                    ? "Trash is empty"
                    : "Your work starts here"}
              </EmptyTitle>
              <EmptyDescription>
                {query
                  ? "Try a different search."
                  : "Create a document to get started."}
              </EmptyDescription>
            </EmptyHeader>
            {!trash && !query && (
              <EmptyContent>
                <Button onClick={() => void run(() => create())}>
                  <Plus />
                  Create document
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}
      </div>
    </ScrollArea>
  );
}
