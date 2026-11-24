import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Spinner } from "../components/ui/spinner";

const Workspace = lazy(() => import("../components/workspace/index"));

export const Route = createFileRoute("/")({
  ssr: false,
  component: () => (
    <Suspense
      fallback={
        <main
          className="sheets-chrome flex h-dvh items-center justify-center gap-3 overflow-hidden p-6"
          role="status"
        >
          <Spinner aria-hidden />
          Loading Sheets…
        </main>
      }
    >
      <Workspace />
    </Suspense>
  ),
});
