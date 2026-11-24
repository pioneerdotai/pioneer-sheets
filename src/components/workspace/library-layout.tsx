import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { type PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../ui/resizable";
import { useSidebar } from "../ui/sidebar";

// Sheets navigation width: start at the minimum and allow up to 320 px.
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 260;
const MAX_WIDTH = 320;

export function LibraryLayout({
  sidebar,
  children,
  width,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  width: RefObject<number | null>;
}) {
  const { open, isMobile } = useSidebar();
  const panel = useRef<PanelImperativeHandle | null>(null);
  const initialWidth = useRef(width.current ?? DEFAULT_WIDTH);
  const expandedWidth = width.current ?? DEFAULT_WIDTH;

  useEffect(() => {
    if (isMobile) return;
    // The group registers updated pixel constraints after its panels render.
    // Restore the width captured before those constraints clamp the layout.
    const frame = requestAnimationFrame(() =>
      panel.current?.resize(open ? expandedWidth : 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, isMobile, expandedWidth]);

  if (isMobile)
    return (
      <>
        {sidebar}
        {children}
      </>
    );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 min-w-0 flex-1"
    >
      <ResizablePanel
        id="library-sidebar"
        panelRef={panel}
        defaultSize={initialWidth.current}
        minSize={open ? MIN_WIDTH : 0}
        maxSize={open ? MAX_WIDTH : 0}
        groupResizeBehavior="preserve-pixel-size"
        inert={!open}
        aria-hidden={!open}
        onResize={({ inPixels }, _id, previous) => {
          // Reopening first applies the minimum width; retain the user's width
          // until the visibility effect restores it from the collapsed state.
          if (
            open &&
            previous &&
            previous.inPixels > 0 &&
            inPixels >= MIN_WIDTH
          )
            width.current = Math.min(MAX_WIDTH, inPixels);
        }}
      >
        {sidebar}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize navigation sidebar"
        disabled={!open}
        hidden={!open}
      />
      <ResizablePanel id="library-content" className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
