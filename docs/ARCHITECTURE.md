# Architecture

How the system is put together and how to run it. Update whenever structure or
commands change.

## Overview

One FastAPI process serves both the JSON API and the built frontend. Everything is
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
- **`normalise.py`** — one spelling per make and model (D-053): `canonical_make()`,
  `canonical_model()`, `parse_size_codes()` and `tidy()`, which create/PATCH
  validation, the eBay scrape/import and the plate lookup all run make/model
  through. `tidy_all()` runs at startup and tidies any stored row that differs.
  New base models or make aliases go in its `BASE_MODELS` / `MAKE_ALIASES`.
- **`geo.py`** — UK geocoding through postcodes.io (D-048): `locate()` turns a
  free-text location into coordinates, `locate_listing()` stores them on one listing,
  `fill_missing()` runs every listing that needs a lookup. See "Geocoding and maps".

Frontend is a Vite + React + TypeScript app in `frontend/` (D-037). `npm run build`
emits to `app/static/dist/` (gitignored, D-038); FastAPI serves its `index.html` at
`/` and the hashed assets through the `/static` mount. In dev, Vite on :5173 proxies
`/api` to :8321. All listings load once (`GET /api/listings?active=-1`, D-035) into
the TanStack Query cache; filtering, ranking and sorting are plain client-side
selectors over that list (D-039), and mutations write the returned row straight back
into the cache. Filter, rank, column-visibility and Table | Map settings persist to
localStorage. Distances are computed here too: `App` runs every listing through
`withNearest(listings, homes)` once, attaching `nearest: {miles, home} | null`, and
table, popup, map card, filters, sorting and ranking all read that (D-047).

Inside `frontend/src/`:

- **`api/`** — `client.ts`, the one fetch wrapper (`ApiError` carries status and
  body), and `queries.ts`, a TanStack Query hook per resource, including the D-034
  progress polling.
- **`lib/`** — `schema.ts` (types for the API's shapes), `filtering.ts`,
  `ranking.ts` and `visible.ts` (filter model, weighted rank score, the visible-rows
  selector), `distance.ts` (haversine miles, closest enabled home, why a distance is
  missing), `format.ts`, `store.ts` (localStorage), `lookup.ts` (what a plate lookup
  may fill), `window.ts`.
- **`components/`** — `Topbar.tsx` (with the Table | Map toggle);
  `DistanceValue.tsx` ("42 mi" + the home pill, used by every surface); `table/`
  (TanStack Table, columns from the registry, cell renderers); `filters/` (filter
  bar, rank panel, View menu); `detail/` (the listing popup, its fields, gallery and
  MOT panel); `map/` (`VanMap`, the one Leaflet component, plus
  `LocationMapDialog` and `AllVansMap`); `modals/` (manual entry, import, searches,
  homes, columns); `ui/` (shadcn/ui primitives).

## What the app does

A Notion-style table of van listings: thumbnail, title, price (with a +VAT chip,
D-043), make/model/year/mileage, L/H size codes, reg, location, distance to the
closest enabled home with a pill naming it (D-047), seller, source, status pill, MOT
due, live MOT summary, notes preview, plus user-defined custom columns.
Above it: title search, status chips, show-ended, a View menu for column visibility,
the faceted filter bar and the rank panel. The table is read-only (D-025) apart from
the +VAT chip (D-044), the MOT cell's Check button and the Location cell, which
opens a small map of that van and the homes (D-049). Clicking a row opens the
listing popup, where everything is edited: photos on the left (←/→ change photo,
pinch zooms), fields on the right, ↑/↓ step through the table's current order
(D-041, D-042, D-045, D-046). A field saves when you leave it, press Enter, pick a
suggestion, close the popup or move to another van — not per keystroke (D-052);
notes autosave on a debounce (D-029).
The topbar's **Table | Map** toggle swaps the table for a map of the same rows:
clustered van pins, home pins, and a card per pin that opens the popup (D-049).
Topbar: **Scrape eBay** (runs all enabled saved searches), **Check live** (bulk liveness
sweep), **Add listing ▾** (manual entry with plate lookup, or import from an eBay URL),
**Searches**, **Homes** and **Columns** modals.

## Data model

Five tables, created idempotently on startup: `listings`, `searches` (label, query,
price/year bounds, enabled), `property_defs` (typed custom columns), `mot_cache`
(raw DVSA response per reg, 7-day TTL), `homes` (label, postcode, lat/lng, enabled,
position — coordinates are looked up when a home is saved, so a home is never stored
unplaced). Conventions:

- Timestamps are ISO-8601 UTC strings via `db.now_iso()`.
- `image_urls` and `custom` are JSON-encoded TEXT; `row_to_listing()` decodes them.
  Never leak the raw JSON string to the client.
- Schema changes go in `db.MIGRATIONS` as `(table, column, type)` — `_migrate()` checks
  `PRAGMA table_info` and only adds what's missing, so existing data survives.
- `listings.make` and `model` are only ever stored in their one canonical spelling
  (`Citroen`, `Relay`) — every write goes through `normalise.tidy()` (D-053).
- `listings.lat`, `lng` and `geocoded_from` are written only by `geo.py`.
  `geocoded_from` is the location string the last lookup ran on; a listing needs a
  lookup when it has a location and `geocoded_from` differs from it.

## The field registry

`main.FIELD_SPECS` defines, in order, every listing property: label, type, editability,
where it appears (table / popup / manual form), popup section, and cell renderer.
`EDITABLE_FIELDS` is derived from it (plus `custom`), and the frontend fetches it from
`GET /api/schema` — table, popup and manual form all build from that and hardcode
nothing. (The popup was a side drawer when the registry was written, hence the
`in_drawer` key.)

- A new field is visible everywhere by default; hide it per surface with
  `in_table: False` / `in_drawer: False`. Non-editable fields still show read-only in
  the popup.
- `suggest: True` on a free-text field gives it a `<datalist>` of values already used
  across listings, built client-side from the loaded listings.
- Anything absent from `EDITABLE_FIELDS` is rejected with 400 — that's what keeps `id`,
  `external_id` and timestamps out of reach.
- Pseudo-fields with no column (`thumb`, `mot`, `reject`, `distance`) are listed in
  `DERIVED_KEYS`; columns deliberately outside the registry go in `UNMANAGED_COLUMNS`
  (that includes `lat`, `lng`, `geocoded_from` — returned by the API, never edited).
- A spec's `unit` key (`"mi"` for distance) is appended to filter chips and editor
  labels.

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
- `GET/POST/PATCH/DELETE /api/homes[/{id}]` — a new or changed postcode is geocoded;
  unknown → 422, postcodes.io unreachable → 503
- `POST /api/geocode/missing` — look up every listing that needs it; returns
  `{located, not_found, failed}`

## Geocoding and maps

Geocoding uses **postcodes.io** (`https://api.postcodes.io`, no key, UK only, D-048).
Response shapes were probed against the live API on 2026-10-04:

| Need | Call | Coordinates in |
|---|---|---|
| Full postcode | `GET /postcodes/{pc}` | `result.latitude`, `result.longitude` |
| Many full postcodes | `POST /postcodes` body `{"postcodes": [...]}`, **max 100** | `result[i].result.latitude/longitude`; `result[i].result` is `null` for an unknown one |
| First half (outcode) | `GET /outcodes/{outcode}` | `result.latitude`, `result.longitude`; unknown → HTTP 404 |
| Town/place name | `GET /places?q=Yeovil&limit=20` | `result[i].latitude/longitude`; also `name_1`, `local_type`, `county_unitary`, `district_borough`, `region` |

Lookup order per location string, stopping at the first hit: a full postcode anywhere
in it; else an outcode anywhere in it (eBay writes `Town, BB5 ***`); else the text
before the first comma as a place name, the 20 results ranked by exact name, then a
county/district/region matching the text after the comma, then City > Town > Village
(D-050); else "not found".

When lookups run: after a manual create; on a PATCH that changes `location` (if that
lookup fails, the old coordinates are cleared so the old place never lingers, D-050);
one `fill_missing()` pass at the end of each scrape and import; and the Homes dialog's
Retry, which calls `/api/geocode/missing`. A geocoding failure never fails a save or a scrape. "Not
found" is remembered (coordinates null, `geocoded_from` set) so junk isn't retried; a
network failure isn't, so it's retried next time, and a `fill_missing()` pass stops at
the first one (D-050). Lookups are cached per normalised query in a module-level dict.

Distance is straight-line, whole miles, to the closest **enabled** home, computed in
the browser so toggling a home re-sorts instantly (D-047). Filters compare the whole
miles shown; sorting and ranking use the unrounded figure; a van with no distance
sorts last and ranks neutral.

Maps are Leaflet + react-leaflet v5 + react-leaflet-cluster on the standard OSM tile
server (D-049), all through `components/map/VanMap.tsx`. Pins are plain `divIcon`
circles — vans orange `#ea580c`, homes teal `#0d9488` (the pill's colour), bigger
with a white centre. Only enabled homes are drawn, and they never cluster. Cluster
bubbles are van orange; only the library's base CSS is imported, since its default
stylesheet colours bubbles by size. A fit never zooms past 11 — outcode accuracy
doesn't justify street level. No lines or radius circles. OSM's tile policy requires
the visible attribution and forbids pre-fetching or offline download; light
interactive personal use is fine.

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
│   ├── geo.py           # postcodes.io geocoding, fill_missing
│   └── static/dist/     # frontend build output, served at /; gitignored
├── frontend/            # Vite + React + TypeScript app (src/api, components, lib)
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
- **postcodes.io** and **OSM tiles** need no keys. Without a network the app still
  boots; listings just go unplaced until the next lookup.
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
