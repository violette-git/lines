#!/usr/bin/env bash
# LOCAL TEST ONLY: validates supabase/migrations (including 0002_sync.sql) on a throwaway Postgres
# with PostGIS and the stub auth/storage schemas, then runs:
#   20_rls_test.sql   the Phase 1 security checks (must still pass with 0002 applied)
#   30_sync_test.sql  sync_push / sync_pull behaviour
#   a two-session check that a pull never skips a row whose transaction commits late
# Usage: bash supabase/tests/local/run_local_sync.sh   (PORT defaults to 54332)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d /tmp/linemap-sync-pg-XXXXXX)"
PORT="${PORT:-54332}"
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
echo "== rls tests";  "${PSQL[@]}" -o /dev/null -f "$HERE/20_rls_test.sql" 2>"$WORK/rls.out" || { cat "$WORK/rls.out"; exit 1; }
echo "   $(grep -c '^psql.*ok' "$WORK/rls.out") rls checks passed"
echo "== sync tests"; "${PSQL[@]}" -o /dev/null -f "$HERE/30_sync_test.sql" 2>"$WORK/sync.out" || { cat "$WORK/sync.out"; exit 1; }
echo "   $(grep -c '^psql.*ok' "$WORK/sync.out") sync checks passed"

# ---------------------------------------------------------------------------------------------
# Late commit check. Session A writes node X (taking the LOWER rev) and stays open; session B then
# writes node Y (HIGHER rev) and commits. A pull in between must return neither X nor Y (a rev-only
# cursor would hand out Y and later skip X). After A commits, the next pull returns both.
# ---------------------------------------------------------------------------------------------
echo "== late commit check"
Q() { "${PSQL[@]}" -At -c "$1"; }
ORG="$(Q "select id from public.organizations where name = 'Sync Test Co'")"
PRJ='5b000000-0000-4000-8000-0000000000b1'
SAM='5a000000-0000-4000-8000-000000000001'
TINA='5a000000-0000-4000-8000-000000000002'
X='5c000000-0000-4000-8000-0000000000a1'
Y='5c000000-0000-4000-8000-0000000000a2'
login() { echo "select set_config('request.jwt.claims', json_build_object('sub', '$1', 'role', 'authenticated')::text, false); set role authenticated;"; }
pull_sql() { echo "$(login "$TINA") select ts.pull_all('$ORG', '$1'::jsonb);"; }

CUR0="$("${PSQL[@]}" -At -c "$(pull_sql '{}')" | tail -1 | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["cursor"]))')"

"${PSQL[@]}" -At >/dev/null <<SQL &
$(login "$SAM")
begin;
select public.sync_push('$ORG', jsonb_build_object('nodes', jsonb_build_array(ts.node('$X', '$ORG', '$PRJ', 10, 'X', '2026-11-02T00:00:00Z'))));
select pg_sleep(4);
commit;
SQL
A_PID=$!
sleep 1.5
"${PSQL[@]}" -At >/dev/null -c "$(login "$SAM") select public.sync_push('$ORG', jsonb_build_object('nodes', jsonb_build_array(ts.node('$Y', '$ORG', '$PRJ', 11, 'Y', '2026-11-02T00:00:01Z'))));"
REV_X="$(Q "select rev from public.nodes where id = '$X'")"  # invisible yet: empty
REV_Y="$(Q "select rev from public.nodes where id = '$Y'")"
MID="$("${PSQL[@]}" -At -c "$(pull_sql "$CUR0")" | tail -1)"
wait $A_PID
REV_X="$(Q "select rev from public.nodes where id = '$X'")"
MID_CUR="$(echo "$MID" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["cursor"]))')"
END="$("${PSQL[@]}" -At -c "$(pull_sql "$MID_CUR")" | tail -1)"
python3 - "$MID" "$END" "$X" "$Y" "$REV_X" "$REV_Y" <<'PY'
import json, sys
mid, end, x, y, rx, ry = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6])
ids = lambda p: {r["id"] for r in p["rows"]["nodes"]}
assert rx < ry, f"setup: X should hold the lower rev ({rx} vs {ry})"
assert x not in ids(mid) and y not in ids(mid), f"pull during open transaction returned {ids(mid)}"
assert {x, y} <= ids(end), f"pull after commit missed rows: {ids(end)}"
print(f"   ok: rev {rx} committed after rev {ry}; held back while open, both delivered after commit")
PY

echo "ALL SYNC TESTS PASSED"
