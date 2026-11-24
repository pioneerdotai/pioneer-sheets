import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import {
  createRootRoute,
  HeadContent,
  Scripts,
  Outlet,
} from "@tanstack/react-router";
import "../styles.css";
import { Toaster } from "../components/ui/toast";
import { appConfig } from "../app-config";

const getBase = createIsomorphicFn()
  .server(() => {
    if (import.meta.env.DEV) return "/";
    const base = getRequestHeader("pioneer-app-base-path") || "./index";
    return /^(?:\.\/|(?:\.\.\/)+)$/.test(base) ? base : "./index";
  })
  .client(
    () =>
      document.querySelector("base[href]")?.getAttribute("href") || "./index",
  );

export const Route = createRootRoute({
  loader: () => ({ base: getBase() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: appConfig.name },
    ],
  }),
  component: Root,
});

function Root() {
  const { base } = Route.useLoaderData();
  return (
    <html lang="en">
      <head>
        <base href={base} />
        <HeadContent />
      </head>
      <body>
        <Toaster>
          <Outlet />
        </Toaster>
        <Scripts />
      </body>
    </html>
  );
}
