#!/usr/bin/env bash
# Set up, (re)build only if the frontend changed, and start VanCRM on :8321.
# Usage: scripts/serve.sh [fresh]   (fresh = reinstall dependencies)
# Never touches the database.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8321
DIST=app/static/dist/index.html

# 1. Stop anything already on the port
lsof -ti :$PORT | xargs kill 2>/dev/null || true
for _ in $(seq 1 20); do lsof -ti :$PORT >/dev/null 2>&1 || break; sleep 0.25; done

# 2. Setup, only for what's missing (or everything with `fresh`)
fresh=0; [ "${1:-}" = "fresh" ] && fresh=1
[ -d .venv ] || python3 -m venv .venv
if [ $fresh = 1 ] || [ ! -x .venv/bin/uvicorn ]; then
  .venv/bin/pip install -q -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
if [ $fresh = 1 ] || [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install --silent)
fi

# 3. Build only if there is no build, or any frontend source is newer than it
needs_build=0
if [ ! -f "$DIST" ]; then
  needs_build=1
elif [ -n "$(find frontend/src frontend/public frontend/index.html frontend/package.json \
    frontend/package-lock.json frontend/vite.config.ts frontend/tsconfig*.json \
    -newer "$DIST" -type f 2>/dev/null | head -1)" ]; then
  needs_build=1
fi
if [ $needs_build = 1 ]; then
  echo "Frontend changed - building..."
  (cd frontend && npm run build --silent)
else
  echo "Frontend unchanged - skipping build."
fi

# 4. Start the server in the background
nohup .venv/bin/uvicorn app.main:app --port $PORT --reload > .serve.log 2>&1 &

# 5. Wait for it to answer
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" localhost:$PORT/api/listings || true)
  [ "$code" = "200" ] && { echo "Running at http://localhost:$PORT"; exit 0; }
  sleep 0.5
done
echo "Server did not come up (last status $code). See .serve.log:"
tail -20 .serve.log
exit 1
