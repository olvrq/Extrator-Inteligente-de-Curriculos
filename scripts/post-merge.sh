#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

required_files=(
  ".replit"
  "index.html"
  "styles.css"
  "app.js"
  "resume-parser.mjs"
  "document-extractor.mjs"
  "favicon.svg"
)

for file in "${required_files[@]}"; do
  if [[ ! -s "$file" ]]; then
    printf 'Post-merge setup: required file missing or empty: %s\n' "$file" >&2
    exit 1
  fi
done

node --check resume-parser.mjs
node --check document-extractor.mjs
node --input-type=module --check < app.js

printf 'Post-merge setup checks passed.\n'
