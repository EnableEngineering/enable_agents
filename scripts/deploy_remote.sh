#!/usr/bin/env bash
# Deploy origin/local-preview to the production VM - with a readiness gate
# and automatic rollback. Run from your machine:
#
#     ./scripts/deploy_remote.sh
#
# What it does (all on the VM, over gcloud ssh):
#   1. Fast-forwards the VM checkout to origin/local-preview.
#   2. Tags the currently-running backend/celery images :previous, so a bad
#      build can be undone without rebuilding anything.
#   3. Stops celery (frees RAM - the VM is 4GB), builds all four images
#      (backend-remote, celery-worker-remote and celery-beat-remote each build
#      their OWN image from backend/Dockerfile; skipping one leaves it stale).
#   4. Runs `flask db upgrade` against the new image BEFORE cutting traffic
#      over. Migrations must therefore be additive/backward compatible: if the
#      new build is rolled back, the OLD code has to keep working against the
#      already-migrated database (and, during step 5, the old and new backends
#      briefly serve side by side).
#   5. Restarts the backends ROLLING - backend-remote-b (:8001) first, then
#      backend-remote (:8000) - and WAITS for /ready (database reachable AND
#      schema at this build's revision) after each. Host nginx load-balances
#      across both ports and fails over, so one instance is always serving.
#      If either isn't ready within the timeout: rolls back to the :previous
#      images and exits 1. Celery is started once the backends are up.
#   6. Only then swaps the frontend static files and syncs the tracked host
#      nginx config (deploy/nginx/host-agents.enableyou.co.conf) - restoring
#      the previous config if `nginx -t` rejects the new one. (The nginx
#      config is also synced BEFORE the second backend restarts, so the very
#      first rolling deploy already has the failover in place.)
#
# Rolling mode needs RAM for a second backend (~0.6GB): if backend-remote-b
# isn't running yet and the VM has less than DEPLOY_MIN_FREE_MB available, or
# DEPLOY_ROLLING=0, it falls back to the old single-instance restart (a gap of
# a few seconds, much shorter with --preload - see backend/gunicorn_conf.py).
#
# Overrides: DEPLOY_INSTANCE, DEPLOY_ZONE, DEPLOY_READY_TIMEOUT (seconds),
# DEPLOY_ROLLING (1|0), DEPLOY_MIN_FREE_MB.
set -euo pipefail

INSTANCE="${DEPLOY_INSTANCE:-instance-20260419-210128}"
ZONE="${DEPLOY_ZONE:-us-east1-b}"
READY_TIMEOUT="${DEPLOY_READY_TIMEOUT:-300}"
ROLLING="${DEPLOY_ROLLING:-1}"
MIN_FREE_MB="${DEPLOY_MIN_FREE_MB:-900}"

# Warn if the commit you have checked out isn't what's about to ship.
git fetch -q origin local-preview 2>/dev/null || true
AHEAD="$(git rev-list --count origin/local-preview..HEAD 2>/dev/null || echo 0)"
if [ "$AHEAD" != "0" ]; then
  echo "WARNING: your local HEAD is $AHEAD commit(s) ahead of origin/local-preview." >&2
  echo "         The VM deploys origin/local-preview - push first if you want those shipped." >&2
fi

# The remote steps are shipped to the VM as a FILE (base64 in --command), not
# piped to `bash -s`: when the script arrives on stdin, any command that reads
# stdin (docker compose run without -T did) silently swallows the rest of it
# and the deploy just stops.
# (read -d '' rather than $(cat <<EOF): macOS's bash 3.2 mis-parses apostrophes
# inside a heredoc nested in $( ).)
IFS= read -r -d '' REMOTE_SCRIPT <<'REMOTE' || true
set -euo pipefail
cd /home/rhishi/enable_agents
READY_TIMEOUT="${READY_TIMEOUT:-300}"
ROLLING="${ROLLING:-1}"
MIN_FREE_MB="${MIN_FREE_MB:-900}"
TOUCHED=""   # backends this run has already replaced (only those need undoing)

SERVICES="backend-remote backend-remote-b celery-worker-remote celery-beat-remote"
LIVE_NGINX=/etc/nginx/sites-enabled/agents.conf
REPO_NGINX=deploy/nginx/host-agents.enableyou.co.conf

sudo git fetch -q origin
PREV_FULL="$(sudo git rev-parse HEAD)"
sudo git reset -q --hard origin/local-preview
echo "==> deploying $(sudo git rev-parse --short "$PREV_FULL") -> $(sudo git rev-parse --short HEAD)"

# "previous" = the image each service's container is running RIGHT NOW - not
# whatever :latest points at. If an earlier run of this script stopped part-way
# (after building, before cut-over), :latest is already the new build and
# tagging from it would overwrite the rollback target with the very thing we
# might need to roll back from.
echo "==> tagging the running images :previous"
for svc in $SERVICES; do
  cid="$(sudo docker compose ps -a -q "$svc" | head -1)"
  if [ -n "$cid" ]; then
    sudo docker tag "$(sudo docker inspect --format '{{.Image}}' "$cid")" "enable_agents-$svc:previous" || true
  fi
done

rollback() {
  echo "!! $1"
  # A backend may be mid-drain: put everything back in rotation FIRST.
  sudo bash scripts/nginx_backend_state.sh "$LIVE_NGINX" all up 2>/dev/null && sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx || true
  echo "!! rolling back to the previous images"
  RESTORE=""
  for svc in $SERVICES; do
    if sudo docker image inspect "enable_agents-$svc:previous" >/dev/null 2>&1; then
      sudo docker tag "enable_agents-$svc:previous" "enable_agents-$svc:latest" || true
      RESTORE="$RESTORE $svc"
    fi
  done
  # A second backend that did not exist before this deploy has nothing to go
  # back to: stop it, the first backend keeps serving.
  sudo docker image inspect enable_agents-backend-remote-b:previous >/dev/null 2>&1 \
    || sudo docker compose stop backend-remote-b >/dev/null 2>&1 || true
  for svc in $RESTORE; do
    case "$svc" in
      backend-remote|backend-remote-b)
        case " $TOUCHED " in *" $svc "*) ;; *) continue ;; esac ;;   # never replaced: still the old build
    esac
    sudo docker compose up -d --no-deps --force-recreate "$svc" || true
  done
  sudo git reset -q --hard "$PREV_FULL"
  echo "!! rolled back to $(sudo git rev-parse --short HEAD); investigate with: sudo docker compose logs backend-remote"
  exit 1
}

wait_ready() {  # $1 = container name
  local deadline=$((SECONDS + READY_TIMEOUT))
  until sudo docker exec "$1" curl -fsS -m 5 http://127.0.0.1:8000/ready >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then return 1; fi
    sleep 3
  done
}

# Copy the tracked host nginx config into place (keeping a backup) and reload,
# restoring the old one if `nginx -t` rejects the new. No-op when identical.
sync_nginx() {
  if ! sudo cmp -s "$REPO_NGINX" "$LIVE_NGINX"; then
    echo "==> host nginx config differs from the tracked one - syncing (backup kept)"
    sudo cp "$LIVE_NGINX" /tmp/agents.conf.predeploy
    sudo cp "$REPO_NGINX" "$LIVE_NGINX"
    if ! sudo nginx -t 2>&1 | tail -2; then
      echo "!! new nginx config rejected - restoring the previous one"
      sudo cp /tmp/agents.conf.predeploy "$LIVE_NGINX"
      return 1
    fi
    sudo systemctl reload nginx
  fi
}

# Take a backend out of nginx's rotation (state=down) or put it back (state=up),
# with a graceful reload. Draining BEFORE a restart means no request is sent to
# a backend that is about to stop or is still starting - which matters for POSTs,
# because nginx can't safely retry one that was already sent.
drain() {  # $1 = port (8000|8001|all), $2 = down|up
  sudo bash scripts/nginx_backend_state.sh "$LIVE_NGINX" "$1" "$2"
  if ! sudo nginx -t >/dev/null 2>&1; then
    echo "!! nginx rejected the edited config - restoring the tracked one"
    sudo cp "$REPO_NGINX" "$LIVE_NGINX"
    return 1
  fi
  sudo systemctl reload nginx
}

echo "==> stopping celery (free RAM for the build)"
sudo docker compose stop celery-worker-remote celery-beat-remote >/dev/null

echo "==> building images"
sudo docker compose build backend-remote backend-remote-b celery-worker-remote celery-beat-remote frontend-remote

echo "==> running migrations against the new image"
# -T and </dev/null: without them `docker compose run` reads the rest of THIS
# script from stdin (it arrives via `bash -s`) and the deploy silently stops
# right after the migration.
if ! MIGRATION_OUTPUT="$(sudo docker compose run --rm -T backend-remote flask db upgrade 2>&1 </dev/null)"; then
  echo "$MIGRATION_OUTPUT" | tail -25
  rollback "database migration failed"
fi
echo "$MIGRATION_OUTPUT" | grep -E "Running upgrade" || echo "    (no pending migrations)"

B_RUNNING="$(sudo docker ps -q -f name='^enable_agents_backend_remote_b$' | head -1)"
FREE_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
MODE=single
if [ "$ROLLING" = "1" ]; then
  if [ -n "$B_RUNNING" ] || [ "$FREE_MB" -ge "$MIN_FREE_MB" ]; then
    MODE=rolling
  else
    echo "    (only ${FREE_MB}MB free, need ${MIN_FREE_MB}MB for a second backend - falling back to a single restart)"
  fi
fi

if [ "$MODE" = "rolling" ]; then
  echo "==> rolling restart (${FREE_MB}MB free): backend-remote-b, then backend-remote"
  # nginx needs the two-backend upstream BEFORE either one is drained.
  if sync_nginx && grep -q "upstream enable_agents_backend" "$LIVE_NGINX"; then
    CAN_DRAIN=1
  else
    CAN_DRAIN=0
    echo "!! the two-backend nginx config is not in place - restarting without draining (expect a short gap)"
  fi

  roll() {  # $1 = service, $2 = container, $3 = host port
    [ "$CAN_DRAIN" = "1" ] && drain "$3" down && sleep 5   # let in-flight requests on it finish
    TOUCHED="$TOUCHED $1"
    sudo docker compose up -d --no-deps --force-recreate "$1"
    wait_ready "$2" || rollback "$1 was not ready within ${READY_TIMEOUT}s"
    echo "    $1 ready"
    [ "$CAN_DRAIN" = "1" ] && drain "$3" up
    return 0
  }
  roll backend-remote-b enable_agents_backend_remote_b 8001
  roll backend-remote enable_agents_backend_remote 8000
else
  echo "==> restarting the single backend"
  sudo docker compose stop backend-remote-b >/dev/null 2>&1 || true
  TOUCHED="$TOUCHED backend-remote"
  sudo docker compose up -d --no-deps --force-recreate backend-remote
  wait_ready enable_agents_backend_remote || rollback "new backend was not ready within ${READY_TIMEOUT}s"
  echo "    backend-remote ready"
fi

echo "==> starting celery"
sudo docker compose up -d celery-worker-remote celery-beat-remote

echo "==> swapping frontend static files"
sudo docker create --name frontend_extract_tmp enable_agents-frontend-remote:latest >/dev/null
sudo rm -rf /var/www/enable_agents.bak
sudo mv /var/www/enable_agents /var/www/enable_agents.bak
sudo mkdir -p /var/www/enable_agents
sudo docker cp frontend_extract_tmp:/usr/share/nginx/html/. /var/www/enable_agents/
sudo docker rm frontend_extract_tmp >/dev/null
sudo chown -R www-data:www-data /var/www/enable_agents

sync_nginx || true
sudo nginx -t 2>&1 | tail -1
sudo systemctl reload nginx

echo "==> verifying through nginx"
curl -fsS -m 15 https://agents.enableyou.co/health >/dev/null && echo "    /health ok"
curl -fsS -m 15 https://agents.enableyou.co/ready >/dev/null && echo "    /ready ok" || echo "    (/ready not routed by nginx yet - inside-VM check above already passed)"
echo "==> DEPLOY OK: $(sudo git rev-parse --short HEAD)"
REMOTE
ENCODED="$(printf '%s' "$REMOTE_SCRIPT" | base64 | tr -d '\n')"
gcloud compute ssh "$INSTANCE" --zone="$ZONE" \
  --command="echo $ENCODED | base64 -d > /tmp/deploy_remote_steps.sh && READY_TIMEOUT=$READY_TIMEOUT ROLLING=$ROLLING MIN_FREE_MB=$MIN_FREE_MB bash /tmp/deploy_remote_steps.sh"
