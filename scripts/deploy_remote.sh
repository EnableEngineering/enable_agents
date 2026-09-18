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
#      already-migrated database.
#   5. Starts the new backend + celery and WAITS for /ready (database
#      reachable AND schema at this build's revision). If it isn't ready
#      within the timeout: rolls back to the :previous images and exits 1.
#   6. Only then swaps the frontend static files and syncs the tracked host
#      nginx config (deploy/nginx/host-agents.enableyou.co.conf) - restoring
#      the previous config if `nginx -t` rejects the new one.
#
# What it can't do: there is one backend container on one small VM, so the
# few seconds while the new one starts are still a gap (much shorter with
# --preload, see backend/gunicorn_conf.py). The gate makes a *bad* build
# safe; it doesn't make a good one zero-downtime.
#
# Overrides: DEPLOY_INSTANCE, DEPLOY_ZONE, DEPLOY_READY_TIMEOUT (seconds).
set -euo pipefail

INSTANCE="${DEPLOY_INSTANCE:-instance-20260419-210128}"
ZONE="${DEPLOY_ZONE:-us-east1-b}"
READY_TIMEOUT="${DEPLOY_READY_TIMEOUT:-300}"

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

SERVICES="backend-remote celery-worker-remote celery-beat-remote"
LIVE_NGINX=/etc/nginx/sites-enabled/agents.conf

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
  echo "!! rolling back to the previous images"
  for svc in $SERVICES; do
    sudo docker image inspect "enable_agents-$svc:previous" >/dev/null 2>&1 \
      && sudo docker tag "enable_agents-$svc:previous" "enable_agents-$svc:latest" || true
  done
  sudo docker compose up -d --force-recreate $SERVICES
  sudo git reset -q --hard "$PREV_FULL"
  echo "!! rolled back to $(sudo git rev-parse --short HEAD); investigate with: sudo docker compose logs backend-remote"
  exit 1
}

echo "==> stopping celery (free RAM for the build)"
sudo docker compose stop celery-worker-remote celery-beat-remote >/dev/null

echo "==> building images"
sudo docker compose build $SERVICES frontend-remote

echo "==> running migrations against the new image"
# -T and </dev/null: without them `docker compose run` reads the rest of THIS
# script from stdin (it arrives via `bash -s`) and the deploy silently stops
# right after the migration.
if ! MIGRATION_OUTPUT="$(sudo docker compose run --rm -T backend-remote flask db upgrade 2>&1 </dev/null)"; then
  echo "$MIGRATION_OUTPUT" | tail -25
  rollback "database migration failed"
fi
echo "$MIGRATION_OUTPUT" | grep -E "Running upgrade" || echo "    (no pending migrations)"

echo "==> starting new backend + celery"
sudo docker compose up -d $SERVICES

echo "==> waiting up to ${READY_TIMEOUT}s for /ready"
deadline=$((SECONDS + READY_TIMEOUT))
until sudo docker exec enable_agents_backend_remote curl -fsS -m 5 http://127.0.0.1:8000/ready >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    rollback "new backend was not ready within ${READY_TIMEOUT}s"
  fi
  sleep 3
done
echo "    ready after $((SECONDS)) s"

echo "==> swapping frontend static files"
sudo docker create --name frontend_extract_tmp enable_agents-frontend-remote:latest >/dev/null
sudo rm -rf /var/www/enable_agents.bak
sudo mv /var/www/enable_agents /var/www/enable_agents.bak
sudo mkdir -p /var/www/enable_agents
sudo docker cp frontend_extract_tmp:/usr/share/nginx/html/. /var/www/enable_agents/
sudo docker rm frontend_extract_tmp >/dev/null
sudo chown -R www-data:www-data /var/www/enable_agents

REPO_NGINX=deploy/nginx/host-agents.enableyou.co.conf
if ! sudo cmp -s "$REPO_NGINX" "$LIVE_NGINX"; then
  echo "==> host nginx config differs from the tracked one - syncing (backup kept)"
  sudo cp "$LIVE_NGINX" /tmp/agents.conf.predeploy
  sudo cp "$REPO_NGINX" "$LIVE_NGINX"
  if ! sudo nginx -t 2>&1 | tail -2; then
    echo "!! new nginx config rejected - restoring the previous one"
    sudo cp /tmp/agents.conf.predeploy "$LIVE_NGINX"
  fi
fi
sudo nginx -t 2>&1 | tail -1
sudo systemctl reload nginx

echo "==> verifying through nginx"
curl -fsS -m 15 https://agents.enableyou.co/health >/dev/null && echo "    /health ok"
curl -fsS -m 15 https://agents.enableyou.co/ready >/dev/null && echo "    /ready ok" || echo "    (/ready not routed by nginx yet - inside-VM check above already passed)"
echo "==> DEPLOY OK: $(sudo git rev-parse --short HEAD)"
REMOTE
ENCODED="$(printf '%s' "$REMOTE_SCRIPT" | base64 | tr -d '\n')"
gcloud compute ssh "$INSTANCE" --zone="$ZONE" \
  --command="echo $ENCODED | base64 -d > /tmp/deploy_remote_steps.sh && READY_TIMEOUT=$READY_TIMEOUT bash /tmp/deploy_remote_steps.sh"
