#!/usr/bin/env bash
# Set up (first run only), build the frontend and start VanCRM on http://localhost:8321.
#   ./run.sh           setup if needed, build, serve
#   ./run.sh --reset   also delete data/vancrm.db first (recreated and seeded on start)
#   ./run.sh --fresh   also reinstall Python + npm dependencies
set -euo pipefail
cd "$(dirname "$0")"

RESET=0; FRESH=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --fresh) FRESH=1 ;;
    *) echo "Unknown option: $arg (use --reset or --fresh)"; exit 1 ;;
  esac
done

if [ "$RESET" = 1 ]; then
  rm -f data/vancrm.db
  echo "Database deleted; it will be recreated and seeded on start."
fi

[ -d .venv ] || python3 -m venv .venv
if [ "$FRESH" = 1 ] || [ ! -x .venv/bin/uvicorn ]; then
  .venv/bin/pip install -r requirements.txt
fi
[ -f .env ] || cp .env.example .env   # never overwrites an existing .env

cd frontend
if [ "$FRESH" = 1 ] || [ ! -d node_modules ]; then
  npm install
fi
npm run build
cd ..

echo "Serving on http://localhost:8321"
exec .venv/bin/uvicorn app.main:app --port 8321 --reload
