---
description: Set up, build and start VanCRM on localhost:8321 (arg: fresh = reinstall dependencies). Never touches the database
allowed-tools: Bash
---

Start VanCRM. Arguments: `$ARGUMENTS` (may contain `fresh`).

Run these from the project root, stopping at the first failure:

1. Stop anything already on the port: `lsof -ti :8321 | xargs kill 2>/dev/null; true`
2. Setup, only for what's missing — or everything if the arguments contain `fresh`:
   - no `.venv`: `python3 -m venv .venv`
   - no `.venv/bin/uvicorn`, or `fresh`: `.venv/bin/pip install -r requirements.txt`
   - no `.env`: `cp .env.example .env` (never overwrite an existing one)
   - no `frontend/node_modules`, or `fresh`: `(cd frontend && npm install)`
3. Build: `(cd frontend && npm run build)`
4. Start the server in the background (`run_in_background`): `.venv/bin/uvicorn app.main:app --port 8321 --reload`
5. Wait a few seconds, then check `curl -s -o /dev/null -w "%{http_code}" localhost:8321/api/listings`.

Never delete, move or modify anything in `data/` — if the user asks for a reset, tell them to do it by hand.

Report one line: running at http://localhost:8321 (or what failed). Don't paste build output.
