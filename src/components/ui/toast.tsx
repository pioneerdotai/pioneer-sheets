import type { ReactNode } from "react";
import { Toast } from "@base-ui/react/toast";
import { CircleCheck, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";

export const toast = Toast.createToastManager();

const icons = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: TriangleAlert,
  loading: Loader2,
};

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((item) => {
    const Icon = icons[item.type as keyof typeof icons];
    return (
      <Toast.Root
        key={item.id}
        toast={item}
        className="pointer-events-auto rounded-xl border bg-[var(--popover,var(--background))] text-[color:var(--popover-foreground,var(--foreground))] shadow-lg outline-none transition-[opacity,translate] focus-visible:ring-2 focus-visible:ring-ring data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:translate-y-2 data-ending-style:opacity-0"
      >
        <Toast.Content className="flex items-start gap-3 p-3">
          {Icon && (
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0",
                item.type === "loading" && "animate-spin",
                item.type === "error" && "text-destructive",
              )}
            />
          )}
          <div className="min-w-0 flex-1">
            <Toast.Title className="wrap-break-word text-sm font-medium" />
            <Toast.Description className="max-h-[40dvh] overflow-y-auto whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground" />
          </div>
          <Toast.Close
            aria-label="Dismiss notification"
            render={<Button variant="ghost" size="icon-sm" className="shrink-0" />}
          >
            <X />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toast}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="sheets-chrome pointer-events-none fixed right-4 bottom-4 left-4 z-[70] ml-auto grid max-w-sm gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
