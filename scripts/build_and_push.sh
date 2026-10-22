#!/usr/bin/env bash
# Build the backend and frontend images LOCALLY and push them to GCR, so the
# production VM only ever does a `docker pull` + restart (scripts/deploy_remote.sh)
# instead of building on constrained VM resources. See docs/deploy.md.
#
# Usage:
#     ./scripts/build_and_push.sh              # tags with the current git short SHA + :latest
#     ./scripts/build_and_push.sh v1.2.3        # tags with v1.2.3 + :latest
#
# Requires: `gcloud auth configure-docker gcr.io` done once (already set up
# here - confirmed via ~/.docker/config.json).
#
# One image serves backend-remote, backend-remote-b, celery-worker-remote and
# celery-beat-remote (identical Dockerfile/context, they only differ by the
# `command:` docker-compose.yml gives each one) - so only two images total.
set -euo pipefail

GCR_PROJECT="${GCR_PROJECT:-enable-agents}"
TAG="${1:-$(git rev-parse --short HEAD)}"
PUBLIC_URL="${PUBLIC_URL:-https://agents.enableyou.co}"

cd "$(dirname "$0")/.."

echo "==> Building backend image (tag: $TAG) for linux/amd64"
docker buildx build --platform linux/amd64 \
  -t "gcr.io/$GCR_PROJECT/backend:$TAG" \
  -t "gcr.io/$GCR_PROJECT/backend:latest" \
  -f backend/Dockerfile backend/ --load

echo "==> Building frontend image (tag: $TAG) for linux/amd64 (REACT_APP_API_URL=$PUBLIC_URL baked in)"
docker buildx build --platform linux/amd64 \
  --build-arg "REACT_APP_API_URL=$PUBLIC_URL" \
  -t "gcr.io/$GCR_PROJECT/frontend:$TAG" \
  -t "gcr.io/$GCR_PROJECT/frontend:latest" \
  -f frontend/Dockerfile frontend/ --load

echo "==> Pushing to gcr.io/$GCR_PROJECT"
docker push "gcr.io/$GCR_PROJECT/backend:$TAG"
docker push "gcr.io/$GCR_PROJECT/backend:latest"
docker push "gcr.io/$GCR_PROJECT/frontend:$TAG"
docker push "gcr.io/$GCR_PROJECT/frontend:latest"

echo "==> Done:"
echo "    gcr.io/$GCR_PROJECT/backend:$TAG (and :latest)"
echo "    gcr.io/$GCR_PROJECT/frontend:$TAG (and :latest)"
echo "==> Next: ./scripts/deploy_remote.sh to pull these onto the VM and roll them out."
