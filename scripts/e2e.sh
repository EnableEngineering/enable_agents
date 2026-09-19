#!/usr/bin/env bash
# Run the browser + API end-to-end suite (e2e/). Usage:
#     ./scripts/e2e.sh                     # every suite, against the local dev stack
#     ./scripts/e2e.sh smoke concurrency   # just these suites
#     TARGET=prod ./scripts/e2e.sh         # against https://agents.enableyou.co (needs gcloud auth)
# See e2e/README.md for what each suite does and what it may spend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NODE_PATH="$ROOT/frontend/node_modules"
if [ ! -d "$NODE_PATH/playwright" ]; then
  echo "playwright is not installed in frontend/node_modules. Install it once with:" >&2
  echo "    cd frontend && npm install && npx playwright install chromium" >&2
  exit 1
fi
exec node "$ROOT/e2e/run.js" "$@"
