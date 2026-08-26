# Architecture

How the system is put together and how to run it. Update whenever structure or
commands change.

## Overview

One FastAPI process serves both the JSON API and the static frontend. Everything is
synchronous and single-user; there is no queue, no worker, no cache layer beyond two
module-level dicts and the `mot_cache` table.

Backend modules, all under `app/`:

- **`main.py`** — the FastAPI app, all routes, and `FIELD_SPECS`, the single field
  registry (see below). `check_registry_covers_schema()` runs at startup and refuses
  to boot if the registry and the `listings` schema have drifted.
- **`db.py`** — connection helper, schema creation, `MIGRATIONS`, seeds, and
  `row_to_listing()`, which decodes the JSON TEXT columns so the API always hands out
  real types.
- **`ebay.py`** — eBay Browse API: OAuth client-credentials (cached token), saved-search
  scrape + upsert, item detail fetch, import-from-link, per-listing liveness check and
  the bulk `check_all` sweep. `PROGRESS` and `CHECK_PROGRESS` are module-level dicts the
  frontend polls while a scrape or sweep runs.
- **`mot.py`** — DVSA MOT History API: OAuth (cached token), fetch, 7-day `mot_cache`,
  derived fields (expiry, mileage series, defect flags), plus everything plate-shaped:
  `clean_reg()`, `extract_reg()`. The DVLA VES merge path lives here too, dormant until
  `DVLA_VES_API_KEY` is set.

Frontend is `app/static/` — `index.html` + `app.js` + `style.css`, served by
`StaticFiles`. No framework, no routing, no build step. All listings load once
(`GET /api/listings?active=-1`) into one `state` object; filtering and sorting are
client-side, and every mutation re-renders from `state`.

## What the app does

A Notion-style table of van listings: thumbnail, title (links to the original ad),
price, make/model/year/mileage, L/H size codes, reg, location, seller, source, status
pill, MOT due, live MOT summary, notes preview, plus user-defined custom columns. The
table is read-only (D-025); clicking a row opens the drawer where everything is edited.
Topbar: **Scrape eBay** (runs all enabled saved searches), **Check live** (bulk liveness
sweep), **Add listing ▾** (manual entry with plate lookup, or import from an eBay URL),
**Searches** and **Columns** modals.

## Data model

Four tables, created idempotently on startup: `listings`, `searches` (label, query,
price/year bounds, enabled), `property_defs` (typed custom columns), `mot_cache`
(raw DVSA response per reg, 7-day TTL). Conventions:

- Timestamps are ISO-8601 UTC strings via `db.now_iso()`.
- `image_urls` and `custom` are JSON-encoded TEXT; `row_to_listing()` decodes them.
  Never leak the raw JSON string to the client.
- Schema changes go in `db.MIGRATIONS` as `(table, column, type)` — `_migrate()` checks
  `PRAGMA table_info` and only adds what's missing, so existing data survives.

## The field registry

`main.FIELD_SPECS` defines, in order, every listing property: label, type, editability,
where it appears (table / drawer / manual form), drawer section, and cell renderer.
`EDITABLE_FIELDS` is derived from it (plus `custom`), and the frontend fetches it from
`GET /api/schema` — table, drawer and manual form all build from that and hardcode
nothing.

- A new field is visible everywhere by default; hide it per surface with
  `in_table: False` / `in_drawer: False`. Non-editable fields still show read-only in
  the drawer.
- `suggest: True` on a free-text field gives it a `<datalist>` of values already used
  across listings, built client-side from `state.listings`.
- Anything absent from `EDITABLE_FIELDS` is rejected with 400 — that's what keeps `id`,
  `external_id` and timestamps out of reach.
- Pseudo-fields with no column (`thumb`, `mot`, `reject`) are listed in `DERIVED_KEYS`;
  columns deliberately outside the registry go in `UNMANAGED_COLUMNS`.

## API surface

- `GET /api/listings` · `POST /api/listings` · `PATCH|DELETE /api/listings/{id}`
- `GET /api/schema` — the field registry
- `POST /api/scrape` + `GET /api/scrape/progress`
- `POST /api/import/ebay` — from a pasted URL, short link, or bare item id
- `POST /api/listings/{id}/check` — single liveness check
- `POST /api/listings/check-all` + `GET /api/listings/check-all/progress` — bulk sweep
- `GET|POST /api/listings/{id}/mot` — cached MOT / fetch (`?force=true` bypasses cache)
- `POST /api/lookup/reg` — merged DVSA (+ VES when configured) plate lookup
- `GET/POST/PATCH/DELETE /api/searches[/{id}]` and `/api/properties[/{id}]`

## Layout

```
├── AGENTS.md            # rules + session routine (CLAUDE.md symlinks here)
├── docs/                # STATUS, DECISIONS, ARCHITECTURE, CHANGELOG
├── requirements.txt     # fastapi, uvicorn, httpx, python-dotenv — nothing else
├── .env                 # secrets; never committed
├── app/
│   ├── main.py          # routes, FIELD_SPECS, startup checks
│   ├── db.py            # schema, migrations, seeds, row decoding
│   ├── ebay.py          # eBay auth/scrape/import/liveness
│   ├── mot.py           # DVSA auth/fetch/cache, reg utilities, dormant VES path
│   └── static/          # index.html, app.js, style.css
└── data/vancrm.db       # created on first run; never committed
```

## Running it

Setup and run commands are in `AGENTS.md`. The app boots and works with an empty
`.env`; each integration activates when its keys are added.

### Credentials

- **eBay** — <https://developer.ebay.com>: create an app, use the Production keyset's
  App ID as `EBAY_CLIENT_ID` and Cert ID as `EBAY_CLIENT_SECRET`. `EBAY_ENV=SANDBOX`
  points token endpoint and Browse base at the sandbox together (the cached token
  remembers which environment issued it). Currently on production keys.
- **DVSA MOT History API** — apply via the form linked from
  <https://documentation.history.mot.api.gov.uk>. DVSA emails client id/secret, scope
  URL, token URL and API key → the `DVSA_*` vars. The key is revoked if unused for
  90 days. This is the new (2023+) API; anything mentioning
  `beta.check-mot.service.gov.uk` or `Accept: application/json+v6` is the old one.
- **DVLA VES** (optional) — free key from
  <https://developer-portal.driver-vehicle-licensing.api.gov.uk> as
  `DVLA_VES_API_KEY`. Adds year-of-manufacture, fuel type, tax status to plate lookup.
  The var is present but empty, which reads as unconfigured; the code path is written
  (field names verified against v1.2.0 docs, 2026-08-12) but untested end-to-end since
  no key has been issued.
- **OpenRouter** (planned, milestone 4b) — `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`,
  not yet used by any code.

## Notable constraints

- Port 8321 is fixed so bookmarks keep working.
- A scrape spends one eBay detail call per genuinely new item, so it can run for
  minutes; the UI polls progress rather than blocking (D-034).
- macOS freezes the monotonic clock during sleep — both OAuth token caches must keep
  wall-clock deadlines (D-014).
- DVSA's gateway returns 403 for an unmatched URL path, indistinguishable from a
  rejected API key — plates are validated before they reach the URL (D-015).
- History is backed up to <https://github.com/Messinki/van-crm>; `.env` and `data/`
  never leave this machine.
