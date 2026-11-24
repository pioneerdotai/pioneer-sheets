#!/usr/bin/env python3
"""Verify the portable package without starting Sheets or Pioneer."""

import hashlib
import json
import sys
from pathlib import Path


def require(ok, message):
    if not ok:
        raise SystemExit(message)


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


if len(sys.argv) > 1:
    root = Path(sys.argv[1]).resolve()
else:
    version = json.loads(Path("app.json").read_text())["version"]
    root = Path(f"dist/sheets-{version}").resolve()

manifest = json.loads((root / "app.json").read_text())
runtime = manifest["runtime"]
require(manifest["slug"] == "sheets" and runtime["environment"] == "node", "Wrong App manifest")
require(runtime["command"] == ["node", "/app/runtime/start.mjs"], "Wrong launcher")
require(not runtime.get("artifacts"), "Sheets uses a single package with no runtime artifacts")
require(not (root / "runtime-artifacts").exists(), "Unexpected runtime artifact directory")

config = json.loads((root / manifest["mcp"]["config"]).read_text())
require(
    config["mcpServers"]["pioneer-sheets"]
    == {"type": "pioneer", "url": "http://pioneer-app-runtime.internal/api/mcp"},
    "Wrong managed App MCP binding",
)

members = list(root.rglob("*"))
require(all(not path.is_symlink() for path in members), "Package symlinks are forbidden")
index = json.loads((root / "files.json").read_text())
expected = set()
for row in index:
    path = (root / row["path"]).resolve()
    require(path.is_relative_to(root), "Path escapes App")
    require(path.is_file(), f"Missing package member {row['path']}")
    require(
        digest(path) == row["sha256"] and path.stat().st_size == row["size"],
        f"Changed package file {row['path']}",
    )
    expected.add(row["path"])

files = [path for path in members if path.is_file()]
actual = {path.relative_to(root).as_posix() for path in files}
require(actual == expected | {"files.json"}, "Unexpected or absent package members")
require(not (root / "browser").exists(), "Browser must be provided by Gateway")
for name in (
    "runtime/start.mjs",
    ".output/server/index.mjs",
    ".agent/worker.mjs",
    ".agent/exchange-worker.mjs",
    "public/agent-api.json",
    "drizzle/0000_initial.sql",
    "drizzle/meta/_journal.json",
    "node_modules/quickjs-emscripten/package.json",
):
    require(name in actual, f"Missing runtime resource {name}")
for path in files:
    with path.open("rb") as file:
        magic = file.read(4)
    require(
        magic != b"\x7fELF" and path.suffix not in {".node", ".so", ".dylib", ".dll", ".exe"},
        f"Native binary in portable package: {path.relative_to(root)}",
    )

pglite_assets = ("pglite.wasm", "initdb.wasm", "pglite.data")
require(
    any(
        all((dist / name).is_file() for name in pglite_assets)
        for dist in root.glob("**/node_modules/@electric-sql/pglite/dist")
    ),
    "PGlite runtime assets absent",
)
require(not any(root.glob("**/node_modules/@libsql")), "libSQL is not a runtime dependency")

archive = Path(f"{root}.tar.gz")
receipt = json.loads(Path(f"{archive}.json").read_text())
require(receipt["sha256"] == digest(archive), "Archive SHA-256 mismatch")
print(json.dumps({
    "verified": True,
    "files": len(actual),
    "archiveBytes": receipt["archiveBytes"],
    "expandedBytes": receipt["expandedBytes"],
    "requiresGatewayLimitUpdate": receipt["requiresGatewayLimitUpdate"],
}))
