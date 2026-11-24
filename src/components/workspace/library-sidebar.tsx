import {
  CirclePlus,
  Files,
  FolderOpen,
  FileOutput,
  Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import type { LibrarySection } from "./use-workspace";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "../ui/sidebar";

// sidebar-01 navigation composition; document search stays in the library.
export function LibrarySidebar({
  section,
  onNavigate,
  onCreate,
  onOpenFile,
}: {
  section: LibrarySection;
  onNavigate: (value: LibrarySection) => void;
  onCreate: () => void;
  onOpenFile: () => void;
}) {
  const { setOpenMobile, isMobile } = useSidebar();

  const documents: Array<{
    title: string;
    icon: typeof Files;
    section: LibrarySection;
  }> = [
    { title: "All documents", icon: Files, section: "documents" },
    { title: "Trash", icon: Trash2, section: "trash" },
  ];

  const library: Array<{
    title: string;
    icon: typeof Files;
    section: LibrarySection;
  }> = [
    { title: "Files", icon: FolderOpen, section: "files" },
    { title: "Conversions", icon: FileOutput, section: "conversions" },
  ];

  return (
    <Sidebar
      collapsible={isMobile ? "offcanvas" : "none"}
      className={isMobile ? "absolute h-full" : "h-full w-full"}
    >
      <SidebarContent>
        <SidebarGroup className="pt-6">
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem className="flex items-center gap-2">
                <SidebarMenuButton
                  className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  onClick={() => {
                    setOpenMobile(false);
                    onCreate();
                  }}
                >
                  <CirclePlus
                    aria-hidden
                    className="fill-white [&>path]:stroke-black dark:fill-black dark:[&>path]:stroke-white"
                  />
                  <span className="truncate">Create document</span>
                </SidebarMenuButton>
                <Button
                  size="icon"
                  className="size-8 group-data-[collapsible=icon]:opacity-0"
                  variant="outline"
                  onClick={() => {
                    setOpenMobile(false);
                    onOpenFile();
                  }}
                >
                  <FolderOpen aria-hidden />
                  <span className="sr-only">Open</span>
                </Button>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Documents</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {documents.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={section === item.section}
                    onClick={() => {
                      onNavigate(item.section);
                      setOpenMobile(false);
                    }}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {library.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={section === item.section}
                    onClick={() => {
                      onNavigate(item.section);
                      setOpenMobile(false);
                    }}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
