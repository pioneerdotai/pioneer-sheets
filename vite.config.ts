import { defineConfig, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { createDevelopmentContext } from "./src/server/pioneer/development.ts";

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  const port = Number(process.env.PORT || 3713);
  if (command === "serve") {
    const context = await createDevelopmentContext();
    await context.close();
  }
  return {
    base: "./",
    optimizeDeps: { include: ["@pioneercompany/app-sdk/client"] },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem,key,p12,pfx,cer,der}",
          ".npmrc",
          ".yarnrc.yml",
          "**/.git/**",
          "**/credential.json",
          "**/credentials.json",
        ],
      },
    },
    resolve: {
      tsconfigPaths: true,
      alias: {
        "#sheets-authority": fileURLToPath(
          new URL(
            command === "serve"
              ? "./src/server/pioneer/development.ts"
              : "./src/server/pioneer/server.ts",
            import.meta.url,
          ),
        ),
      },
    },
    plugins: [
      tailwindcss(),
      {
        name: "sheets-dev-iframe",
        apply: "serve",
        enforce: "pre",
        configureServer(server) {
          // Nitro disables Vite's CORS middleware. Pioneer dev frames have an
          // opaque origin, so modules and API calls need the same origin grant.
          server.middlewares.use((req, res, next) => {
            if (req.headers.origin !== "null") return next();
            res.setHeader("Access-Control-Allow-Origin", "null");
            res.setHeader("Vary", "Origin");
            if (req.method === "OPTIONS") {
              res.setHeader(
                "Access-Control-Allow-Methods",
                "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS",
              );
              res.setHeader(
                "Access-Control-Allow-Headers",
                req.headers["access-control-request-headers"] || "Content-Type",
              );
              res.statusCode = 204;
              res.end();
            } else next();
          });
        },
      },
      tanstackStart(),
      nitro({
        serverDir: "src/server",
        features: { websocket: true },
        preset: "node-server",
        // PGlite resolves its WASM and database assets relative to its package.
        traceDeps: ["@electric-sql/pglite*"],
      }),
      react(),
    ],
    environments: command === "serve"
      ? { nitro: { resolve: { external: ["@pioneercompany/app-sdk/server"] } } }
      : undefined,
    ssr: { external: ["@electric-sql/pglite"] },
  };
});
