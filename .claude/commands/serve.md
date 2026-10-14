---
description: Set up, build and start VanCRM on localhost:8321 (args: reset = wipe the database, fresh = reinstall dependencies)
allowed-tools: Bash
---

Start VanCRM. Arguments: `$ARGUMENTS` (may contain `reset` and/or `fresh`).

Run these from the project root, stopping at the first failure:

1. Stop anything already on the port: `lsof -ti :8321 | xargs kill 2>/dev/null; true`
2. If the arguments contain `reset`: `rm -f data/vancrm.db` (it is recreated and seeded on start).
3. Setup, only for what's missing — or everything if the arguments contain `fresh`:
   - no `.venv`: `python3 -m venv .venv`
   - no `.venv/bin/uvicorn`, or `fresh`: `.venv/bin/pip install -r requirements.txt`
   - no `.env`: `cp .env.example .env` (never overwrite an existing one)
   - no `frontend/node_modules`, or `fresh`: `(cd frontend && npm install)`
4. Build: `(cd frontend && npm run build)`
5. Start the server in the background (`run_in_background`): `.venv/bin/uvicorn app.main:app --port 8321 --reload`
6. Wait a few seconds, then check `curl -s -o /dev/null -w "%{http_code}" localhost:8321/api/listings`.

Report one line: running at http://localhost:8321 (or what failed). Don't paste build output.
