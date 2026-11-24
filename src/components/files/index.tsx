import { useId } from "react";
import { Download, Files, Search, Trash2, Upload } from "lucide-react";
import { api } from "../../client/documents";
import { uploadFile, downloadFile } from "../../client/files";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import {
  Item,
  ItemActions,
  ItemGroup,
  ItemMedia,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../ui/item";
import { Field, FieldLabel } from "../ui/field";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "../ui/input-group";
import { FilePagination } from "./pagination";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import { useFiles } from "./use-files";
import { FileDetails } from "./file-details";
import { ExchangeJobs } from "./exchange-jobs";

export function FilesPage({
  view,
  onOpen,
  onError,
}: {
  view: "files" | "conversions";
  onOpen: (id: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const model = useFiles({ view, onError });
  const {
    modal,
    offset,
    setOffset,
    hasMore,
    files,
    trash,
    setTrash,
    query,
    setQuery,
    selected,
    setSelected,
    busy,
    setBusy,
    uploadProgress,
    setUploadProgress,
    upload,
    newVersion,
    run,
    detail,
  } = model;
  const trashId = useId();
  return (
    <div className="file-panel grid gap-4">
      {modal}
      {busy && (
        <Item role="status" variant="muted" size="sm">
          <ItemMedia>
            <Spinner aria-hidden />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{busy}</ItemTitle>
          </ItemContent>
        </Item>
      )}
      {uploadProgress !== null && (
        <Progress value={uploadProgress} aria-label="File upload progress" />
      )}
      <Input
        className="hidden"
        ref={upload}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void run(async () => {
              setBusy("Uploading…");
              setUploadProgress(0);
              await uploadFile(file, undefined, (loaded, total) => {
                const percent =
                  total > 0 ? Math.round((loaded / total) * 100) : 100;
                setUploadProgress(percent);
                setBusy("Uploading " + percent + "%");
              });
            });
          event.target.value = "";
        }}
      />
      <Input
        className="hidden"
        ref={newVersion}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && selected)
            void run(async () => {
              setBusy("Uploading a new version…");
              setUploadProgress(0);
              await detail(
                await uploadFile(file, selected.id, (loaded, total) => {
                  setUploadProgress(
                    total > 0 ? Math.round((loaded / total) * 100) : 100,
                  );
                }),
              );
            });
          event.target.value = "";
        }}
      />
      {view === "files" ? (
        <div className="grid gap-4">
          <InputGroup>
            <InputGroupInput
              aria-label="Search files"
              placeholder="Search files"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOffset(0);
              }}
            />
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
          </InputGroup>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => upload.current?.click()}>
              <Upload />
              Upload file
            </Button>
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id={trashId}
                checked={trash}
                onCheckedChange={(checked) => {
                  setTrash(checked === true);
                  setOffset(0);
                }}
              />
              <FieldLabel htmlFor={trashId}>File trash</FieldLabel>
            </Field>
          </div>
          {!files.length && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Files />
                </EmptyMedia>
                <EmptyTitle>No files yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          <ItemGroup aria-label="Workspace files">
            {files.map((file) => (
              <Item
                variant="outline"
                key={file.id}
                className="file-item flex-col items-stretch"
              >
                <ItemContent>
                  <ItemTitle>
                    <Button
                      variant="link"
                      className="h-auto justify-start whitespace-normal p-0 text-left"
                      onClick={() => void run(() => detail(file))}
                    >
                      {file.name}
                    </Button>
                  </ItemTitle>
                  <ItemDescription>
                    v{file.version} · {(file.size / 1024).toFixed(1)} KB ·{" "}
                    {file.mime}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(() => downloadFile(file.id, file.version))
                    }
                  >
                    <Download />
                    Download
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await api("files/" + file.id, {
                          action: trash ? "restore" : "trash",
                        });
                        setSelected(null);
                      })
                    }
                  >
                    <Trash2 />
                    {trash ? "Restore" : "Move to trash"}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          {selected && <FileDetails {...model} />}
        </div>
      ) : (
        <ExchangeJobs {...model} onOpen={onOpen} />
      )}
      <FilePagination offset={offset} hasMore={hasMore} onChange={setOffset} />
    </div>
  );
}
