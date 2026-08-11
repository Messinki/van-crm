# VanCRM — Build Specification v1.0

A personal, local-only web app for tracking vans for sale while shopping for a camper conversion base. Single user, runs on the user's own machine, no deployment, no auth.

**This document is the complete source of truth. Follow it exactly. Where it says "verify against official docs", do that verification before implementing — do not rely on training-data memory for API details, category IDs, or field names.**

---

## 1. Goals and non-goals

### Core loop
1. User opens the app in a browser (localhost).
2. User presses **"Scrape eBay"** → the backend runs saved eBay searches via the official eBay Browse API, upserts results into SQLite, and reports "X new, Y updated".
3. User manually adds Facebook Marketplace (or other) listings via an **"Add listing"** form.
4. For any listing with a UK registration number, the user presses a **"Check MOT"** action → backend fetches full MOT history from the DVSA MOT History API and caches it.
5. User works the pipeline in a **Notion-style table**: inline-editable cells, status pipeline, free-text notes, and user-defined custom columns.

### Non-goals for v1 (do not build these)
- No AI scoring, summarising, or pros/cons flagging
- No message drafting
- No scheduled/cron scraping — scrape is button-triggered only
- No multi-user support, no login, no hosting/deployment
- No Facebook scraping of any kind (manual entry only)

---

## 2. Tech stack (fixed — do not substitute)

| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Web framework | FastAPI + uvicorn |
| Database | SQLite via the stdlib `sqlite3` module (no ORM) |
| HTTP client | `httpx` |
| Config | `.env` file loaded with `python-dotenv` |
| Frontend | One `index.html` + `app.js` + `style.css`, vanilla JS. **No React, no build step, no npm.** Served by FastAPI `StaticFiles`. |

Do not add frameworks, ORMs, task queues, or Docker. Keep dependency count minimal: `fastapi`, `uvicorn`, `httpx`, `python-dotenv`.

### Project structure
```
van-crm/
├── .env                  # secrets — NEVER commit; add to .gitignore
├── .env.example          # template with empty values
├── requirements.txt
├── app/
│   ├── main.py           # FastAPI app, routes, startup
│   ├── db.py             # connection helper, schema creation, migrations
│   ├── ebay.py           # eBay auth + search + upsert
│   ├── mot.py            # DVSA auth + fetch + cache
│   └── static/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── data/
│   └── vancrm.db         # created on first run
└── README.md             # how to run + how to obtain credentials
```

Run command: `uvicorn app.main:app --port 8321` (fixed port so bookmarks work).

---

## 3. Configuration (`.env`)

```
# eBay production keyset (developer.ebay.com → Application Keys)
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_ENV=PRODUCTION            # or SANDBOX while approval is pending
EBAY_MARKETPLACE_ID=EBAY_GB

# DVSA MOT History API (received by email after registration approval)
DVSA_CLIENT_ID=
DVSA_CLIENT_SECRET=
DVSA_API_KEY=
DVSA_TOKEN_URL=                # full URL incl. tenant id, from the credentials email
DVSA_SCOPE=https://tapi.dvsa.gov.uk/.default
```

On startup, if eBay or DVSA vars are missing, the app must still run — the relevant buttons show a clear "credentials not configured" error instead of crashing. This matters because the user will have the app running before all approvals arrive.

### User-side registration steps (write these into README.md)
1. **eBay**: developer.ebay.com → create app → use the *Production* keyset's App ID (client id) and Cert ID (client secret). Sandbox keys are available immediately and work with the same code against sandbox base URLs — support `EBAY_ENV` switching both base URLs.
2. **DVSA MOT History API**: apply via the registration form linked from https://documentation.history.mot.api.gov.uk (a SmartSurvey application form). On approval, DVSA emails a client ID, client secret, scope URL, access-token URL, and API key. Note: the API key is revoked if unused for 90 days.

---

## 4. Database schema

Create exactly this schema in `db.py` on startup (idempotent `CREATE TABLE IF NOT EXISTS`). Store timestamps as ISO-8601 UTC strings.

```sql
CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL CHECK (source IN ('ebay','facebook','manual')),
  external_id   TEXT,                 -- eBay itemId; NULL for manual/facebook
  url           TEXT,
  title         TEXT NOT NULL,
  price_gbp     REAL,
  location      TEXT,
  seller_name   TEXT,
  image_urls    TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  description   TEXT,
  make          TEXT,
  model         TEXT,
  year          INTEGER,
  mileage       INTEGER,
  reg           TEXT,                 -- UK registration, uppercase, no spaces
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','considering','contacted','viewing_booked','rejected','purchased')),
  notes         TEXT NOT NULL DEFAULT '',
  custom        TEXT NOT NULL DEFAULT '{}',   -- JSON object {property_key: value}
  is_active     INTEGER NOT NULL DEFAULT 1,   -- 0 = confirmed ended/delisted
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  query       TEXT NOT NULL,          -- eBay q parameter
  max_price   REAL,                   -- GBP, NULL = no cap
  category_id TEXT,                   -- eBay category id, NULL = uncategorised
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS property_defs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,    -- slug, e.g. 'ply_lined'
  label      TEXT NOT NULL,           -- display name, e.g. 'Ply lined?'
  type       TEXT NOT NULL CHECK (type IN ('text','number','checkbox','select','date')),
  options    TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings, for 'select' only
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mot_cache (
  reg         TEXT PRIMARY KEY,
  fetched_at  TEXT NOT NULL,
  raw_json    TEXT NOT NULL           -- full API response verbatim
);
```

Seed `searches` on first run (user can edit/delete in the UI):

| label | query | max_price |
|---|---|---|
| Relay/Boxer/Ducato | citroen relay van | 8000 |
| Peugeot Boxer | peugeot boxer van | 8000 |
| Fiat Ducato | fiat ducato van | 8000 |
| Transit MWB | ford transit mwb medium roof | 8000 |
| Renault Master | renault master van | 8000 |

(These are seeds only — the user's actual shortlist lives in the UI.)

---

## 5. eBay integration (`ebay.py`)

Official docs to verify against: https://developer.ebay.com/api-docs/buy/browse/overview.html

### 5.1 Auth — OAuth2 client credentials
- Token endpoint: `https://api.ebay.com/identity/v1/oauth2/token` (sandbox: `https://api.sandbox.ebay.com/...`).
- `POST` with header `Authorization: Basic base64(client_id:client_secret)`, body `grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope`.
- Cache the token in a module-level variable with its expiry; refresh when <60s remain.

### 5.2 Search
- Endpoint: `GET {base}/buy/browse/v1/item_summary/search`
  - base prod: `https://api.ebay.com`, sandbox: `https://api.sandbox.ebay.com`
- Headers: `Authorization: Bearer <token>`, `X-EBAY-C-MARKETPLACE-ID: EBAY_GB`.
- Params per saved search:
  - `q` = search query
  - `filter` = `itemLocationCountry:GB` plus, if max_price set, `price:[..{max_price}],priceCurrency:GBP` plus `buyingOptions:{FIXED_PRICE|AUCTION|CLASSIFIED_AD}` — **verify the exact filter syntax and that CLASSIFIED_AD is supported in the current Browse API docs; UK vehicles are frequently listed as classified ads, so this matters**
  - `category_ids` if set on the search
  - `limit=200`, paginate with `offset` until `total` exhausted or 3 pages max per search
- **Category IDs**: do not hardcode from memory. During development, either call the eBay Taxonomy API (`getCategorySuggestions` for "vans") against EBAY_GB, or leave `category_id` NULL and rely on the query string. Document the found category id(s) in README.

### 5.3 Upsert logic (per returned item)
Match on `(source='ebay', external_id=itemId)`:
- **Not in DB** → INSERT: map `title`, `price.value`→price_gbp (only if `price.currency == 'GBP'`), `itemWebUrl`→url, `image.imageUrl` + `additionalImages[].imageUrl`→image_urls, `itemLocation` (join city/postalCode)→location, `seller.username`→seller_name. Set status `new`, `first_seen_at` = `last_seen_at` = now.
- **In DB** → UPDATE `price_gbp`, `last_seen_at`, `updated_at` only. Never overwrite user-edited fields (status, notes, custom, reg, year, mileage).
- After insert, run **reg extraction**: regex `\b[A-Z]{2}[0-9]{2}\s?[A-Z]{3}\b` (case-insensitive) over title + description; if exactly one distinct match, store it in `reg` (uppercase, spaces stripped). If multiple distinct matches, store nothing.
- The item summary from search does not include the full description. Fetching each item's detail (`GET /buy/browse/v1/item/{itemId}`) costs one call per item — do this **only for newly inserted items**, to populate `description` and improve reg extraction.
- Return a summary object: `{new: n, updated: n, errors: [strings]}`.

### 5.4 Liveness check
`POST /api/listings/{id}/check` (eBay listings only): call `GET /item/{external_id}`. If HTTP 404 or `itemEndDate` in the past → set `is_active=0`. Otherwise refresh price and `last_seen_at`.

---

## 6. MOT integration (`mot.py`)

Official docs to verify against: https://documentation.history.mot.api.gov.uk

This is the **new** MOT History API (2023+), not the old `beta.check-mot.service.gov.uk` one. If any tutorial or SDK references `Accept: application/json+v6` or the beta URL, it is the old API — ignore it.

### 6.1 Auth
- OAuth2 client credentials against Microsoft Entra ID.
- `POST {DVSA_TOKEN_URL}` with form body: `grant_type=client_credentials`, `client_id`, `client_secret`, `scope={DVSA_SCOPE}`.
- Tokens last 60 minutes — cache in a module-level variable and reuse; do not request a fresh token per lookup.

### 6.2 Fetch
- `GET https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{reg}`
- Headers: `Authorization: Bearer <token>`, `X-API-Key: {DVSA_API_KEY}`.
- Store the full response verbatim in `mot_cache.raw_json`.
- Cache policy: serve from cache if `fetched_at` < 7 days old; `?force=true` bypasses.
- Error handling: 404 → "no record for this registration" (surface in UI, don't cache); 400 → invalid reg format; 403/401 → credentials problem (surface clearly).

### 6.3 Derived fields (computed on read in the backend, returned alongside raw data)
From `motTests[]` (each test has `completedDate`, `testResult`, `expiryDate`, `odometerValue`, `odometerUnit`, `defects[]` with `text` and `type` ∈ ADVISORY/MINOR/MAJOR/DANGEROUS/FAIL — verify exact field names against the docs):
- `latest_result`, `latest_expiry`, `latest_advisory_count`
- `mileage_series`: list of `{date, odometer}` sorted by date, converted to miles if unit is km (×0.621, rounded)
- `mileage_warning: true` if the series is not monotonically increasing (possible clocking)
- `keyword_flags`: list of defect texts (any test, last 3 years) containing any of, case-insensitive: `corrod`, `rust`, `oil leak`, `excessively` — plain string matching, no AI
- Also surface vehicle-level fields: `make`, `model`, `fuelType`, `firstUsedDate`

---

## 7. Backend API routes (`main.py`)

All JSON. All mutations set `updated_at`.

| Method + path | Behaviour |
|---|---|
| `GET /` | serve `index.html` |
| `GET /api/listings` | all listings; query params: `status`, `source`, `q` (substring on title), `active` (default 1). Sort handled client-side. |
| `POST /api/listings` | manual add. Body: any subset of listing fields; `source` defaults to `facebook`. Required: `title`. |
| `PATCH /api/listings/{id}` | partial update of any editable field, incl. `notes`, `status`, `reg`, `custom` (merge keys, don't replace object unless key set to null) |
| `DELETE /api/listings/{id}` | hard delete row |
| `POST /api/scrape` | run all `enabled` searches; return `{new, updated, errors}` |
| `POST /api/listings/{id}/check` | eBay liveness check (5.4) |
| `GET /api/listings/{id}/mot` | cached MOT (derived + raw), or `{cached: false}` |
| `POST /api/listings/{id}/mot?force=` | fetch/refresh MOT for the listing's `reg`; 422 if no reg set |
| `GET/POST/PATCH/DELETE /api/searches[/{id}]` | manage saved searches |
| `GET/POST/PATCH/DELETE /api/properties[/{id}]` | manage property_defs. On DELETE, also strip that key from every listing's `custom`. On POST, derive `key` from label (slugify) and reject duplicates. |

Validation: reject `PATCH` fields not in an allowlist; coerce `reg` to uppercase/no-spaces; validate `custom` values against the property's declared type (400 on mismatch).

---

## 8. Frontend spec (vanilla JS)

Single-page. Fetch all listings once on load into a JS array; re-render the table from state after every mutation. No routing.

### 8.1 Top bar
- App title, then buttons: **Scrape eBay** (spinner while running; on completion, toast "12 new · 3 updated" or error toast), **Add listing**, **Searches**, **Columns**.
- Filter row: status multi-select chips, source dropdown, free-text search box (filters title), "show inactive" checkbox, max-price input.

### 8.2 Table (the core of the app)
Notion-style: full-width, one row per listing, sticky header.

Fixed columns in order: thumbnail (first image, 48px), Title (link to `url`, opens new tab), Price, Year, Mileage, Location, Source (small badge: eBay blue / FB grey), Status, MOT (see below), Reg, then **one column per property_def** in `sort_order`, then Notes (first ~60 chars, ellipsised).

- **Inline editing**: clicking a cell in Price/Year/Mileage/Reg/Title/Location swaps it for an `<input>`; Enter or blur saves via PATCH; Escape cancels. Status is always a coloured select pill (colours: new=blue, considering=yellow, contacted=purple, viewing_booked=orange, rejected=grey+row dimmed, purchased=green).
- **Custom columns** render by type: text/number → inline input; checkbox → checkbox; select → dropdown from options; date → date input. Values PATCH into `custom.{key}`.
- **MOT column**: if no reg → "add reg" hint; if reg but no cache → "Check" button; if cached → expiry date, coloured red if expired/within 30 days, plus "⚠" if `mileage_warning` or `keyword_flags` non-empty.
- **Sorting**: clicking a column header sorts client-side (toggle asc/desc). Numeric columns sort numerically.
- Rows with `is_active=0` show a strikethrough title.

### 8.3 Detail drawer
Clicking a row (outside editable cells) slides a right-hand drawer (~480px):
- Image strip (all image_urls, click to open full-size in new tab)
- All fields as labelled editable inputs; full description (read-only, pre-wrap)
- Notes: full-height textarea, autosaves (debounced 800ms PATCH)
- MOT panel: "Check MOT" / "Refresh" button; then vehicle summary line (make/model/fuel/first used), latest result + expiry, `keyword_flags` as a red-bordered list, mileage series as a simple text list (newest first) with the warning if flagged, and a collapsible per-test breakdown: date, result, mileage, defects grouped by type (DANGEROUS red, MAJOR orange, ADVISORY grey)
- Buttons: "Check listing live" (eBay only), "Delete" (confirm dialog)

### 8.4 Modals
- **Add listing**: fields url, title*, price, location, year, mileage, reg, seller, image URLs (textarea, one per line), description (big paste box). Source select defaulting to Facebook. On save, run the same reg-extraction regex client-side or server-side if reg left blank.
- **Searches**: table of saved searches with inline edit of label/query/max price/enabled toggle, add row, delete.
- **Columns**: list of property_defs with add form (label, type, options for select), reorder via up/down buttons, delete (confirm — warns values will be removed).

### 8.5 Styling
Minimal and clean: system font stack, white background, 13–14px table text, subtle row hover, 1px `#e5e5e5` borders. No CSS frameworks. Must remain usable at 1280px wide with ~8 visible columns; horizontal scroll allowed beyond that.

---

## 9. Build order (milestones — complete and verify each before the next)

1. **Skeleton**: project structure, `.env` loading, DB schema creation + seeds, `GET /` serving a "hello" index.html. *Verify: app starts with an empty `.env` without crashing.*
2. **Listings CRUD + table**: routes from §7 (listings only), table render, inline editing, status pills, filters, sorting, Add-listing modal, detail drawer with notes autosave. *Verify: add a fake FB listing, edit every field type, refresh browser, data persists.*
3. **Custom properties**: property_defs routes, Columns modal, dynamic columns, typed validation. *Verify: add a 'select' property, set values on two rows, delete the property, confirm values removed.*
4. **eBay**: auth, scrape, upsert, detail-fetch for new items, reg extraction, Scrape button + toast, liveness check. Develop against sandbox if production approval is pending. *Verify: two consecutive scrapes — second reports 0 new; a user-edited status survives a rescrape.*
5. **MOT**: auth, fetch, cache, derived fields, MOT column + drawer panel. *Verify with a real reg the user supplies; confirm 404 path with reg `AA00AAA`.*
6. **Polish**: inactive strikethrough, error toasts for missing credentials, README with credential walkthrough.

---

## 10. Acceptance checklist (all must pass)

- [ ] App runs with `uvicorn app.main:app --port 8321`; fresh clone + `.env` + `pip install -r requirements.txt` is the full setup
- [ ] Scrape button inserts eBay listings; re-running does not duplicate; user edits are never overwritten by a rescrape
- [ ] Price/currency: non-GBP items are skipped, never stored with wrong currency
- [ ] Manual listing with pasted description works end-to-end; reg auto-extracted when present
- [ ] MOT check on a real reg shows history, mileage series, and keyword flags; token is reused across lookups within an hour
- [ ] Custom property of every type (text, number, checkbox, select, date) can be created, edited on rows, and deleted cleanly
- [ ] Notes autosave survives a page refresh
- [ ] All secrets live only in `.env`; `.gitignore` covers `.env` and `data/`
- [ ] No credentials configured → app still loads; Scrape/MOT buttons show a helpful error

## 11. Standing instructions for the executing AI

- Verify eBay filter syntax, category IDs, and DVSA response field names against live official docs before coding those sections; if docs contradict this spec, follow the docs and note the deviation in README.
- Never log or echo secrets. Never commit `.env` or the database.
- If a decision isn't covered here, choose the simplest option consistent with §1 non-goals, and note it in README under "Decisions made".
