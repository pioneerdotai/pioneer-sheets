import { Download, FileOutput, RotateCcw, Trash2, X } from "lucide-react";
import { api } from "../../client/documents";
import { downloadFile, waitExchange } from "../../client/files";
import { toast } from "../ui/toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import type { Diagnostic } from "../../shared/exchange";
import type { FilesModel } from "./use-files";

const statuses: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Completed",
  failed: "Error",
  cancelled: "Cancelled",
};

export function ExchangeJobs({
  jobs,
  run,
  setBusy,
  onOpen,
}: Pick<FilesModel, "jobs" | "run" | "setBusy"> & {
  onOpen: (id: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-4">
      {!jobs.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileOutput />
            </EmptyMedia>
            <EmptyTitle>No jobs yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {jobs.map((job) => (
        <Card key={job.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {job.operation === "import" ? "Import" : "Export"}{" "}
              {job.format.toUpperCase()}
              <Badge
                variant={job.status === "failed" ? "destructive" : "secondary"}
              >
                {statuses[job.status] ?? job.status}
              </Badge>
            </CardTitle>
            <CardDescription>
              {new Date(job.createdAt).toLocaleString("en-US")}
              {job.target?.revision !== undefined
                ? " · revision " + job.target.revision
                : ""}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            {(job.error || (job.result?.diagnostics?.length ?? 0) > 0) && (
              <Button
                variant="outline"
                onClick={() => {
                  const diagnostics: Diagnostic[] = job.result?.diagnostics ?? [];
                  const details = [
                    job.error,
                    ...diagnostics.map(({ code, message }) => `${code}: ${message}`),
                  ].filter(Boolean).join("\n");
                  toast.add({
                    title: [job.operation, job.format.toUpperCase(), "details"].join(" "),
                    description: details,
                    type: job.error || diagnostics.some((d) => d.severity === "error")
                      ? "error"
                      : diagnostics.some((d) => d.severity === "warning") ? "warning" : "info",
                    timeout: 0,
                  });
                }}
              >
                Details
              </Button>
            )}
            {job.result?.documentId && (
              <Button
                variant="outline"
                onClick={() => void run(() => onOpen(job.result.documentId))}
              >
                Open document
              </Button>
            )}
            {job.result?.file && (
              <Button
                variant="outline"
                onClick={() =>
                  void run(() =>
                    downloadFile(job.result.file.id, job.result.file.version),
                  )
                }
              >
                <Download />
                Download result
              </Button>
            )}
            {["queued", "running"].includes(job.status) ? (
              <Button
                variant="outline"
                onClick={() =>
                  void run(() =>
                    api("exchange/" + job.id, { action: "cancel" }),
                  )
                }
              >
                <X />
                Cancel
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void run(() =>
                      api("exchange/" + job.id, { action: "purge" }),
                    )
                  }
                >
                  <Trash2 />
                  Delete job record
                </Button>
                {job.status === "failed" &&
                  job.operation === "export" &&
                  job.target && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void run(async () => {
                          const next = await api("exchange", {
                            operation: "export",
                            format: job.format,
                            documentId: job.target.documentId,
                            runtimeId: job.target.runtimeId,
                            revision: job.target.revision,
                            options: { allowLossy: true },
                          });
                          setBusy("Exporting with simplifications allowed…");
                          const done = await waitExchange(next.id);
                          await downloadFile(done.result.file.id);
                        })
                      }
                    >
                      Export with simplifications
                    </Button>
                  )}
                {["failed", "cancelled"].includes(job.status) && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run(() =>
                        api("exchange/" + job.id, { action: "retry" }),
                      )
                    }
                  >
                    <RotateCcw />
                    Retry
                  </Button>
                )}
              </>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
