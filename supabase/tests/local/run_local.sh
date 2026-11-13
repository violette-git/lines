#!/usr/bin/env bash
# LOCAL TEST ONLY: validates supabase/migrations + seed on a throwaway plain Postgres (+ PostGIS),
# using stub auth/storage schemas. Needs postgres 15+ binaries and postgis installed.
# Usage: bash supabase/tests/local/run_local.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d /tmp/linemap-pg-XXXXXX)"
PORT="${PORT:-54329}"
RUNAS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  RUNAS=(runuser -u postgres --)
fi

cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

echo "== stubs";      "${PSQL[@]}" -f "$HERE/00_supabase_stubs.sql"
for f in "$ROOT"/migrations/*.sql; do
  echo "== migration $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
echo "== seed";       "${PSQL[@]}" -f "$ROOT/seed.sql"
echo "== rls tests";  "${PSQL[@]}" -o /dev/null -f "$HERE/20_rls_test.sql"
