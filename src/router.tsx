import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const base =
    typeof document === "undefined"
      ? "/"
      : new URL(
          document.querySelector("base[href]")!.getAttribute("href")!,
          location.href,
        ).pathname;
  return createRouter({
    routeTree,
    scrollRestoration: false,
    rewrite: {
      input: ({ url }) => {
        if (base !== "/" && url.pathname.startsWith(base))
          url.pathname = "/" + url.pathname.slice(base.length);
        return url;
      },
      output: ({ url }) => {
        if (base !== "/") url.pathname = base + url.pathname.replace(/^\//, "");
        return url;
      },
    },
  });
}
