# VanCRM

A personal, local-only web app for tracking vans for sale while shopping for a camper
conversion base. Single user, runs on localhost, no auth, no deployment.

FastAPI + SQLite (stdlib `sqlite3`) + a vanilla-JS frontend. No framework, no build step.

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # works with all keys blank
.venv/bin/uvicorn app.main:app --port 8321
```

Then open <http://localhost:8321>. The database is created and seeded at
`data/vancrm.db` on first run; delete that file to reset.

The app boots and works with an empty `.env` — the eBay scrape, MOT lookups and plate
lookup each activate when their keys are added. The credential walkthrough is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) under "Credentials".

## Docs

[AGENTS.md](AGENTS.md) holds the project rules; project state lives in `docs/`:
[STATUS](docs/STATUS.md) (what's happening now), [ARCHITECTURE](docs/ARCHITECTURE.md)
(how it's put together), [DECISIONS](docs/DECISIONS.md) (why it's like this),
[CHANGELOG](docs/CHANGELOG.md) (what changed).

`.env` and `data/` never leave this machine; this repo is the backup for everything else.
