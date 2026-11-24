import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const Render = lazy(() => import("../components/rendering/agent-render"));

export const Route = createFileRoute("/agent-render")({
  ssr: false,
  component: () => (
    <Suspense fallback={<span>Preparing render engine…</span>}>
      <Render />
    </Suspense>
  ),
});
