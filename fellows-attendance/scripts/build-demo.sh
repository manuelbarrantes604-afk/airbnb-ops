#!/usr/bin/env bash
# Builds a static, fictional-data DEMO into ./out (no database, no sign-in).
# The server-only invite route can't be part of a static export, so it is
# moved aside for the duration of the build and always restored.
set -euo pipefail
cd "$(dirname "$0")/.."
mv src/app/api /tmp/fa-api-aside
trap 'mv /tmp/fa-api-aside src/app/api' EXIT
rm -rf out
DEMO_EXPORT=1 NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= npx next build
echo "Demo written to ./out"
