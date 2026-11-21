#!/usr/bin/env bash
# Regenerates docs/erd.md (Mermaid) from the local database schema.
# Usage: pnpm db:erd   (requires the local stack: pnpm db:start)
set -euo pipefail
DB=$(docker ps --format '{{.Names}}' | grep -m1 supabase_db_)
q() { docker exec -i "$DB" psql -U postgres -d postgres -tA -F '|' -c "$1"; }

TABLES=$(q "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")
OUT=docs/erd.md
{
  echo "# Entity-relationship diagram"
  echo
  echo "Generated from the database by \`pnpm db:erd\` ($(date -u +%Y-%m-%d)). Do not edit by hand."
  echo "Every table has Row Level Security enabled; see \`supabase/migrations\` and \`docs/phase-3.md\`."
  echo
  echo '```mermaid'
  echo 'erDiagram'
  for t in $TABLES; do
    echo "  $t {"
    q "select c.data_type, c.column_name,
              case when exists (select 1 from information_schema.table_constraints tc
                                join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
                                where tc.table_schema='public' and tc.table_name=c.table_name and k.column_name=c.column_name and tc.constraint_type='PRIMARY KEY') then 'PK'
                   when exists (select 1 from information_schema.table_constraints tc
                                join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
                                where tc.table_schema='public' and tc.table_name=c.table_name and k.column_name=c.column_name and tc.constraint_type='FOREIGN KEY') then 'FK'
                   else '' end
       from information_schema.columns c
       where c.table_schema='public' and c.table_name='$t' order by c.ordinal_position" |
    while IFS='|' read -r type col key; do
      type=$(echo "$type" | sed -E 's/timestamp with time zone/timestamptz/; s/time without time zone/time/; s/character varying/varchar/; s/USER-DEFINED/enum/; s/ARRAY/array/; s/double precision/double/; s/ /_/g')
      echo "    $type $col${key:+ $key}"
    done
    echo "  }"
  done
  q "select tc.table_name, ccu.table_name, kcu.column_name
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
     join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and ccu.table_schema = 'public'
     order by 1, 3" |
  while IFS='|' read -r child parent col; do
    echo "  $parent ||--o{ $child : \"$col\""
  done
  echo '```'
  echo
  echo "Also in the database (not drawn): \`auth.users\` (referenced by profiles, user_roles, household_members and others),"
  echo "views \`site_settings_public\`, \`content_blocks_public\`, \`pages_public\`, \`organization_members\` and \`kitchen_order_lines\`."
} > "$OUT"
echo "wrote $OUT"
