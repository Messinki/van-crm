# VanCRM — project instructions

Local-only web app for tracking vans for sale while shopping for a camper conversion base.
Single user, runs on localhost, no auth, no deployment.

## Where the context lives

| Doc | What's in it |
|---|---|
| [van-crm-spec.md](van-crm-spec.md) | The v1.0 build specification — the source of truth |
| [van-crm-spec-amendment-01.md](van-crm-spec-amendment-01.md) | Amendment 01 — **wins wherever it conflicts with v1.0** |
| [README.md](README.md) | How to run, credential walkthrough, build status table, "Decisions made" log |

Read the spec *and* the amendment before changing behaviour. The README's **Decisions made**
section records choices the spec left open — add to it rather than re-deciding.

## Run it

```bash
.venv/bin/uvicorn app.main:app --port 8321
```

Port 8321 is fixed so bookmarks keep working. The DB is created and seeded at
`data/vancrm.db` on first run; delete that file to reset.

## Ground rules from the spec

- **Stack is fixed**: Python 3.11+, FastAPI, stdlib `sqlite3` (no ORM), `httpx`,
  `python-dotenv`, vanilla JS frontend. No React, no build step, no npm, no Docker,
  no task queues. Dependencies stay at those four.
- **Non-goals for v1**: no AI scoring or summarising, no message drafting, no scheduled
  scraping (button-triggered only), no multi-user, no Facebook scraping of any kind.
- **Verify API details against live official docs** before writing eBay or DVSA code —
  filter syntax, category IDs, response field names. Do not rely on memory. If the docs
  contradict the spec, follow the docs and note the deviation in the README.
- **Never log or echo secrets. Never commit `.env` or `data/`.**
- The app must always start with an empty `.env` — unconfigured integrations return
  503 with a plain-English message, they never crash.

## Build status

Milestones 1–3 are done (skeleton, listings CRUD + table, custom properties), plus
Amendment 01 sections A–C's schema and UI. See the README's status table for detail.

**Milestone 4 (eBay)** and **milestone 5 (MOT / reg lookup)** are not started — blocked on
the user's eBay developer account and DVSA credentials. `app/ebay.py` and `app/mot.py` do
not exist yet; the routes in `app/main.py` under the "not yet wired" heading return 503 and
are the seams to fill in.

## Conventions in this codebase

- Timestamps are ISO-8601 UTC strings via `db.now_iso()`.
- `image_urls` and `custom` are JSON-encoded TEXT columns; `db.row_to_listing()` decodes
  them so the API always hands out real types. Never leak the raw JSON string to the client.
- Schema changes go in `db.MIGRATIONS` as `(table, column, type)` — `_migrate()` checks
  `PRAGMA table_info` and only adds what's missing, so existing data survives.
- Every field a client may write is listed in `main.EDITABLE_FIELDS`. Anything absent is
  rejected with 400 — that's what keeps `id`, `source` and timestamps out of reach.
- Frontend state is one `state` object; mutations re-render from it. No framework, no routing.
