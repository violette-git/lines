#!/usr/bin/env bash
# LOCAL TEST ONLY: runs the stubs, every migration and 40_account_test.sql on a throwaway Postgres.
# Same approach as run_local.sh, on its own port. Usage: bash supabase/tests/local/run_account_local.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d /tmp/linemap-acct-pg-XXXXXX)"
PORT="${PORT:-54331}"
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

echo "== stubs"; "${PSQL[@]}" -f "$HERE/00_supabase_stubs.sql"
for f in "$ROOT"/migrations/*.sql; do
  echo "== migration $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
echo "== account tests"
OUT="$WORK/account.out"
if ! "${PSQL[@]}" -f "$HERE/40_account_test.sql" >"$OUT" 2>&1; then
  cat "$OUT"; echo "ACCOUNT TESTS FAILED"; exit 1
fi
grep -c 'WARNING:  ok' "$OUT" | sed 's/^/checks passed: /'
grep -q 'ALL ACCOUNT TESTS PASSED' "$OUT" && echo "ALL ACCOUNT TESTS PASSED"
