import type { WorkspaceModel } from "./use-workspace";
import { DocumentLibrary } from "./document-library";
import { LibrarySidebar } from "./library-sidebar";
import { LibraryLayout } from "./library-layout";
import { FilesPage } from "../files";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { ScrollArea } from "../ui/scroll-area";

export function Library(model: WorkspaceModel) {
  const { section, setSection, open, setError, run, create, file } =
    model;
  return (
    <SidebarProvider className="sheets-chrome relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <LibraryLayout
        width={model.sidebarWidth}
        sidebar={
          <LibrarySidebar
            section={section}
            onNavigate={setSection}
            onCreate={() => void run(() => create())}
            onOpenFile={() => file.current?.click()}
          />
        }
      >
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <SidebarTrigger className="ml-4 mt-4 shrink-0 md:hidden" />
          {section === "documents" || section === "trash" ? (
            <DocumentLibrary {...model} />
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto grid w-full gap-6 p-4 md:p-6">
                <FilesPage
                  key={section}
                  view={section}
                  onOpen={open}
                  onError={setError}
                />
              </div>
            </ScrollArea>
          )}
        </SidebarInset>
      </LibraryLayout>
    </SidebarProvider>
  );
}
