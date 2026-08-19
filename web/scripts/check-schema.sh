#!/usr/bin/env bash
# Check that schema/*.json is in sync with the zod schemas in schema.ts.
# Run by pre-commit hook "check-schema" and by CI.
# Exits non-zero if generated schemas differ from what's committed.
set -euo pipefail

cd "$(dirname "$0")/.." # -> web/

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

pnpm run gen:schema "$tmpdir" > /dev/null

if ! diff -r ../schema/ "$tmpdir/" > /dev/null; then
  echo "schema/ is stale — run: cd web && pnpm run gen:schema"
  diff -r --color=always ../schema/ "$tmpdir/" || true
  exit 1
fi
