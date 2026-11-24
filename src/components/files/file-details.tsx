import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { api } from "../../client/documents";
import { downloadFile } from "../../client/files";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Item,
  ItemGroup,
  ItemContent,
  ItemDescription,
  ItemTitle,
  ItemActions,
} from "../ui/item";
import { ButtonGroup } from "../ui/button-group";
import { Separator } from "../ui/separator";
import type { FilesModel } from "./use-files";

export function FileDetails({
  ask,
  selected,
  setSelected,
  versions,
  references,
  newVersion,
  run,
  detail,
}: Pick<
  FilesModel,
  | "ask"
  | "selected"
  | "setSelected"
  | "versions"
  | "references"
  | "newVersion"
  | "run"
  | "detail"
>) {
  if (!selected) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="wrap-break-words">{selected.name}</CardTitle>
        <CardDescription className="break-all font-mono text-xs">
          {selected.id}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ButtonGroup aria-label="File actions">
          <Button variant="outline" onClick={() => newVersion.current?.click()}>
            <Upload />
            New version
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void run(async () => {
                const name = await ask("File name", selected.name);
                if (name)
                  await detail(
                    await api("files/" + selected.id, {
                      action: "rename",
                      name,
                    }),
                  );
              })
            }
          >
            <Pencil />
            Rename
          </Button>
        </ButtonGroup>
        <ItemGroup aria-label="File versions">
          {versions.map((version) => (
            <Item key={version.version} size="sm">
              <ItemActions>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void run(() =>
                      downloadFile(version.fileId, version.version),
                    )
                  }
                >
                  <Download />
                  Download v{version.version}
                </Button>
              </ItemActions>
              <ItemContent>
                <ItemDescription>
                  {new Date(version.createdAt).toLocaleString("en-US")}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
        <Separator />
        <Item>
          <ItemContent>
            <ItemTitle>Document references</ItemTitle>
            <ItemDescription>
              {references.length
                ? references.length +
                  " references in documents, history and drafts. These versions are protected from deletion."
                : "No document references."}
            </ItemDescription>
          </ItemContent>
        </Item>
        {selected.deletedAt && (
          <Button
            variant="destructive"
            className="justify-self-start"
            onClick={() =>
              void run(async () => {
                await api("files/" + selected.id, { action: "purge" });
                setSelected(null);
              })
            }
          >
            <Trash2 />
            Delete permanently
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
