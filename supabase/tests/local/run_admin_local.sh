#!/usr/bin/env bash
# LOCAL TEST ONLY: runs every migration on a throwaway Postgres (+ PostGIS) with the Supabase stubs,
# then the dashboard function tests (30_admin_test.sql). Same approach as run_local.sh.
# Usage: bash supabase/tests/local/run_admin_local.sh   (PORT=54333 by default)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d /tmp/linemap-admin-pg-XXXXXX)"
PORT="${PORT:-54333}"
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
echo "== admin tests"
if "${PSQL[@]}" -o /dev/null -f "$HERE/30_admin_test.sql" 2>"$WORK/admin.err"; then
  echo "$(grep -c 'WARNING:  ok' "$WORK/admin.err") checks passed"
  echo "ALL ADMIN TESTS PASSED"
else
  grep -v 'WARNING:  ok' "$WORK/admin.err" >&2
  exit 1
fi
