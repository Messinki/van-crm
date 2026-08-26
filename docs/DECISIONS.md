# Decisions

Append-only. Never edit or delete an old entry — write a new one that supersedes it.
Newest at the bottom. Add the entry *before* implementing the decision.

Format:

```
## D-001 — Short title (YYYY-MM-DD)
Context: one or two lines on the problem.
Decision: what we chose.
Why: the reason, including what was rejected.
Supersedes: D-007   (omit if none)
```

---

*D-001 through D-036 were migrated on 2026-08-26 from the old README's "Decisions made"
section. Most original dates were not recorded; dates are given where known. The fuller
original prose lives in the git history of `README.md`. Entries marked **Do not regress**
describe fixes for real failures that look like refactoring targets — leave them alone.*

## D-001 — Always send the `buyingOptions` filter (2026-08-12)
Context: eBay Browse search returns only `FIXED_PRICE` listings unless `buyingOptions`
is filtered explicitly, and most UK vans are auctions or classified ads.
Decision: every search sends `buyingOptions:{FIXED_PRICE|AUCTION|CLASSIFIED_AD}`,
alongside `itemLocationCountry:GB` and the price range filter.
Why: omitting it silently hides the majority of vans. Confirmed supported live.
**Do not regress.**

## D-002 — eBay warnings are treated as scrape errors (2026-08-12)
Context: an unknown filter name comes back as HTTP 200 with the filter silently ignored
and a note in `warnings[]` — a typo looks exactly like a search that found nothing.
Decision: every warning is prefixed with the search's label and added to the scrape
summary's `errors`, which the frontend shows as toasts.
**Do not regress.**

## D-003 — Category ids recorded but not used (2026-08-26, migrated)
Context: `getCategorySuggestions` on the EBAY_GB tree returns 122202 "Vans/Pickups" and
14256 "Campervans & Motorhomes" (ids came from the sandbox Taxonomy service, which
shares the production tree — a production re-run is still pending, see STATUS).
Decision: seeded searches leave `category_id` NULL; the ids are recorded so a search
can be pinned from the Searches modal if keyword noise becomes a problem.
Why: category + keyword narrows to the intersection, and the keywords already work.

## D-004 — "For parts or not working" listings are dropped, never stored (2026-08-12)
Context: a spares-or-repairs van is noise however cheap — the user is buying a
conversion base.
Decision: skip in Python on condition id `7000` *or* condition text ("for parts",
"not working", "spares or repair"); count skips in the scrape summary's `skipped`.
Why: a `conditionIds` search filter would have to enumerate allowed conditions, and a
van listed with no condition at all would vanish with it.
**Do not regress.**

## D-005 — Year range is filtered in Python, unknown years are kept (2026-08-26, migrated)
Context: server-side `aspect_filter` needs `category_ids` set (ours are NULL, D-003)
and only matches sellers who filled the Year aspect in.
Decision: `year_min`/`year_max` apply locally — from the item's Year aspect, else a
4-digit year in the title (checked first, so an out-of-range van never costs a detail
call). A listing whose year can't be determined is kept.
Why: under-filtering shows one extra van; over-filtering hides the right one.

## D-006 — Saved searches carry price and year floors (2026-08-12)
Context: the first production scrape showed keyword search alone pulls in a £29 heater
resistor, football cards matching "van Dijk", and vans back to 1994.
Decision: `_filters()` builds `price:[min..max]` (either end optional); all 5 seeded
searches run with `min_price=3000, max_price=7000, year_min=2016`.
Why: cheap junk screens out at the API level; the year floor via D-005. Both floors
apply only to *new* items in future scrapes — tightening a range does not retroactively
touch rows already in `data/vancrm.db`; that needs a manual cleanup pass alongside it.

## D-007 — The eBay description becomes `notes`, stripped and capped (2026-08-26, migrated)
Context: there is no `description` column (D-028), and seller templates are tens of
kilobytes of markup.
Decision: HTML → plain text (scripts/styles dropped, block tags to line breaks,
entities unescaped, blank lines collapsed), capped at 4,000 chars with a
"(description truncated)" marker, written to `notes` — which stays editable.

## D-008 — A rescrape touches three columns and no others (2026-08-26, migrated)
Context: the Scrape button must be safe to press at any time.
Decision: an already-seen item updates only `price_gbp` (and only when eBay quotes
GBP), `last_seen_at`, `updated_at`. Status, notes, custom values, reg, year and mileage
are never written on update. Verified by hand-editing all and rescraping twice.

## D-009 — One detail call, only for genuinely new items (2026-08-26, migrated)
Context: `GET /item/{itemId}` costs one call per item and is the slow part of a scrape.
Decision: re-seen items update from the search summary alone; new items get one detail
call for the description and item aspects. The aspect mapping (make/model/year/mileage)
is shared between scrape and importer.

## D-010 — The same van in two searches counts once (2026-08-26, migrated)
Context: one Ducato can match three saved searches in a single run.
Decision: a scrape keeps the item ids it has processed this run — one `new`, not one
`new` plus two `updated`. Each item commits as it goes, so an interrupted scrape keeps
what it already found (a mid-page search does not resume; it needs a fresh scrape).

## D-011 — Importer accepts a bare item id; the 409 detail is an object (2026-08-26, migrated)
Context: Amendment-era URL shapes plus practical paste targets.
Decision: pasted text of nothing but 9–13 digits is treated as the item id. A URL
already in the table returns 409 with `{"message": …, "listing_id": …}` so the frontend
opens the existing row instead of duplicating; `api()` in app.js unwraps
`detail.message` for toasts.

## D-012 — A liveness check returns the whole listing (2026-08-26, migrated)
Context: price and active state can both move on a check.
Decision: `POST /api/listings/{id}/check` returns `{active, message, listing}` so the
drawer and table re-render from fact. Missing `itemEndDate` counts as live —
good-till-cancelled listings simply have no end date.

## D-013 — The bulk liveness sweep re-checks active rows only, returns counts (2026-08-26, migrated)
Context: an ended listing never comes back to life, and the frontend reloads listings
anyway.
Decision: `check-all` skips inactive rows, returns `{checked, ended, unchanged,
errors}`, commits per listing (interruptible), collects one row's error and carries on,
and refuses a concurrent sweep with 409.

## D-014 — Token deadlines are wall-clock `time.time()`, never `time.monotonic()` (2026-08-26, migrated)
Context: macOS stops the monotonic clock during sleep. A laptop left overnight woke
with monotonic hours behind wall clock, believed its dead DVSA token was valid, and
returned an auth error on every new plate until restart — while cached plates kept
working, which made it look like a credentials problem.
Decision: both eBay and DVSA token caches use wall-clock deadlines; the eBay cache
also remembers which environment issued the token so flipping `EBAY_ENV` can never
reuse the wrong one; a 401/403 retries once with a forced-fresh token.
Why: the token's own expiry is wall-clock, so the guard must be too. NTP steps cost at
most one extra fetch and the retry covers them.
**Do not regress.**

## D-015 — Plates are validated before they reach the DVSA URL (2026-08-26, migrated)
Context: DVSA's gateway answers 403 both for a rejected API key and for a path it
cannot match, so an empty or slash-containing plate ("N/A") surfaced as "check the
DVSA_* credentials".
Decision: `mot.clean_reg()` rejects anything outside `[A-Z0-9]{1,15}` before the URL is
built; and since the token call has succeeded by fetch time, error messages name the
one credential in question (401 → `DVSA_SCOPE`, 403 → `DVSA_API_KEY` or quota).
**Do not regress.**

## D-016 — MOT errors are never cached (2026-08-26, migrated)
Context: a 404 or credentials failure must not poison the 7-day cache.
Decision: failures leave any existing `mot_cache` row alone and surface inline or as a
toast. The DVSA access token is cached module-level until a minute before expiry, so a
run of checks costs one token request.

## D-017 — Fault badges use DVSA's own classification, not AI (2026-08-26, migrated)
Context: the spec's keyword flags alone missed the obvious signal DVSA already provides.
Decision: `D`/`M` badges count defects typed `DANGEROUS`/`MAJOR` (or `dangerous: true`)
across tests in the last three years. A fail fixed on retest still counts — it's a
history signal, not a verdict. Legacy types (`FAIL`, `PRS`, `USER ENTERED`) bucket as
advisories unless flagged dangerous.

## D-018 — The MOT summary rides on the listings payload (2026-08-26, migrated)
Context: a per-row MOT request would cost N calls to render the table.
Decision: `GET /api/listings` runs one `SELECT … FROM mot_cache WHERE reg IN (…)` and
hangs a compact summary on each listing as `mot`; single-listing responses carry the
same key. Attaching happens in the route layer (`main.attach_mot`), never in `db.py`;
`mot` stays a `DERIVED_KEYS` pseudo-field.

## D-019 — Reg lookup returns more than asked, fills only empty fields (2026-08-26, migrated)
Context: the point of the Look up button is to type as little as possible.
Decision: the response adds `mileage`, `mot_due`, `colour`, `engine_size`, `fuel_type`
on top of make/model/year and L/H codes. Both surfaces (drawer, manual form) fill
*only* empty inputs — a value the user typed is never overwritten. The lookup also
warms `mot_cache`, so a new listing's MOT column fills without a separate Check.

## D-020 — A half-failed reg lookup still returns 200, with `warnings` (2026-08-26, migrated)
Context: MOT and VES are queried independently and either can fail alone; a broken
`DVLA_VES_API_KEY` was indistinguishable from one never configured.
Decision: the response carries the surviving half plus a `warnings` list explaining
the missing one, rendered amber under the lookup result.

## D-021 — The drawer's MOT panel has Refresh only, no Check MOT (2026-08-25)
Context: Look up plate and Check MOT made the same DVSA call — the lookup warms
`mot_cache`, so the panel's report renders for free afterwards.
Decision: the panel shows the report plus a **Refresh** (always `force=true`, the one
job the lookup can't do), hidden until something is cached; with nothing cached it
points at the lookup button. The *table's* MOT column keeps its own Check button —
there's no reg field out there to hang a lookup off.

## D-022 — L/H autofill only works for makes that spell the codes out (2026-08-26, migrated)
Context: the MOT model string is "RELAY 35 HVY L4H2 …" for Citroën/Peugeot but a bare
"DUCATO" for Fiat.
Decision: no regex match leaves both dropdowns blank rather than guessing.

## D-023 — Reg extraction lives in `mot.py`, runs server-side only (2026-08-26, migrated)
Context: `main.create_listing` and the eBay importer both need the same regex.
Decision: `extract_reg()` sits next to `clean_reg()`; one implementation. On manual add
with a blank reg it scans title + notes and stores a match only if exactly one distinct
plate is found. A newly imported listing with one plate gets its MOT cache warmed in
the same breath — a DVSA failure there is swallowed, because a listing that saved fine
must not report as a failed scrape.

## D-024 — `mot_due` is hand-entered, separate from the MOT lookup (2026-08-26, migrated)
Context: the user tracks a due date independently of what DVSA reports.
Decision: a `date` input stored as ISO `YYYY-MM-DD` in `listings.mot_due`, validated
server-side, with its own sortable column (red once past). The lookup prefills it when
empty but never overwrites; the MOT column beside it always shows what DVSA says.

## D-025 — The table is read-only; the drawer is the editor (2026-08-26, migrated)
Context: inline-editable cells (the original design) invited stray clicks that
silently changed data.
Decision: the Title link is the only clickable element in a row (opens the original
listing); clicking anywhere else opens the drawer, where all editing happens.

## D-026 — Reject is the one in-row action, and it un-rejects too (2026-08-26, migrated)
Context: a scrape drops dozens of vans at once; rejecting them one drawer-open at a
time was the slow part.
Decision: a narrow `reject` column of Reject / Un-reject buttons (a `DERIVED_KEYS`
pseudo-field), mirrored in the drawer's actions row. It only ever writes `status`.
Un-rejecting returns the listing to `new` (the previous status isn't stored; `new`
means "not judged yet"). Nothing is deleted or hidden — a rejected row stays, dimmed,
which is what makes the undo discoverable.

## D-027 — `euro_status` is gone from the app (2026-08-26, migrated)
Context: every van under consideration is Euro 6.
Decision: column, drawer field and manual input removed. Databases created before this
keep an unused `listings.euro_status` column.

## D-028 — `description` is gone; notes absorbed it (2026-08-26, migrated)
Context: one editable free-text field beats a pasted read-only block plus a notes box.
Decision: the manual form's textarea writes to `notes`; `description` is out of
`EDITABLE_FIELDS` (payloads containing it 400) and dropped from the schema. The eBay
importer follows the same rule (D-007).

## D-029 — Notes autosave flushes rather than drops (2026-08-26, migrated)
Context: a refresh within 800ms of the last keystroke used to lose the note.
Decision: `debounce()` exposes `.flush()`; the notes textarea flushes on blur, drawer
close and `beforeunload` (that one via `fetch(keepalive)`).

## D-030 — Repeated free-text fields suggest previous values (2026-08-26, migrated)
Context: Make, Model, Year, Location, Seller repeat across listings.
Decision: `suggest: True` in `FIELD_SPECS` gives a `<datalist>` of distinct values
already used, built client-side from `state.listings` — a shortcut, never a
constraint. Custom properties don't get this; a repeated-value custom field is what a
`select` property is for.

## D-031 — `source` is editable free text with suggestions (2026-08-26, migrated)
Context: `source` was a create-only `ebay`/`facebook`/`manual` enum with a DB CHECK; a
mis-set source was unfixable and "Gumtree" got forced into "manual".
Decision: PATCH accepts it, it uses the D-030 suggest pattern, and
`db._migrate_drop_source_check` rebuilds the table on first boot against old data
(SQLite can't drop a CHECK via ALTER). POST still defaults to `facebook`. The table
badge keeps dedicated colours for the three known values.

## D-032 — One field registry, enforced at startup (2026-08-26, migrated)
Context: the table, drawer and manual form kept three hand-maintained field lists, and
they had drifted (editable fields missing from the table; `is_active` editable with no
control anywhere).
Decision: everything builds from `main.FIELD_SPECS` via `GET /api/schema`;
`EDITABLE_FIELDS` derives from it; `check_registry_covers_schema()` refuses to boot on
drift. Visibility is opt-out per surface, so adding a field is one line.

## D-033 — Custom property keys are immutable; `custom` PATCHes merge (2026-08-26, migrated)
Context: renaming a column must not orphan existing values.
Decision: keys are slugified from the label at creation and never change; a rename
colliding with an existing key is rejected. `PATCH {"custom": {"k": v}}` merges;
`null` (or empty string) removes the key; unknown keys 400.

## D-034 — Long-running buttons poll a progress endpoint (2026-08-26, migrated)
Context: a large scrape (one detail call per new item, D-009) runs for minutes; a
button stuck on "Scraping…" reads as hung.
Decision: `ebay.PROGRESS` and `ebay.CHECK_PROGRESS` are plain module-level dicts (one
user, one operation of each kind at a time, no locking), exposed at
`GET /api/scrape/progress` and `GET /api/listings/check-all/progress`; the buttons poll
every second, showing `Scraping… (N processed, Ns)` / `Checking… (n/total)`. Separate
dicts so a sweep and a scrape never overwrite each other's counters.
**Do not regress.**

## D-035 — The frontend loads every listing once (2026-08-26, migrated)
Context: single user, a few hundred rows.
Decision: `GET /api/listings?active=-1` ("don't filter on active"), then all filtering
and sorting client-side; mutations re-render from `state`.

## D-036 — AI enrichment is field extraction, a deliberate scope deviation (2026-08-12)
Context: v1 scope said "no AI scoring or summarising", but size codes, VAT status and
red flags live only in listing prose.
Decision: milestone 4b (not yet built — spec condensed in STATUS) has a cheap model
via OpenRouter return structured facts only (size code, VAT status, mileage, flag
tags); all judgement (VAT maths, mileage-vs-MOT comparison, auto-archiving) stays
deterministic Python. Opt-in via `OPENROUTER_API_KEY`; the app runs identically
without it. AI-derived values only ever fill empty fields.

## D-037 — Frontend rebuilt on Vite + React + TypeScript (2026-08-26)
Context: `app/static/app.js` reached ~2,000 lines in one file with hand-rolled
popovers, filters and state sync; every UI feature was getting more expensive and
harder to review. The "no npm, no build step, no React" rule was written for a
smaller app.
Decision: the frontend is rebuilt as a Vite + React + TypeScript app in `frontend/`,
with TanStack Table v8 (listings table), TanStack Query v5 (API access, incl. the
D-034 progress polling), and Tailwind CSS + shadcn/ui (styling and primitives).
TypeScript is deliberate: the compiler is the automated reviewer for AI-written code.
The Python backend, SQLite database, API surface and port 8321 do not change.
Why: component model and typed API layer over a 2,000-line file; rejected staying
vanilla (cost of each feature kept rising) and heavier options (Next.js — no server
rendering needed for a localhost app). Plan lives in `docs/FRONTEND_REFACTOR.md`
until it lands.
Supersedes: the no-npm/no-React clause of the fixed-stack rule (AGENTS.md); backend
stack remains fixed.

## D-038 — Built frontend is served from `app/static/dist/`, gitignored (2026-08-26)
Context: the React app needs a build step, but the app must keep working from a plain
`uvicorn` start on port 8321 so bookmarks survive.
Decision: `npm run build` in `frontend/` emits to `app/static/dist/`, which FastAPI
serves at `/`. The directory is build output and is gitignored; dev uses Vite's dev
server on :5173 proxying `/api` to :8321.
Why: keeps the single-process, single-port usage identical to today while keeping
generated files out of history.

## D-039 — Filtering and ranking are a plain selector, not TanStack filter fns (2026-08-26)
Context: the refactor plan sketched porting `matchesCondition`/`distinctValues` into
TanStack Table custom filter fns. But rank scores are min–max normalised over the
rows currently on screen, so the sort order depends on the filtered set — inside
TanStack's pipeline that is a circular dependency (sortingFn needs the filtered
row model that is being built).
Decision: the ported `visibleListings()` logic (property conditions, status chips,
title search, show-inactive, rank scoring and ordering) lives in plain typed
functions (`lib/filtering.ts`, `lib/ranking.ts`) selected via `useMemo`; TanStack
Table receives the final rows and owns the column model, column visibility, header
and cell rendering. Behaviour parity with the old UI is the phase's acceptance
test, and this keeps the ported logic byte-comparable to app.js.
Why: parity beats framework idiom; rejected wedging relative scoring into
sortingFns (hidden cache, render-order coupling).
