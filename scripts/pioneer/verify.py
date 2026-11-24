#!/usr/bin/env python3
"""Verify the portable package without starting Sheets or Pioneer."""

import hashlib
import json
import sys
import tarfile
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
require(runtime["cwd"] == "runtime", "Wrong runtime directory")
require(runtime["command"] == ["node", "/app/runtime/packaging/start.mjs"], "Wrong launcher")
require(not runtime.get("artifacts"), "Sheets uses a single package with no runtime artifacts")
require(not (root / "runtime-artifacts").exists(), "Unexpected runtime artifact directory")
require(
    {entry.name for entry in root.iterdir()}
    == {"app.json", manifest["mcp"]["config"], manifest["skills"], "assets", runtime["cwd"]},
    "Package has entries outside the paths selected by Pioneer",
)

config = json.loads((root / manifest["mcp"]["config"]).read_text())
require(
    config["mcpServers"]["pioneer-sheets"]
    == {"type": "pioneer", "url": "http://pioneer-app-runtime.internal/api/mcp"},
    "Wrong managed App MCP binding",
)

members = list(root.rglob("*"))
require(all(not path.is_symlink() for path in members), "Package symlinks are forbidden")
index_path = "runtime/files.json"
index = json.loads((root / index_path).read_text())
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
require(actual == expected | {index_path}, "Unexpected or absent package members")
require(not (root / "runtime/browser").exists(), "Browser must be provided by Gateway")
for name in (
    "packaging/start.mjs",
    ".output/server/index.mjs",
    ".agent/worker.mjs",
    ".agent/exchange-worker.mjs",
    "public/agent-api.json",
    "drizzle/0000_initial.sql",
    "drizzle/meta/_journal.json",
    "node_modules/quickjs-emscripten-core/package.json",
    "node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm",
):
    require(f"runtime/{name}" in actual, f"Missing runtime resource {name}")

worker_modules = root / "runtime/node_modules"
require(
    {entry.relative_to(worker_modules).as_posix() for entry in worker_modules.rglob("package.json")}
    == {
        "quickjs-emscripten-core/package.json",
        "@jitl/quickjs-ffi-types/package.json",
        "@jitl/quickjs-wasmfile-release-sync/package.json",
    },
    "Unexpected QuickJS worker dependencies",
)
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
with tarfile.open(archive, "r:gz") as payload:
    seen = set()
    for member in payload:
        require(member.name not in seen, f"Duplicate archive entry: {member.name}")
        seen.add(member.name)
        require(member.isdir() or member.isfile(), f"Unsupported archive entry: {member.name}")
    require(
        seen == {root.name} | {path.relative_to(root.parent).as_posix() for path in members},
        "Archive entries differ from the staged package",
    )
print(json.dumps({
    "verified": True,
    "files": len(actual),
    "archiveBytes": receipt["archiveBytes"],
    "expandedBytes": receipt["expandedBytes"],
    "requiresGatewayLimitUpdate": receipt["requiresGatewayLimitUpdate"],
}))
