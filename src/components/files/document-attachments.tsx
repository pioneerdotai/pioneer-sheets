import { useRef, useState } from "react";
import { Paperclip, Upload } from "lucide-react";
import * as Y from "yjs";
import { api, type OfficeClient } from "../../client/documents";
import { uploadFile, downloadFile } from "../../client/files";
import { ATTACHMENTS_RESOURCE } from "../../shared/files";
import { readValue } from "../../shared/documents/model/values";
import { AttachmentPicker } from "./attachment-picker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import {
  Item,
  ItemGroup,
  ItemContent,
  ItemActions,
  ItemTitle,
} from "../ui/item";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "../ui/empty";

export function DocumentAttachments({
  client,
  onError,
}: {
  client: OfficeClient;
  onError: (message: string) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [picking, setPicking] = useState(false);
  const resources = client.doc.getMap("unit").get("resources");
  const resource =
    resources instanceof Y.Map
      ? resources.get(ATTACHMENTS_RESOURCE)
      : undefined;
  const data = resource ? readValue(resource) : undefined;
  const attached: Array<{ fileId: string; version: number; name?: string }> =
    Array.isArray(data) ? data : [];
  const readOnly = client.role === "viewer" || !client.connected;
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    onError("");
    try {
      await operation();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const attach = async (
    file: { id: string; version: number },
    remove = false,
  ) => {
    await client.flush();
    await api(`files/${file.id}/attach`, {
      documentId: client.id,
      version: file.version,
      remove,
    });
  };
  return (
    <div className="grid gap-4">
      <Input
        ref={upload}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            void run(async () => {
              setProgress(0);
              const uploaded = await uploadFile(
                file,
                undefined,
                (loaded, total) =>
                  setProgress(
                    total > 0 ? Math.round((loaded / total) * 100) : 100,
                  ),
              );
              await attach(uploaded);
            });
        }}
      />
      <Button
        disabled={readOnly || busy}
        onClick={() => upload.current?.click()}
      >
        <Upload />
        Upload and attach
      </Button>
      <Button
        variant="outline"
        disabled={readOnly || busy}
        onClick={() => setPicking(true)}
      >
        <Paperclip />
        Choose existing file
      </Button>
      {busy && <Spinner aria-label="Updating attachments" />}
      {progress !== null && (
        <Progress value={progress} aria-label="Attachment upload progress" />
      )}
      {picking && (
        <AttachmentPicker
          onSelect={attach}
          onClose={() => setPicking(false)}
          onError={onError}
        />
      )}
      {attached.length ? (
        <ItemGroup aria-label="Document attachments">
          {attached.map((file) => (
            <Item key={file.fileId} variant="outline">
              <ItemContent>
                <ItemTitle>
                  <Button
                    variant="link"
                    className="h-auto whitespace-normal text-left"
                    onClick={() =>
                      void run(() => downloadFile(file.fileId, file.version))
                    }
                  >
                    {file.name ?? file.fileId} · v{file.version}
                  </Button>
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={readOnly || busy}
                  onClick={() =>
                    void run(() =>
                      attach({ id: file.fileId, version: file.version }, true),
                    )
                  }
                >
                  Detach
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Paperclip />
            </EmptyMedia>
            <EmptyTitle>No attachments</EmptyTitle>
            <EmptyDescription>
              Attach files that belong to this document.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
