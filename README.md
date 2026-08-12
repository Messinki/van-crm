# VanCRM

A personal, local-only web app for tracking vans for sale while shopping for a camper conversion base.
Single user, runs on your own machine, no auth, no deployment.

Spec: [van-crm-spec.md](van-crm-spec.md) + [van-crm-spec-amendment-01.md](van-crm-spec-amendment-01.md)
+ [van-crm-spec-amendment-02.md](van-crm-spec-amendment-02.md)
(later amendments win where they conflict).

---

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # leave the keys blank until approvals land
.venv/bin/uvicorn app.main:app --port 8321
```

Then open <http://localhost:8321>.

The database is created at `data/vancrm.db` on first run and seeded with five saved
searches. Deleting that file resets everything.

---

## Build status

| Milestone | State |
|---|---|
| 1. Skeleton — structure, `.env`, schema + migrations + seeds | done |
| 2. Listings CRUD, read-only table, drawer editor, filters, sorting, Add dropdown | done |
| 3. Custom properties — typed columns, Columns modal | done |
| 4. eBay — auth, scrape, upsert, import-from-link, liveness | done, **verified against the sandbox** (see below); production keys in since 2026-08-12, and a real production scrape is now verified too (see below) — import-from-link, the shortener redirect, liveness-on-an-ended-item, the spares/repairs skip and the Taxonomy re-run are still unchecked |
| 4b. AI enrichment — size/VAT/mileage/flags from descriptions | **not built** — spec'd in [amendment 02](van-crm-spec-amendment-02.md) §B |
| 5. MOT + reg lookup — DVSA, `/api/lookup/reg`, MOT column and drawer panel | done (DVLA VES sub-step dormant until a key is set) |
| 6. Polish — inactive strikethrough, error toasts, README | mostly done |

### eBay: what is tested, and what is waiting on production keys

`app/ebay.py` is written and wired. It was verified against the **sandbox** (eBay's
sandbox holds almost no inventory — one stray listing answers a search for "van", and it
is a packet of fuses — so the plumbing is proven and the *yield* is not). A **production**
keyset replaced the sandbox one in `.env` on 2026-08-12 (`EBAY_ENV=PRODUCTION`); the
deferred checks below are now runnable and are the next task — see
[amendment 02](van-crm-spec-amendment-02.md) §A.

**Verified for real against the sandbox on 2026-08-12** (whole app running, real
credentials, a scratch copy of the database so none of this reached `data/`):

- OAuth client-credentials token against the sandbox endpoint, cached and reused.
- `POST /api/scrape` → `{"new": 1, "updated": 0, "skipped": 0, "errors": []}`; the row
  arrives with title, GBP price, location, seller, 15 images and a 3.4k-character
  description in `notes`.
- A second scrape immediately after → `{"new": 0, "updated": 1}`. A third, after
  hand-editing status, notes, reg, year and mileage → still `0 new`, and **every edit
  survived** with only `last_seen_at`/`updated_at` moving.
- `POST /api/listings/{id}/check` → `{"active": true, "message": "Still live on eBay"}`.
- `POST /api/import/ebay` with a full listing URL (title slug *and* query string) →
  201 with photos and description; pasting it again → 409 carrying the existing row's
  id, which the frontend turns into "opened it" rather than a duplicate. A search URL
  → 422 "Couldn't find an item id in that URL". An item already found by a scrape is
  recognised by the importer (and vice versa) — both key on the same `itemId`.
- With `EBAY_CLIENT_ID` blanked in the environment, the app still boots, `/` and
  `/api/listings` are fine, and all three eBay endpoints answer **503** with
  "eBay is not configured yet — add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env".
- URL parsing, the spares-or-repairs skip, aspect mapping, HTML→notes, the year filter
  and price/currency handling have unit-style coverage (≈50 assertions, all passing).

**Deferred while on sandbox keys — now unblocked, not yet run:**

- A scrape that actually finds vans: real result volume, pagination past one page, and
  whether the saved searches' wording is any good.
- Import-from-link against a live `ebay.co.uk` URL (sandbox item ids do not exist in
  production, and vice versa).
- The `ebay.us` / `ebay.to` shortener path — resolvable only against real short links.
  The id-extraction half is unit-tested; only the redirect-following is untried.
- A liveness check that returns *not* live (nothing in sandbox ends).
- The spares-or-repairs skip firing on a real listing (unit-tested only).
- Re-running the Taxonomy category lookup on production (see Decisions made — the ids
  below came from the sandbox Taxonomy service, which did work).

Switching over is `EBAY_ENV=PRODUCTION` plus the production keyset; no code change.

**Verified for real against production on 2026-08-12:** a live scrape across all 5 saved
searches returned real result volume with pagination past one page, confirming the
searches' wording finds actual vans. It also surfaced two data-quality problems, both now
fixed (see Decisions made): with no price floor, keyword search matched cheap parts and
even unrelated items (trading cards, brochures) that happened to contain a search term or
a surname like "van Dijk"; with no year floor enforced, vans back to 1994 came through.
Still deferred: import-from-link against a live URL, the `ebay.us`/`ebay.to` shortener
redirect, a liveness check on an item that has actually ended, the spares-or-repairs skip
firing on a real listing, and re-running the Taxonomy category lookup on production.

MOT is live: with the `DVSA_*` values in `.env`, the table's MOT column, the drawer's
MOT panel and the plate lookup all work. Without them they return the same 503s.
`DVLA_VES_API_KEY` is still optional and still unset — the lookup runs MOT-only and
`tax_status` comes back `null` until a key is added; no code change is needed then. When VES
*is* configured and then fails, the lookup still succeeds on the MOT half and explains the
missing half in the response's `warnings` list rather than staying silent.

---

## Getting credentials

### eBay (milestone 4)
1. Sign up at <https://developer.ebay.com> and create an application.
2. Use the **Production** keyset's App ID as `EBAY_CLIENT_ID` and Cert ID as `EBAY_CLIENT_SECRET`.
3. Sandbox keys are issued immediately and work against the same code — set `EBAY_ENV=SANDBOX`
   to point at `api.sandbox.ebay.com` while production approval is pending. `EBAY_ENV` switches
   the token endpoint and the Browse API base together, and the cached token remembers which
   environment issued it, so flipping the value mid-session cannot reuse the wrong one.
4. Category IDs are not hardcoded — see "eBay category ids" under Decisions made for the two
   the Taxonomy API returned for `EBAY_GB`, and how to use them.

**Verified against the live API on 2026-08-12** with the sandbox keyset: the token call, the
search filters, the item detail and legacy-id endpoints, and the 404 shapes all behave as
documented below. Note eBay's own docs site (`developer.ebay.com`) refuses automated fetches,
so the contract was read from eBay's published OpenAPI description for Browse (`buy_browse_v1_oas3`,
v1.20.4) and everything load-bearing was then confirmed by calling the API.

### DVSA MOT History API (milestone 5)
Apply via the registration form linked from <https://documentation.history.mot.api.gov.uk>.
On approval DVSA emails a client ID, client secret, scope URL, access-token URL and API key —
these map to `DVSA_*` in `.env`. Note the API key is revoked if unused for 90 days.

This is the *new* (2023+) MOT History API. Anything referencing `beta.check-mot.service.gov.uk`
or `Accept: application/json+v6` is the old API and does not apply.

**Verified working 2026-08-11** against the live API with the credentials in `.env`. The
response field names match spec §6.3 with no deviations; the only addition worth noting is
that each defect also carries a `dangerous` boolean alongside its `type`, and the app uses
it (a defect counts as dangerous if either says so).

### DVLA Vehicle Enquiry Service (optional, milestone 5)
Request a free key from <https://developer-portal.driver-vehicle-licensing.api.gov.uk> and set
`DVLA_VES_API_KEY`. It supplies `yearOfManufacture` and fuel type; without it, reg lookup
still returns make/model/year from the MOT source. (`euroStatus` is also available but the app
no longer tracks it — see Decisions made.)

**Field names verified against the live docs 2026-08-12** (the VES path itself is still
untested against a real key — no key has been issued yet). Request body is `registrationNumber`,
auth header is `x-api-key`, and the six fields the app reads back — `make`, `yearOfManufacture`,
`fuelType`, `colour`, `engineCapacity`, `taxStatus` — all match v1.2.0 of the published schema.
Note `DVLA_VES_API_KEY=` currently exists in `.env` but is **empty**, which reads as unconfigured:
`mot.ves_configured()` is a truthiness check, so the lookup skips VES rather than failing. Set a
real value and it starts contributing with no code change.

---

## What works right now

- **Table** — thumbnail · Title · Price · Make · Model · Year · Mileage · Height · Length ·
  Reg · Location · Seller · Source · Status · Active · MOT due · MOT · Notes preview · custom
  columns. The order is `main.FIELD_SPECS`' order, with custom columns appended at the end.
- **Read-only table** — the only clickable thing in a row is the Title, which opens the original
  listing in a new tab. Clicking anywhere else in the row opens the drawer, which is where all
  editing happens.
- **Status** is a coloured pill. `rejected` dims the row.
- **Sorting** — click a header; numeric columns sort numerically, blanks always sink to the bottom.
- **Filters** — status chips (multi-select), source, title search, max price, show-inactive.
- **Add listing ▾** — Manual entry (with a Look up button on the plate field) or From eBay link.
  Manual entry's Source can be Facebook, eBay or Manual/other, so an eBay listing can still be
  typed in by hand when the importer can't reach it.
- **Detail drawer** — click a row; all fields editable, notes autosave 800ms after you stop typing,
  image strip, delete with confirm.
- **MOT column** — expiry date (red once it's inside 30 days or past), then small badges: `D3`
  dangerous and `M3` major defect counts over the last three years, and `⚠` for a mileage
  jump backwards or a corrosion/rust/oil-leak/"excessively" wording in a recent defect. Every
  badge has a tooltip. A reg with nothing cached shows a **Check** button in the cell; no reg
  shows `add reg`. Sorting the column sorts by expiry date.
- **Drawer MOT panel** — Check MOT / Refresh, then the vehicle line, latest result and expiry,
  the flagged defect texts, the mileage history newest-first, and a collapsible per-test
  breakdown with defects coloured by severity.
- **Look up plate** — in the drawer and on manual entry. Fills make, model, year, height,
  length, mileage and MOT due, but only where the field is empty, and shows fuel · colour ·
  engine size as a read-only line. It also warms the MOT cache, so a new listing has its MOT
  column filled in without a separate Check.
- **Suggestions on repeated fields** — Make, Model, Year, Location and Seller offer a dropdown of
  values already used on other listings (drawer and manual entry both). Free text either way.
- **Columns modal** — add/rename/reorder/delete custom properties of any type. Deleting a property
  strips its values from every listing.
- **Searches modal** — label, query, max price, **year from / year to**, enabled, delete. Only
  enabled searches run.
- **Scrape eBay** — runs every enabled search, upserts, and toasts "X new · Y updated". Anything
  that went wrong (a failed search, an eBay warning about a filter) comes back as its own error
  toast rather than being swallowed.
- **From eBay link** — paste any listing URL; it imports with photos, description and the
  make/model/year/mileage eBay holds as item aspects. A URL already in the table opens that row
  instead of duplicating it. If exactly one number plate appears in the title or description it
  is filled in, and a toast points at the Look up button.
- **Check listing live** — in the drawer on eBay rows: refreshes the price, and marks the row
  inactive (strikethrough) once eBay says the listing has gone or ended.

---

## Decisions made

Choices the spec left open, resolved the simplest way:

- **The `buyingOptions` filter is mandatory, not optional garnish** — eBay's Browse contract
  states that search returns listings with `FIXED_PRICE` as a buying option *and nothing else*
  unless `buyingOptions` is filtered explicitly. Since most UK vans are auctions or classified
  ads, omitting the filter (the obvious fallback if `CLASSIFIED_AD` had turned out unsupported)
  would have quietly hidden the majority of them. It is supported: the live API accepts
  `filter=buyingOptions:{FIXED_PRICE|AUCTION|CLASSIFIED_AD}` without complaint, and that is what
  every search sends, alongside `itemLocationCountry:GB` and — when the search has a cap —
  `price:[..8000],priceCurrency:GBP`. All spec §5.2 syntax confirmed live; no deviations.
- **A wrong filter name is not an error, so warnings are treated as errors** — an unknown filter
  comes back as HTTP 200 with the filter silently ignored and a note in the response's
  `warnings[]`. A typo would therefore look exactly like a search that found nothing. Every
  warning eBay returns is prefixed with the search's label and added to the scrape summary's
  `errors` list, which the frontend shows as toasts.
- **eBay category ids: 122202 and 14256, but the searches leave `category_id` NULL** —
  `getCategorySuggestions` on the `EBAY_GB` tree (tree id `3`, version 125) returns **122202
  "Vans/Pickups"** (Cars, Motorcycles & Vehicles → Commercial Vehicles) for "vans", "van",
  "commercial vehicles" and "citroen relay van", and **14256 "Campervans & Motorhomes"** for
  "campervan". The seeded searches still carry no category, because a category plus a keyword
  narrows to the intersection and the keywords already do the job; the ids are recorded here so
  a search can be pinned to one from the Searches modal if keyword noise ever becomes a problem.
  These came from the *sandbox* Taxonomy service (which works, and shares the production
  category tree) — worth re-running once production keys land.
- **"For parts or not working" listings are dropped, never stored** — the user is buying a van to
  convert, so a spares-or-repairs listing is noise however cheap it is. The skip tests eBay's
  condition id `7000` *and* the condition text (`for parts`, `not working`, `spares or repair`),
  because vehicle categories do not always carry the id. It is a Python-side skip rather than a
  `conditionIds` filter on the search: a filter would have to enumerate the allowed conditions,
  and any van listed with no condition at all would vanish with it. Skipped items are counted in
  the scrape summary's `skipped` so they are not simply invisible.
- **The year range is filtered in Python, not by `aspect_filter`** — server-side aspect filtering
  needs `category_ids` set on the request *and* the same category repeated inside the filter, and
  it only matches sellers who actually filled the "Year" aspect in. Keyword searches with no
  category (see above) cannot use it at all. So `searches.year_min` / `year_max` are applied
  locally: from the item's `Year` / `Year of Manufacture` aspect where the seller supplied one,
  otherwise from a 4-digit year in the title. **A listing whose year cannot be determined is
  kept** — under-filtering shows one extra van, over-filtering hides the right one. The title
  check runs first so an obviously out-of-range van never costs a detail call.
- **The eBay description becomes `notes`, stripped and capped** — this app has no `description`
  column (notes absorbed it, see below), so the importer converts eBay's HTML to plain text:
  scripts and styles dropped, block tags to line breaks, entities unescaped, blank lines
  collapsed, and a 4,000-character cap with a "(description truncated)" marker. Seller templates
  are frequently tens of kilobytes of markup and none of it is worth storing. Notes stay
  editable, so the pasted text is a starting point, not a fixture.
- **A detail call is spent only on genuinely new items** — spec §5.3's rule, kept: a re-seen item
  updates from the search summary alone. New items get one `GET /item/{itemId}` for the
  description and item aspects, and the aspect mapping (make / model / year / mileage) that
  Amendment 01 §E specifies for the importer is used by the scrape too — the data is already
  in the response, so ignoring it would be perverse.
- **A rescrape touches three columns and no others** — `price_gbp` (only when eBay quotes GBP),
  `last_seen_at`, `updated_at`. Status, notes, custom values, reg, year and mileage are never
  written on an update, which is what makes the Scrape button safe to press at any time. Verified
  by hand-editing all five and rescraping twice.
- **The same van in two searches counts once** — a scrape keeps the item ids it has already
  processed for the run, so a Ducato that matches three saved searches is one `new`, not one
  `new` and two `updated`. Each item commits as it goes, so an interrupted scrape keeps what it
  had already found.
- **Reg extraction lives in `mot.py` now** — it was in `main.py`, and the eBay importer needed the
  same regex. Rather than a second copy (or a new module), `extract_reg()` moved next to
  `clean_reg()` in the module that already owns everything plate-shaped. `main.create_listing`
  and `ebay._finalise_new` both call it, and a newly imported listing with exactly one plate gets
  its MOT cache warmed in the same breath — a DVSA failure there is swallowed, because a listing
  that saved fine must not report as a failed scrape.
- **The importer also accepts a bare item id**, on top of Amendment 01 §E's URL shapes — if the
  pasted text is nothing but 9–13 digits it is treated as the id. Costless, and it saves a
  round-trip when copying an id out of a spreadsheet.
- **The import 409's `detail` is an object, not a string** — `{"message": …, "listing_id": …}`,
  because the frontend has to open the row that already exists. `api()` in app.js unwraps
  `detail.message` for display, so an object detail still reads properly in a toast.
- **A liveness check returns the whole listing** (`{active, message, listing}`) rather than a bare
  flag: the price and the active state can both move, and handing back the row lets the drawer and
  the table re-render from fact instead of guessing what changed. Missing `itemEndDate` counts as
  live — good-till-cancelled listings simply have no end date.
- **The eBay OAuth token is cached with a wall-clock deadline and remembers its environment** —
  same `time.time()` rule as DVSA and for the same reason (macOS freezes the monotonic clock
  during sleep, which served dead tokens for hours). The cache also stores which base URL issued
  the token, so changing `EBAY_ENV` can never reuse the other environment's token, which would
  surface as an inscrutable credentials error. A 401/403 retries once with a forced-fresh token
  before blaming the keyset, and the failure message names the environment it tried.

- **The table is read-only; the drawer is the editor** — this replaces Amendment 01 §A's
  inline-editable cells. The Title link is the only clickable element in a row (it opens the
  original listing); every other cell just displays, and clicking one opens the drawer. Editing
  in two places invited stray clicks that silently changed data.
- **`euro_status` is gone from the app** — every van under consideration is Euro 6, so the column,
  drawer field and manual-entry input were removed, along with the field from `EDITABLE_FIELDS`
  and `db.MIGRATIONS`. Databases created before this keep an unused `listings.euro_status` column.
- **The frontend loads every listing once** (`GET /api/listings?active=-1`) and does all filtering
  and sorting client-side, as §8 requires. `active=-1` means "don't filter on active" — the API
  still honours `active=0`/`active=1`.
- **The MOT summary rides on the listings payload** (replaces the earlier "MOT column is a
  placeholder" decision). `GET /api/listings` runs one extra `SELECT ... FROM mot_cache WHERE
  reg IN (…)` and hangs a compact summary — expiry, result, mileage, defect counts, warning
  flags — on each listing as `mot`. The table renders from that, so the column costs no
  per-row requests, and single-listing responses (create, PATCH, the MOT fetch itself) carry
  the same key so one row can be re-rendered on its own. Attaching happens in the route layer
  (`main.attach_mot`), never in `db.py`; `mot` stays a `DERIVED_KEYS` pseudo-field.
- **Serious-fault flagging uses DVSA's own classification, not AI** — `D`/`M` badges count
  defects typed `DANGEROUS` and `MAJOR` (or carrying `dangerous: true`) across every test
  completed in the last three years, alongside the spec's keyword flags. A fail that was fixed
  on a retest still counts: it's a history signal, not a verdict on the current MOT. Defect
  types the API stopped using (older tests carry `FAIL`, `PRS`, `USER ENTERED`) are bucketed as
  advisories unless flagged dangerous.
- **Reg lookup returns more than Amendment 01 §D asked for** — the response adds `mileage`
  (latest odometer reading), `mot_due` (latest expiry), `colour`, `engine_size` and `fuel_type`
  on top of §D's fields, because the point of the button is to type as little as possible.
  `euro_status` is not in it (that field is gone from the app). Both surfaces fill *only* empty
  inputs, so `mot_due` prefills on a new listing but never overwrites a date the user set.
- **The drawer's MOT panel has no "Check MOT" button — only "Refresh"** (deviates from spec §8.3's
  "Check MOT / Refresh"). Amendment 01 §D's **Look up plate** button was layered onto a drawer that
  already had milestone 5's MOT panel, and the two ended up making the same DVSA call: the lookup
  warms `mot_cache`, so `renderDrawer()` then pulls the full report in for free over
  `GET /api/listings/{id}/mot` and paints it without spending a second call. Pressing Check MOT
  afterwards only re-requested what was already on screen, so the panel now shows the report plus a
  **Refresh** (always `force=true`, the one job the lookup can't do — re-pulling past the 7-day
  cache), hidden until there's a cached check to re-pull. With nothing cached the panel points at
  the lookup button instead. The *table's* MOT column keeps its own Check button: there's no reg
  field out there to hang a lookup off.
- **L/H autofill only works for makes that spell the codes out** — the regexes from §C run over
  the MOT model string, which is `RELAY 35 HVY L4H2 ENT BHDI SS` for Citroën/Peugeot but a bare
  `DUCATO` for Fiat. No match leaves both dropdowns blank rather than guessing.
- **MOT errors are never cached** — a 404 or a credentials failure leaves any existing
  `mot_cache` row alone, and the message is surfaced inline (drawer, manual form) or as a toast
  (the table's Check button). The DVSA access token is cached module-level and reused until a
  minute before it expires, so a run of checks costs one token request.
- **The token deadline is wall-clock (`time.time()`), never `time.monotonic()`** — and there is a
  one-shot retry with a forced-fresh token on 401/403. This looks like the wrong choice and is
  not: macOS stops the monotonic clock while the machine sleeps, so a laptop left running
  overnight woke with monotonic hours behind wall clock, believed its long-dead token was still
  valid, and returned an auth error on *every* new plate until the process was restarted. Cached
  plates kept working throughout, which is what made it look like a credentials problem. The
  token's own expiry is wall-clock, so the deadline that guards it has to be too. NTP steps are
  the tradeoff and they cost at most one extra token fetch; the retry covers them anyway.
- **A 4xx from DVSA does not imply bad credentials** — the gateway returns 403 both for a
  rejected API key *and* for a path it cannot match, so an empty or slash-containing plate
  (`N/A`) used to surface as "check the DVSA_* credentials in .env". `mot.clean_reg()` now
  rejects anything outside `[A-Z0-9]{1,15}` before it reaches the URL, and because the token
  call has already succeeded by the time a fetch runs, the messages name the one credential
  actually in question (401 → `DVSA_SCOPE`, 403 → `DVSA_API_KEY` or quota) instead of all five.
- **A half-failed reg lookup still returns 200, with `warnings`** — MOT and VES are queried
  independently and either can fail alone. The response carries the surviving half plus a
  `warnings` list explaining the missing one, rendered amber under the lookup result. Previously
  those reasons were only used when *both* sources failed and were otherwise discarded, so a
  broken `DVLA_VES_API_KEY` was indistinguishable from one that was never configured.
- **`mot_due` is hand-entered, separate from the MOT lookup** — a `date` input in the drawer's MOT
  section and on manual entry, stored as an ISO `YYYY-MM-DD` string in `listings.mot_due` and
  validated server-side (a real calendar date, or null). It gets its own sortable **MOT due**
  column, shown as `14 Mar 2027` and in red once the date has passed. The DVSA lookup prefills it
  from the real expiry when the field is empty, but never overwrites a value the user set — and
  the MOT column beside it always shows what DVSA says, independently of this field.
- **`description` is gone — notes absorbed it** — one editable free-text field instead of a
  pasted-in read-only block plus a notes box. The manual-entry form's big textarea now writes
  straight to `notes`, the drawer's Description panel is deleted, `description` is out of
  `EDITABLE_FIELDS` (a payload containing it 400s), reg extraction on create scans title + notes,
  and the column is dropped from `SCHEMA` and from `data/vancrm.db`. Existing descriptions were
  merged into notes first. The eBay importer follows the same rule — it writes the item
  description into `notes` (stripped of HTML and capped; see above).
- **Notes autosave flushes rather than drops** — `debounce()` exposes `.flush()`, and the notes
  textarea flushes on blur, on drawer close and on `beforeunload` (that last one with
  `fetch(keepalive)`). Before this, a refresh within 800ms of the last keystroke lost the note.
- **Notes preview is 5 words** (`truncateWords`), with the full text on hover via `title` and a
  160px `text-overflow: ellipsis` cap, so a long note can't stretch the row.
- **Repeated free-text fields suggest what's been typed before** — Make, Model, Year, Location and
  Seller carry `suggest: True` in `FIELD_SPECS`, which gives them a `<datalist>` dropdown of the
  distinct values already on the listings, in the drawer and on manual entry. They stay free text:
  the list is a shortcut, never a constraint, so a new make can still be typed in. The values come
  from `state.listings` in the browser (the frontend already holds every listing) rather than a new
  endpoint, and are rebuilt each time the drawer or the manual form opens. Custom properties don't
  get this — a repeated-value custom field is what a `select` property is for.
- **Custom property keys are slugified from the label and never change**, so renaming a column keeps
  existing values. Renaming to a label that collides with an existing key is rejected at creation time.
- **`custom` merge**: `PATCH {"custom": {"k": v}}` merges; `{"custom": {"k": null}}` (or an empty
  string) removes the key. Unknown keys are rejected with 400.
- **One field registry, `main.FIELD_SPECS`** — the table, the drawer and the manual-entry form
  used to keep three hand-maintained field lists, and they had drifted (`seller_name` and `url`
  were editable but missing from the table; `image_urls` and `is_active` were editable via the
  API with no control anywhere). They now all build from `GET /api/schema`, which serves the
  registry; `EDITABLE_FIELDS` is derived from it too. A startup check refuses to boot if a
  `listings` column is missing from the registry and from `UNMANAGED_COLUMNS`, so a new
  migration can't silently skip the UI.
- **Visibility is opt-out, per surface.** A registry field with no `in_table` / `in_drawer` /
  `section` shows up in *both* the table and the drawer's Details section — adding a field is
  still a one-line change. Hiding it from one surface without hiding it from the other is
  `in_table: False` or `in_drawer: False`. Currently hidden: `is_active` from the drawer (a
  listing is active from the moment it's added; the column defaults to 1), `mot` from the drawer
  (which has its own MOT panel), `thumb` from the drawer (which has its own image strip), and
  `url` / `image_urls` from the table (the title cell and thumbnail carry them).
- **`source` is editable.** It was create-only originally — a listing's origin looked like a fact
  about where it came from, not a preference — but a mis-set source on a manual entry was then
  unfixable, so PATCH now accepts it. `POST` still defaults it to `facebook` when omitted.
- **`source` is free text with suggestions, not a fixed `ebay`/`facebook`/`manual` enum.** It's
  the same `suggest: True` pattern as Make/Model/Location/Seller: a `<datalist>` of values already
  used, still accepting anything typed, so a real source like "Gumtree" or "Autotrader" doesn't
  get forced into "manual". The table badge keeps its dedicated colour and shortened label
  (`eBay`/`FB`/`Manual`) for the three known values and just shows the raw text for anything else.
  `listings.source` used to have a `CHECK (source IN (...))` at the DB level; `db._migrate_drop_source_check`
  rebuilds the table (SQLite can't drop a CHECK via `ALTER TABLE`) the first time an existing
  `data/vancrm.db` boots against this code, copying every row across in one transaction.
- **PATCH allowlist** covers only user-editable fields — `id`, `external_id` and all
  timestamps cannot be set through the API.
- **Reg extraction on manual add** runs server-side only (one implementation, not two): if `reg` is
  left blank, the regex runs over title + notes and stores a match only if exactly one distinct
  plate is found.
- **Sandbox/production eBay switching** is via `EBAY_ENV`: it selects the token endpoint and the
  Browse API base together, and an unrecognised value falls back to production rather than
  failing to start.
- **Saved searches carry a price floor (`min_price`) as well as a cap** — the first real
  production scrape (2026-08-12) showed keyword search alone is not enough: "peugeot boxer van"
  matches a £29 heater resistor as readily as an actual van, and "renault master van" pulled in
  football cards and CDs on the strength of a surname ("van Dijk", "van Persie") or an album title
  containing the word. All under a few hundred pounds, so a floor screens them out at the API
  level rather than in Python. `_filters()` now builds `price:[min..max]` (either end optional,
  same as before) instead of always anchoring at zero; all 5 seeded searches run with
  `min_price=3000, max_price=7000`. This mirrors the existing max-price design exactly — same
  column pattern, same migration, same UI row — so see the `buyingOptions` entry above for why the
  filter is sent as `,`-joined `filter=` terms rather than several query params.
- **`year_min`/`year_max` are enforced now, not just plumbed** — the columns and the Python-side
  filter (see above) shipped with milestone 4, but no saved search actually set a floor, so
  listings back to 1994 were coming through undetected until a manual audit of `year` values
  turned them up. All 5 seeded searches now run with `year_min=2016`. Worth remembering: setting
  a floor only affects *new* items in future scrapes (`upsert_item` only checks `_year_allowed` on
  the not-already-seen path) — it does not retroactively touch what's already in `data/vancrm.db`,
  so a tightened filter needs a manual `DELETE ... WHERE year < N` alongside it if the backlog
  should shrink too, same as the min_price cleanup above.
- **The Scrape button polls for progress instead of just showing a static label** —
  `upsert_item` spends one eBay detail call per genuinely new item, so a large scrape (hundreds of
  new listings) can run for several minutes with the button simply disabled and reading
  "Scraping…" the whole time, which reads as hung. `ebay.PROGRESS` is a plain module-level dict
  (`running`/`processed`/`label`/`started_at` — one user, one scrape at a time, so no locking)
  updated as each item is processed; `GET /api/scrape/progress` exposes it, and the button polls
  it every second while a scrape is in flight, showing `Scraping… (N processed, Ns)`. Killing the
  server (or the browser navigating away) mid-scrape still aborts the in-flight request — the
  per-item commits mean whatever was already processed survives, but a search that was mid-page
  does not resume; it needs a fresh scrape.

## Notes

- Secrets live only in `.env`, which is gitignored along with `data/`. Nothing logs credentials.
- History lives at <https://github.com/Messinki/van-crm> (`.env` and `data/` never leave this machine).
