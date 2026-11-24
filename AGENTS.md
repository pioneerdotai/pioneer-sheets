# Pioneer Sheets

TanStack Start + Nitro, React, TypeScript, Univer open-source plugins, Yjs and PGlite via Drizzle. No Next.js patches or Express. Do not modify Pioneer host repositories.

All application code belongs in `src`: React features in `components`, browser transport in `client`, backend in `server`, platform-independent contracts and document models in `shared`. The old application-owned `sdk` directory is removed; the external Pioneer App SDK remains a dependency.

Database schemas live only in `src/server/db/schema`. Ordered SQL migrations and Drizzle metadata live only in `drizzle`; generate schema changes with Drizzle Kit and apply them through the standard migrator. Use Drizzle for application queries. Keep protocol and feature modules focused; do not add parallel implementations or compatibility directories for old source paths.

See `docs/ARCHITECTURE.md` for ownership and migration workflow. Verification must respect the user's current restrictions on tests, servers, checks and builds.
