import {
  createStartHandler,
  defaultStreamHandler,
  createServerEntry,
  getRequestHeader,
} from "@tanstack/react-start/server";

export default createServerEntry({
  fetch: createStartHandler({
    handler: defaultStreamHandler,
    transformAssets: {
      cache: false,
      transform: ({ url }) => ({
        href:
          (import.meta.env.DEV
            ? "/"
            : getRequestHeader("pioneer-app-base-path") || "./") +
          url.replace(/^\//, ""),
      }),
    },
  }),
});
