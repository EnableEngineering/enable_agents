#!/usr/bin/env bash
# Prove the host nginx config (deploy/nginx/host-agents.enableyou.co.conf) keeps
# serving while its backends are restarted: the REAL config (only certbot's TLS
# lines stripped) is loaded into an nginx container and two stand-in backends
# join that container's network namespace - so nginx reaches them on
# 127.0.0.1:8000 / :8001 exactly as on the VM. GET + POST traffic runs
# continuously while each backend is drained (scripts/nginx_backend_state.sh),
# stopped, started and restored - the deploy protocol, which must lose nothing -
# and then simply killed, which is only reported.
# Needs docker; pulls nginx:alpine and python:3-alpine.
#     ./scripts/test_nginx_failover.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/e2e/nginx_failover"
cleanup() { docker rm -f enable_nx enable_b1 enable_b2 >/dev/null 2>&1 || true; [ -z "${WORK:-}" ] || rm -rf "$WORK"; }
trap cleanup EXIT
cleanup
WORK="$(mktemp -d)"

python3 - "$ROOT/deploy/nginx/host-agents.enableyou.co.conf" "$WORK/site.conf" << 'PY'
import sys
src, out = sys.argv[1:3]
s = open(src).read()
s = s[:s.index("    listen 443 ssl;")] + "    listen 80 default_server;\n}\n"   # drop certbot's TLS block + the redirect server
open(out, "w").write(s)
PY

docker run -d --name enable_nx -p 18080:80 -v "$WORK:/etc/nginx/conf.d:ro" \
  -v "$DIR/www:/var/www/enable_agents:ro" nginx:alpine >/dev/null
for n in 1 2; do
  docker run -d --name "enable_b$n" --network container:enable_nx -e "NAME=b$n" -e "PORT=800$((n-1))" \
    --entrypoint python -v "$DIR/backend.py:/b.py:ro" python:3-alpine /b.py >/dev/null
done
sleep 2
docker exec enable_nx nginx -t
SITE_CONF="$WORK/site.conf" STATE_SH="$ROOT/scripts/nginx_backend_state.sh" \
  NX=enable_nx B1=enable_b1 B2=enable_b2 python3 "$DIR/failover_test.py"
