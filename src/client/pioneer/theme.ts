import { useEffect, useState } from "react";
import { getAppClient } from "./client";

/** The SDK retains and validates the host snapshot; this hook applies it to UI. */
export function usePioneerTheme(onError: (message: string) => void): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void getAppClient()
      .then((app) => {
        if (!active) return;
        unsubscribe = app.theme.subscribe((theme) => {
          const colors = theme.colors;
          const root = document.documentElement;
          const variables = {
            "--background": colors.background,
            "--foreground": colors.foreground,
            "--card": colors.popover,
            "--card-foreground": colors.popover_foreground,
            "--popover": colors.popover,
            "--popover-foreground": colors.popover_foreground,
            "--primary": colors.button_primary,
            "--primary-foreground": colors.button_primary_foreground,
            "--secondary": colors.button_secondary,
            "--secondary-foreground": colors.button_secondary_foreground,
            "--muted": colors.muted,
            "--muted-foreground": colors.muted_foreground,
            "--accent": colors.accent,
            "--accent-foreground": colors.accent_foreground,
            "--destructive": colors.danger,
            "--border": colors.border,
            "--input": colors.input,
            "--ring": colors.ring,
            "--chart-1": colors.chart_1,
            "--chart-2": colors.chart_2,
            "--chart-3": colors.chart_3,
            "--chart-4": colors.chart_4,
            "--chart-5": colors.chart_5,
            "--sidebar": colors.sidebar,
            "--sidebar-foreground": colors.sidebar_foreground,
            "--sidebar-primary": colors.sidebar_primary,
            "--sidebar-primary-foreground": colors.sidebar_primary_foreground,
            "--sidebar-accent": colors.sidebar_accent,
            "--sidebar-accent-foreground": colors.sidebar_accent_foreground,
            "--sidebar-border": colors.sidebar_border,
            "--sidebar-ring": colors.ring,
            "--overlay": colors.overlay,
            "--selection": colors.selection,
            "--caret": colors.caret,
            "--scrollbar": colors.scrollbar,
            "--scrollbar-thumb": colors.scrollbar_thumb,
            "--scrollbar-thumb-hover": colors.scrollbar_thumb_hover,
            "--font-mono": `${JSON.stringify(theme.mono_font_family)}, ui-monospace, monospace`,
            // Retain the existing editor container/presence integration.
            "--office-surface": colors.popover,
          };
          for (const [name, value] of Object.entries(variables))
            root.style.setProperty(name, value);
          root.style.colorScheme = theme.mode;
          root.classList.toggle("dark", theme.mode === "dark");
          // Apply colors before revealing controls, including portalled dialogs.
          setReady(true);
        });
      })
      .catch((error) => {
        if (active)
          onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [onError]);
  return ready;
}
