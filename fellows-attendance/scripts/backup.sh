#!/usr/bin/env bash
# Full database backup (roles + schema + data) to dated files, following
# Supabase's official guide: supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
# Needs: Node.js, Docker running, and your connection string from
#   Supabase → project → Connect → "Session pooler" URI (contains your DB password).
# Usage:  SUPABASE_DB_URL='postgresql://...' ./scripts/backup.sh
# Keep the files private: they contain everyone's attendance records.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the project connection string}"
dir="backups/$(date +%Y-%m-%d-%H%M)"
mkdir -p "$dir"
npx supabase db dump --remote="$SUPABASE_DB_URL" -f "$dir/roles.sql" --role-only
npx supabase db dump --remote="$SUPABASE_DB_URL" -f "$dir/schema.sql"
npx supabase db dump --remote="$SUPABASE_DB_URL" -f "$dir/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
echo "Saved $dir/{roles,schema,data}.sql"
echo "Portrait image files are NOT inside these files. Download the 'portraits' bucket in Supabase → Storage separately."
