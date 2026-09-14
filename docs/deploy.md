# Deployment Guide

## Infrastructure

- **GCP Project:** `enable-agents`
- **VM Instance:** `instance-20260419-210128` (us-east1-b)
- **VM Type:** e2-medium (2 vCPU, 4GB RAM, 4GB swap)
- **Domain:** enableyou.co
- **Live URL:** https://agents.enableyou.co/

## ⚠️ How the frontend is actually served (read this before deploying)

**Corrected 2026-09-14 - this was wrong/silently incomplete before.**
`docker-compose.yml`'s `frontend-remote`/`nginx` services are NOT what
serves `https://agents.enableyou.co/`. The site is served by a **host-level
nginx** (installed via apt, running outside Docker entirely - the
`docker-compose.yml` `nginx` service has been `Exited (128)` for 8+ weeks
and is unused) that serves the React build as **static files straight off
disk** at `/var/www/enable_agents`, per `root /var/www/enable_agents;` in
`/etc/nginx/sites-enabled/agents.conf`. Only the backend API is proxied to
a Docker container (`proxy_pass http://127.0.0.1:8000` → `backend-remote`).

**This means rebuilding/restarting `frontend-remote` has zero effect on
what users see.** Found 2026-09-14 because `/var/www/enable_agents` was
still dated Aug 7 - over a month of frontend work had been "deployed"
(container rebuilt, marked healthy) without ever reaching a real user,
silently, because nothing in the documented deploy flow copied the new
build there. **Every deploy must copy the fresh build into
`/var/www/enable_agents`** - see the step-by-step in Method 1 below. There
is no known reason `frontend-remote` needs to exist at all given this -
worth a real look at removing it (or wiring host nginx to proxy to it
instead of serving static files) rather than carrying two frontend serving
paths where only one is real.

## SSL/HTTPS

- HTTP automatically redirects to HTTPS (301)
- SSL certificates managed by Let's Encrypt (certbot)
- SSL termination happens in the **host-level nginx** described above, not
  inside Docker - `/etc/nginx/sites-enabled/agents.conf` holds the
  Certbot-managed `listen 443 ssl` block directly.

### GCP Firewall Rules Required

```bash
# Port 80 (HTTP - for redirect)
gcloud compute firewall-rules create allow-http --allow=tcp:80

# Port 443 (HTTPS)
gcloud compute firewall-rules create allow-https --allow=tcp:443
```

### Verify HTTPS

```bash
# Should return HTTP/2 200
curl -I https://agents.enableyou.co/

# Should return 301 redirect to HTTPS
curl -I http://agents.enableyou.co/
```

## Deployment Methods

### Method 1: Build on VM (Simple)

SSH into VM and rebuild containers:

```bash
# SSH into VM
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b

# Navigate to project
cd /home/rhishi/enable_agents

# Pull latest code
sudo git fetch origin && sudo git reset --hard origin/local-preview

# ⚠️ backend-remote, celery-worker-remote, and celery-beat-remote each
# build their OWN image from backend/Dockerfile - building one does NOT
# rebuild the others, even though they share a Dockerfile/context. Skipping
# any of the three leaves it on stale code. Caught 2026-09-14: rebuilding
# only backend-remote left celery-worker-remote on a 7-week-old image with
# none of that day's new Celery tasks, which then logged "Received
# unregistered task" and silently discarded every workflow-orchestration
# run/resume request until the two celery services were rebuilt too. If
# requirements.txt or the Dockerfile changed, run this every time:
sudo docker compose build backend-remote celery-worker-remote celery-beat-remote frontend-remote

# If a migration is pending, run it against the new image BEFORE cutting
# traffic over to it (a one-off container, doesn't touch the running one):
sudo docker compose run --rm backend-remote flask db upgrade

# Restart the backend/celery services with the new images (note the real
# service names - celery-worker-remote/celery-beat-remote, not
# celery-remote/beat-remote):
sudo docker compose up -d backend-remote celery-worker-remote celery-beat-remote

# ⚠️⚠️ REQUIRED, not optional - see "How the frontend is actually served"
# above. frontend-remote itself is NOT what users see. Copy the fresh
# React build out of the image and into the directory the host nginx
# actually serves from, replacing (not merging with) whatever's there:
sudo docker compose build frontend-remote
sudo docker create --name frontend_extract_tmp enable_agents-frontend-remote:latest
sudo rm -rf /var/www/enable_agents.bak && sudo mv /var/www/enable_agents /var/www/enable_agents.bak
sudo mkdir -p /var/www/enable_agents
sudo docker cp frontend_extract_tmp:/usr/share/nginx/html/. /var/www/enable_agents/
sudo docker rm frontend_extract_tmp
sudo chown -R www-data:www-data /var/www/enable_agents
sudo nginx -t && sudo systemctl reload nginx

# Verify the new build actually landed (Last-Modified should be ~now, not
# stale - this is the check that would have caught the 2026-08-07 staleness
# immediately instead of it silently persisting for weeks):
curl -sS -I https://agents.enableyou.co/ | grep -i last-modified

# Or rebuild backend/celery without cache (slower, use when Dockerfile
# itself changes, not just requirements.txt - normal `build` already busts
# the pip-install layer when requirements.txt's content changes):
sudo docker compose build --no-cache backend-remote celery-worker-remote celery-beat-remote
sudo docker compose up -d backend-remote celery-worker-remote celery-beat-remote
```

**After any deploy that touched backend code, verify the Celery workers
actually picked it up** - `docker compose up -d` recreating a container is
not proof its *image* changed:
```bash
sudo docker compose logs celery-worker-remote --tail=20
# Look for the [tasks] list including agents.workflow_orchestration.tasks.*
# (or whatever module you just added/changed) - if it's missing, that
# service's image wasn't rebuilt.
```

### Method 2: Build Locally, Push to GCR (Faster deploys)

**⚠️ Currently out of sync with docker-compose.yml, confirmed 2026-09-14 -
do not follow this as-is.** `backend-remote`/`frontend-remote` are defined
with `build: context: ./backend` (or `./frontend`), i.e. a local Dockerfile
build - not `image: gcr.io/...`. Pushing images to GCR the way this method
describes does NOT make `docker compose up -d` (or `up --build`) actually
use them - compose only reads GCR images for a service whose `image:` key
names that registry path, which none of these services have. Using this
method today would require first rewriting the relevant services'
`image:`/`build:` keys in docker-compose.yml to point at GCR, which hasn't
been done. Until that's fixed, use Method 1.

Build images on local machine, push to Google Container Registry:

```bash
# Configure Docker for GCR (one-time)
gcloud auth configure-docker gcr.io

# Build images locally
docker build -t gcr.io/enable-agents/backend:latest -f backend/Dockerfile backend/
docker build -t gcr.io/enable-agents/frontend:latest \
  --build-arg REACT_APP_API_URL=https://enableyou.co \
  -f frontend/Dockerfile frontend/

# Push to GCR
docker push gcr.io/enable-agents/backend:latest
docker push gcr.io/enable-agents/frontend:latest

# On VM: Pull and restart
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="
  sudo docker pull gcr.io/enable-agents/backend:latest && \
  sudo docker pull gcr.io/enable-agents/frontend:latest && \
  cd /home/rhishi/enable_agents && \
  sudo docker compose up -d
"
```

## Quick Deploy Commands

### From local machine:

```bash
# Pull latest, build with cache, restart - all 3 backend/Dockerfile-based
# services (backend-remote, celery-worker-remote, celery-beat-remote each
# build their own image despite sharing a Dockerfile - see Method 1's
# warning above), then any pending migration, then cut over. Frontend is
# handled separately below - the container by itself does not update what
# users see, see "How the frontend is actually served" above.
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="
  cd /home/rhishi/enable_agents && \
  sudo git fetch origin && sudo git reset --hard origin/local-preview && \
  sudo docker compose build backend-remote celery-worker-remote celery-beat-remote && \
  sudo docker compose run --rm backend-remote flask db upgrade && \
  sudo docker compose up -d backend-remote celery-worker-remote celery-beat-remote
"

# Frontend: build, extract, replace the static files the host nginx serves
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="
  cd /home/rhishi/enable_agents && \
  sudo docker compose build frontend-remote && \
  sudo docker create --name frontend_extract_tmp enable_agents-frontend-remote:latest && \
  sudo rm -rf /var/www/enable_agents.bak && \
  sudo mv /var/www/enable_agents /var/www/enable_agents.bak && \
  sudo mkdir -p /var/www/enable_agents && \
  sudo docker cp frontend_extract_tmp:/usr/share/nginx/html/. /var/www/enable_agents/ && \
  sudo docker rm frontend_extract_tmp && \
  sudo chown -R www-data:www-data /var/www/enable_agents && \
  sudo nginx -t && sudo systemctl reload nginx
"

# Verify the frontend build actually landed (should be ~now, not stale)
curl -sS -I https://agents.enableyou.co/ | grep -i last-modified
```

### Check status:

```bash
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="sudo docker ps"
```

### View logs:

```bash
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="sudo docker compose logs -f backend-remote"
```

## Services

| Service | Container | Port |
|---------|-----------|------|
| Backend API | enable_agents_backend_remote | 8000 |
| Frontend | enable_agents_frontend_remote | 80 (internal) |
| Nginx | enable_agents_nginx | 80, 443 |
| Celery Worker | enable_agents_celery_remote | - |
| Celery Beat | enable_agents_beat_remote | - |
| Redis | enable_agents_redis | 6379 |
| Postgres | enable_agents_postgres | 5432 |

## Troubleshooting

### VM freezes during build
- Added 4GB swap to prevent OOM
- Use `--no-cache` only when requirements.txt or Dockerfile changes
- Check memory: `free -h`
- Observed 2026-09-14: at idle this VM already runs ~2.4GB/3.8GB RAM and ~3.3GB/4GB swap used - very little headroom. A `requirements.txt` change forces the whole Python dependency layer (faiss, chromadb, numpy, etc.) to reinstall from scratch, which is memory-heavy. If that's what's changed, stop `celery-worker-remote`/`celery-beat-remote` first (not user-facing) to free RAM before building, then restart them after - keeps `backend-remote`/`frontend-remote` serving live traffic through the build.
- That mitigation was actually used 2026-09-14 (a `requirements.txt` change added langgraph/psycopg): stopping the two celery services freed only a modest amount of headroom (swap free went ~718MB → ~1GB; RAM used stayed ~2.4GB - most of the memory pressure here is Postgres/Redis/gunicorn, not the celery workers), but `docker compose build backend-remote` still completed cleanly in ~4.5 minutes with no OOM or thrashing. Worth doing before a heavy rebuild regardless, but this VM has more give than the raw `free -h` numbers alone suggest.

### Check swap status
```bash
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="free -h && sudo swapon --show"
```

### Restart all services
```bash
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="
  cd /home/rhishi/enable_agents && sudo docker compose down && sudo docker compose up -d
"
```

### HTTPS not working
1. Check GCP firewall rules allow port 443:
```bash
gcloud compute firewall-rules list --filter="allowed:tcp:443"
```
2. Check nginx container is running:
```bash
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="sudo docker ps | grep nginx"
```
3. Check SSL certificate exists:
```bash
gcloud compute ssh instance-20260419-210128 --zone=us-east1-b --command="sudo docker exec enable_agents_nginx ls -la /etc/letsencrypt/live/"
```

## Branches

- `main` - Production stable
- `staging` - Pre-production testing
- `local-preview` - Active development (deployed here as of 2026-09-14; `harsh-code` was the deploy branch before that but stopped being updated - confirmed a clean fast-forward ancestor of `local-preview`, not a divergent history)
