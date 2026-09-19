#!/usr/bin/env bash
# Take a backend out of (or put it back into) host nginx's rotation by adding /
# removing `down` on its `server` line in the upstream block. Edits the file
# only; the caller runs `nginx -t` and reloads (a graceful reload: in-flight
# requests finish). Used by scripts/deploy_remote.sh to drain a backend before
# restarting it, and by scripts/test_nginx_failover.sh.
#     nginx_backend_state.sh <nginx-conf> <port|all> <down|up>
set -euo pipefail
conf="${1:?nginx conf path}"; port="${2:?port or all}"; state="${3:?down|up}"
case "$state" in down|up) ;; *) echo "state must be down or up" >&2; exit 2 ;; esac
if [ "$port" = "all" ]; then ports="8000 8001"; else ports="$port"; fi
for p in $ports; do
  sed -E -i.bak "s#(server [^ ;]+:${p}) down#\1#" "$conf"                       # always start from "up" (idempotent)
  if [ "$state" = "down" ]; then
    sed -E -i.bak "s#(server [^ ;]+:${p})( |;)#\1 down\2#" "$conf"
  fi
done
rm -f "$conf.bak"
