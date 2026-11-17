#!/usr/bin/env bash
# Runs the Pipeline Events schema tests against a throwaway local Postgres.
# Requires PostgreSQL 15+ binaries (initdb, pg_ctl, psql) on PATH or in /usr/lib/postgresql/*/bin.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$HERE/../migrations/0001_pipeline_events.sql"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")"
WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-55432}"
RUN_AS=()
cleanup() { [ -f "$WORK/log" ] && [ "${KEEP_LOG:-}" ] && cat "$WORK/log"; "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$WORK" 2>/dev/null || { useradd -r postgres; chown -R postgres "$WORK"; }
  RUN_AS=(runuser -u postgres --)
fi

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c max_connections=200 -c listen_addresses=" -l "$WORK/log" start -w >/dev/null

export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$HERE/supabase_stub.sql" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
echo "✓ migration applied"

"${PSQL[@]}" -f "$HERE/functional.sql" | grep "^-- "
echo "✓ functional tests passed"

export PSQL_CMD="${PSQL[*]}"
bash "$HERE/concurrency.sh"
echo "✓ all database tests passed"
