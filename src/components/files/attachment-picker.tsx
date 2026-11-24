import { useState } from "react";
import { Search } from "lucide-react";
import { useFiles } from "./use-files";
import { FilePagination } from "./pagination";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { ScrollArea } from "../ui/scroll-area";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
  ItemGroup,
} from "../ui/item";
import { Button } from "../ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "../ui/empty";

export function AttachmentPicker({
  onSelect,
  onClose,
  onError,
}: {
  onSelect: (file: { id: string; version: number }) => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { files, query, setQuery, offset, setOffset, hasMore } = useFiles({
    view: "files",
    onError,
  });
  const [busy, setBusy] = useState(false);
  const select = async (file: { id: string; version: number }) => {
    setBusy(true);
    onError("");
    try {
      await onSelect(file);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setBusy(false);
    }
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sheets-chrome sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach an existing file</DialogTitle>
          <DialogDescription>
            Choose a file for this document.
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupInput
            aria-label="Search files to attach"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
            placeholder="Search files"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <ScrollArea className="h-72">
          <ItemGroup>
            {files.map((file) => (
              <Item key={file.id}>
                <ItemContent>
                  <ItemTitle>{file.name}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button disabled={busy} onClick={() => void select(file)}>
                    Attach
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          {!files.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No files found</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </ScrollArea>
        <FilePagination
          offset={offset}
          hasMore={hasMore}
          onChange={setOffset}
        />
      </DialogContent>
    </Dialog>
  );
}
