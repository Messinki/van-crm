# VanCRM

Local-only web app for tracking vans for sale while shopping for a camper conversion
base. Python 3.11+ / FastAPI backend, SQLite via stdlib `sqlite3`, vanilla-JS frontend.
Single user, runs on localhost, no auth, no deployment.

## Commands

- Install: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cp .env.example .env`
- Run: `.venv/bin/uvicorn app.main:app --port 8321` — port is fixed so bookmarks keep
  working; add `--reload` while developing. Then open <http://localhost:8321>.
- Test: none yet — verification is manual against the running app. A test suite is on
  the refactor list (see `docs/STATUS.md`).
- Lint / Build: none — no build step by design.

Reset the database by deleting `data/vancrm.db`; it is recreated and seeded on next start.

## Rules

- **The stack is fixed.** Dependencies stay at `fastapi`, `uvicorn`, `httpx`,
  `python-dotenv`. No ORM, no React, no npm or build step, no Docker, no task queues.
- **Out of scope**: message drafting, scheduled scraping (button-triggered only),
  multi-user or auth, Facebook scraping of any kind (manual entry only). AI is limited
  to field extraction on import (D-036); no scoring, summarising or prose.
- **Verify API details against live official docs** before writing eBay, DVSA, DVLA or
  OpenRouter code — filter syntax, category ids, request/response field names. Never
  rely on memory. If the live docs contradict anything written here, follow the docs
  and record the deviation in `docs/DECISIONS.md`.
- **Never log or echo secrets. Never commit `.env` or `data/`.**
- The app must always boot with an empty `.env` — an unconfigured integration answers
  503 with a plain-English message; it never crashes the app.
- **A new listing field goes in `main.FIELD_SPECS`, nowhere else.** A new column goes
  in `db.MIGRATIONS`. The startup registry check refuses to boot if the two disagree.
  How the registry works is in `docs/ARCHITECTURE.md`.
- **Do not regress** the decisions flagged **Do not regress** in `docs/DECISIONS.md` —
  wall-clock token deadlines (D-014), plate validation before the DVSA URL (D-015),
  the always-sent `buyingOptions` filter (D-001), eBay warnings surfaced as scrape
  errors (D-002), the spares/repairs skip (D-004) and scrape progress polling (D-034).
  Each of them looks like something a refactor would "fix".
- `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`; never turn `CLAUDE.md`
  into a regular file.

## Docs

Project state lives in `docs/`:

| File                   | Answers                                            | Lifecycle                                    |
| ---------------------- | -------------------------------------------------- | -------------------------------------------- |
| `docs/STATUS.md`       | What's happening now, what's next, what's broken?  | Living. Rewrite freely; it only describes *now*. |
| `docs/DECISIONS.md`    | Why is it like this?                               | Append-only. Supersede old entries, never edit them. |
| `docs/ARCHITECTURE.md` | How is it put together and how do I run it?        | Update when structure or commands change.    |
| `docs/CHANGELOG.md`    | What changed, per goal/release?                    | Append-only, newest first.                   |

CHANGELOG says *what happened*; DECISIONS says *why we chose it*. A CHANGELOG entry
may cite decision IDs; a DECISIONS entry never lists changes. Each doc carries its
own entry format at the top — follow it, don't invent one.

## Session routine

- **Start:** read `docs/STATUS.md`. Read `ARCHITECTURE.md` and skim `DECISIONS.md`
  only when the task touches structure or a past choice.
- **During:** when a non-obvious choice is made (library, pattern, trade-off,
  "we won't do X"), append to `DECISIONS.md` before implementing it.
- **End:** update `STATUS.md` so the next session can start cold. If a goal
  completed, add the `CHANGELOG.md` entry. If commands or structure changed,
  fix `ARCHITECTURE.md`.
