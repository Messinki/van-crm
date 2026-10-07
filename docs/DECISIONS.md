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

## D-040 — Detail-view fields are uncontrolled inputs keyed on their saved value (2026-08-27)
Context: the old drawer's fields were plain DOM inputs that saved on `change` (i.e.
on blur) and then re-rendered the whole drawer from the row the PATCH handed back.
The React port needs the same behaviour without either wiring per-field controlled
state (a second copy of the listing to keep in sync) or re-mounting every field
whenever any one of them saves.
Decision: each field renders as an uncontrolled input with `defaultValue` and a
`key` set to its own current value, saving through the `useUpdateListing` mutation
on change. A field remounts only when its own value actually changed — after its
own save, or when a plate lookup fills it in — so a lookup that fills six fields
does not disturb the one being typed in. Notes are the exception: a controlled
textarea with an 800ms debounce, flushed on blur and by the dialog before it
closes. The React Query cache is the single copy of the listing.
Why: parity with the drawer's save-on-blur semantics with no duplicated state;
rejected controlled inputs with a sync effect (two sources of truth for every
field) and a single `key` on the whole form (loses in-progress typing elsewhere).

## D-041 — The detail popup is a cursor over the table's current order (2026-10-04)
Context: Phase 6 asks for left/right navigation in the popup, and Harry wants
Reject in the popup to move straight on to the next listing, in whatever view
(status chips, filters, rank or sort) is active — e.g. working through the
Rejected chip view with Un-reject.
Decision: the filtered/sorted rows are computed once in `App` (`useTableRows`)
and both the table and the popup read them; ←/→ buttons and arrow keys step
through that order (keys ignored while focus is in a text field or open menu).
Reject *and* Un-reject in the popup move to the listing below the current one as
the order stood at the click — or above it at the end — and close the popup when
nothing is left. A listing the filters hide still opens, with no neighbours.
The table title is plain text; the original listing opens only from the popup.
Why: one rule covers every view, because toggling reject always drops the row out
of the view it was in. The body is keyed on listing id so the uncontrolled fields
(D-040) remount per listing and the notes debounce flushes on the way out.
Rejected: a hard-coded "next non-rejected listing" (wrong in the Rejected view)
and advancing before the save confirms (a failed save would silently move on).

## D-042 — Gallery mode splits the popup; pinch zooms the photo (2026-10-04)
Context: Phase 6 planned a bigger default thumbnail and a click-to-gallery
layout. Harry mainly wants the gallery to read number plates, zooming with the
Mac trackpad.
Decision: the default popup keeps the small image strip — no bigger thumbnail.
Clicking a strip photo widens the popup into two halves: the gallery on the left
and the normal, still-editable fields scrolling on the right, so a plate can be
read and typed straight into Reg. In gallery mode ←/→ change photo (the header
‹ › buttons still change listing), and Esc or a click on an unzoomed photo goes
back to the default layout. Gallery mode stays on when moving to another
listing, starting at its first photo. Pinch zooms around the pointer (Chrome and
Firefox report it as ctrl+wheel, Safari as gesture events — both are handled);
when zoomed, drag or two-finger scroll pans; changing photo resets the zoom. No
double-click zoom.
Why: reading a plate and entering it is one task, so the fields stay beside the
photo; the bigger thumbnail wasn't wanted once the gallery existed.
Rejected: a gallery that takes over the whole popup; arrow keys that keep
changing listing in gallery mode.

## D-043 — "Plus VAT" is a flag; the VAT price is derived everywhere (2026-10-04)
Context: some vans are advertised ex-VAT. Harry wants a Plus VAT toggle beside
the price so the price he sees, filters on and ranks by is what he'd actually
pay (listed × 1.2), with a visible cue wherever that price shows.
Decision: a new `vat_status` column (`plus_vat` or empty — the same field and
value milestone 4b's AI extraction will fill) and a toggle beside the price in
the popup and the manual form. `price_gbp` stays the listed price. The frontend's
`effectivePrice()` applies × 1.2 when flagged, and every price read goes through
it: the table cell (with a +VAT badge, listed price in the tooltip), sorting,
the price filter, the rank factor. The popup's price box keeps the listed figure,
with the inc-VAT total shown next to the toggle.
Why: scrapes and Check live overwrite `price_gbp` with eBay's figure, so a stored
× 1.2 price would silently revert on the next refresh (or double-count if
reapplied). Deriving it means every refresh is recalculated for free, and
toggling off is exact.
Rejected: multiplying the stored price; a separate stored "real price" column.

## D-044 — The table's +VAT badge is also the toggle (2026-10-04)
Context: Harry couldn't find the Plus VAT toggle (D-043) and wants to set it
wherever the price appears, the table included.
Decision: every priced table cell carries a +VAT chip — solid amber when the
listing is flagged, faint and dashed when not. Clicking it flips `vat_status`
without opening the popup. The popup and manual form keep their toggles.
Why: an always-visible chip is findable, and keeps prices aligned since the
chip is the same width either way. Rejected: a chip that only appears on hover
(the same discoverability problem).
Supersedes: D-043 (the table's badge only — the rest stands)

## D-045 — ↑/↓ change listing, ←/→ change photo (2026-10-04)
Context: in the popup, ←/→ meant "listing" by default but "photo" in gallery mode
(D-041, D-042), so the same key did different things. Harry wants one meaning each.
Decision: ↑/↓ always step through listings, in both layouts; ←/→ only ever change
photo, so outside gallery mode they do nothing. The header listing buttons show
up/down chevrons to match. Same exceptions as before: keys are ignored while focus
is in a text field, select or open menu.
Why: a fixed key per axis needs no mode to remember. Cost: ↑/↓ no longer
keyboard-scroll the popup — the mouse or trackpad still does.
Supersedes: D-041 (the arrow keys and button icons only), D-042 (←/→ in gallery mode stands)

## D-046 — The gallery layout is the only popup layout (2026-10-04)
Context: the popup had two layouts — a narrow default with the image strip, and
gallery mode (D-042) opened by clicking a strip photo. Harry likes the gallery
layout and wants it to be the only one.
Decision: the popup always opens split — the photo on the left, the editable
fields scrolling on the right — starting at the first photo. There is no mode to
leave: the "Close gallery" button, Esc-leaves-gallery and click-an-unzoomed-photo-
to-go-back are gone, so Esc closes the popup. The strip stays, to jump to a photo,
and ←/→ always change photo. A listing with no photos shows a "No photos" panel in
the left half, so the popup keeps its size while flicking through listings.
Pinch zoom, panning and "Full size ↗" are unchanged.
Why: one layout means no mode to remember or toggle; the fixed size stops the
popup jumping when the next listing has no photos.
Rejected: falling back to the narrow layout for photo-less listings.
Supersedes: D-042 (the default layout and the ways out of gallery mode), D-045 (←/→ doing nothing outside gallery mode)

## D-047 — Distance to the closest of several homes, computed in the browser (2026-10-04)
Context: Harry wants to rank vans by how far they are from several "home"
locations, any of which would do for a viewing or collection.
Decision: homes live in their own table (label, postcode, coordinates, enabled,
position). Each van shows one figure — straight-line whole miles to the closest
*enabled* home — with a pill naming that home, in the table, the popup and the
map card alike. Distance is a registry pseudo-field computed client-side from
stored coordinates, so it sorts, filters and ranks like any number, and toggling
a home re-sorts instantly.
Why: straight-line is plenty for "is this worth the trip" and needs no routing
service. Computing in the browser follows the inc-VAT price (D-043): nothing
stored goes stale when homes change. Rejected: road distance or drive time;
showing every home's distance in the popup (Harry wants the popup to match the
table); per-home weighting; storing distance per listing.

## D-048 — Geocode with postcodes.io and store coordinates on the listing (2026-10-04)
Context: listing locations are free text — eBay gives `Town, OUTCODE ***`, manual
entries are mostly town names — and distance needs coordinates.
Decision: `app/geo.py` turns a location into coordinates through postcodes.io
(full postcode, then outcode, then place-name search), called from the backend
with `httpx`. Results go in new `lat`/`lng` columns plus `geocoded_from`, the
string they came from. A lookup runs on create, on a location change, and once
per scrape/import for anything new or changed. "Not found" is remembered, so it
isn't retried; a network failure isn't, so it is. A failed lookup never fails a
save or a scrape.
Why: postcodes.io is free, keyless, UK-only open data, and covers all three
kinds of input we have. Storing means one lookup per van, not per page load,
and the maps work instantly. Rejected: Nominatim (1 request/second, and
built for worldwide addresses rather than UK postcodes); geocoding in the browser (repeated work, and a third-party call
from every page view).

## D-049 — Maps with Leaflet + react-leaflet on OpenStreetMap tiles (2026-10-04)
Context: two map views are wanted — one van's location, and every visible van —
and the frontend stack is fixed (D-037).
Decision: add `leaflet`, `react-leaflet` (v5, for React 19) and
`react-leaflet-cluster` to the fixed frontend stack, using the standard OSM tile
server with its required attribution. Pins are plain coloured `divIcon`s: one
colour for vans, another for homes.
Why: Leaflet is the simplest well-documented map library, needs no API key,
and OSM's tile policy allows light interactive personal use. Clustering stops
vans that share an outcode stacking invisibly. Rejected: MapLibre GL +
OpenFreeMap (nicer vector maps, but a heavier library for no feature we need);
Google/Mapbox (keys and billing accounts).
Supersedes: D-037 (the fixed frontend library list only — the rest stands)

## D-050 — Rank same-named places; a geocoding pass stops at the first network failure (2026-10-04)
Context: postcodes.io's place search returns every settlement sharing a name, in
no useful order — "Newport" lists an Essex village first and the Welsh city
tenth — and the plan said take the first. Separately, a fill pass over hundreds
of listings with the network down would sit out one timeout per listing.
Decision: ask for 20 places and pick by exact name match, then a county or
region matching the text after the first comma, then City over Town over
Village over anything else, then postcodes.io's order. A fill pass stops at the
first network failure and counts the rest as failed (retried next pass). A
lookup that fails on a location edit clears the stored coordinates, so a van
never shows its old place against its new location.
Why: with this ranking all 217 distinct location strings in the table placed
sensibly, bare "Newport" included; "first result" put Newport in Essex.
Rejected: dropping place search for manual entries (they're mostly town names).

## D-051 — "Price means effectivePrice()" is a standing rule (2026-10-07)
Context: D-043 routes every price read through `effectivePrice()`, but only by
convention. An audit found every compare, sort, filter, rank and map read already
did; the one stray was the popup/form's "= £x inc. VAT" line, which repeated the
× 1.2 sum itself. Harry wants any later price feature to get this right without
anyone remembering D-043.
Decision: a one-line rule in AGENTS.md — anything that compares, sorts, ranks,
filters, totals or shows the price you'd pay uses `effectivePrice()` (or
`sortValue(listing, 'price_gbp')`, which calls it), never `price_gbp` directly —
plus a pointer comment beside `price_gbp` in `FIELD_SPECS`. The few deliberate
reads of the listed figure (the popup's price box, the table tooltip's "Listed at
£x + 20% VAT") carry a comment saying so. The inc-VAT line now calls
`effectivePrice()` too, so the × 1.2 sum lives in one function.
Why: a rule in the file every session reads is cheaper than another audit.
Rejected: having the API send a derived `effective_price` field — the backend
never compares prices (filtering, sorting and ranking run in the browser, D-039),
so it would be a second copy of the sum for the frontend to keep in step.

## D-052 — Popup text boxes save on commit, not per keystroke (2026-10-07)
Context: D-040 meant the popup's boxes to save on blur like the old drawer, but
React's `onChange` fires on every keystroke. Each letter PATCHed, the cache
updated, the box's `key` (its saved value) changed and it remounted — so focus was
lost after one letter in Make, Model, Location, Price, Link, custom properties and
every other text/number/date box.
Decision: the popup's text, number and date boxes (and the image-URL textarea, the
plate and text custom properties) hold an edit in progress and save it on commit:
on blur, on Enter (not in a textarea), straight away when a value is *picked*
rather than typed — a datalist suggestion, a number spinner, a date picker, i.e. an
`input` event that isn't an `InputEvent` (Chrome) or has `inputType`
`insertReplacementText` (Safari, Firefox) — and on unmount, which covers Esc,
click-outside and ↑/↓ or the chevrons moving to another listing (the body is keyed
on the listing id, so its fields unmount and save against the listing being left;
the notes flush of D-029 works the same way). These boxes are no longer keyed on
their value: while there's no edit in progress, an effect writes the saved value
into the box, so a plate lookup or a server-side tidy still shows up without
remounting and the box keeps focus after Enter. Selects and checkboxes keep D-040's
keyed pattern — a change there *is* the commit. The manual-entry form is controlled
and unaffected.
Why: a remount can't keep focus, and saving every letter also sent a PATCH per key
(with responses that could land out of order). Rejected: keeping per-keystroke saves
and restoring focus after the remount (caret and selection jump, still a PATCH per
key), and fully controlled inputs (a second copy of each field to keep in sync —
the reason for D-040 in the first place).
Supersedes: D-040 (the save-on-change and keyed-on-value parts, for text-like boxes)

## D-053 — One spelling per make and model, tidied on every write (2026-10-07)
Context: the same van came in as `Citroen`, `CITROEN`, `Citroën`; `Relay`, `RELAY`,
`RELAY 35 L3H2 EPRISE BHDI S/S`, `Renault master`, `nv400` — from eBay aspects,
DVSA's model string via plate lookup, and typing. Filters and suggestion lists
showed each spelling separately.
Decision: `app/normalise.py` (stdlib only) owns both rules, and every write path
calls it — create/PATCH validation, eBay scrape and import (`_listing_fields`),
and the plate lookup's suggested make/model.
- Make: accents stripped, each word title-cased; an alias map (`VW` →
  `Volkswagen`, `Mercedes`/`Mercedes Benz`/`Merc` → `Mercedes-Benz`) and a short
  list of brands that stay capitals (`LDV`, `MAN`, `BMW`, `DAF`, `MG`, `AMC`).
  `Citroen` without the accent — the majority spelling and what eBay and DVSA send.
- Model: a leading make name is dropped (`Renault master` → `Master`), then the
  string is matched case-insensitively, whole words, against one list of known base
  models (grouped by make for reading, but matched across all makes so a van with
  no or the wrong make still tidies; longest first, so `Transit Custom` beats
  `Transit`). A match becomes that base model's spelling (`NV400`); the trim detail
  is dropped (accepted). No match → each word title-cased, words with a digit kept
  in capitals. Before anything is cut, `parse_size_codes()` (moved into the same
  module) fills `length_code`/`height_code` when they're empty and not being set in
  the same write.
- If the make is empty and the model began with a make name, that make is kept
  rather than thrown away (`NULL` + `Renault master` → `Renault` + `Master`).
  Nothing else is inferred — `Relay` alone does not set `Citroen`.
- Existing rows: an idempotent pass at startup (after migrations) rewrites any make,
  model or empty size code the rules would change, leaving `updated_at` alone (it's a
  tidy, not an edit). Startup rather than a one-shot script, so a row written by an
  older build or an unknown path is caught next boot; with ~400 rows it costs
  nothing.
- The frontend's suggestion lists also merge spellings case- and accent-
  insensitively, as a backstop only.
Why: one function on every write keeps the stored data clean, which fixes filters,
suggestions and ranking groups at once. Rejected: tidying only at display time (the
filter and suggestions would each need it, and the DB stays messy), and a per-make
model list matched only under its own make (misses rows with no make, which are
common from eBay).

## D-054 — "MOT left" rank factor on a fixed curve, not normalised (2026-10-07)
Context: a van with a year's MOT is worth more to Harry than one about to need a
test, but the gain tails off — six months left is still fine. The other numeric
factors (price, mileage, distance) are min–max normalised over the rows on screen
(D-039, D-047).
Decision: a rank factor `mot` ("MOT left"). Days left `d` = expiry − today, where
expiry is the DVSA one (`listing.mot.expiry`) when cached, else the hand-entered
`mot_due`. Score = `(1 − e^(−d/τ)) / (1 − e^(−365/τ))`, capped at 1, with τ = 130
days: ≈0.22 at 1 month, 0.54 at 3, 0.80 at 6, 0.93 at 9, 1.0 from a year on.
Expired (`d ≤ 0`) scores 0; no date at all scores a neutral 0.5 like the other
factors. The curve is absolute — **not** min–max normalised — so a van with 11
months doesn't score 0 just because every other van on screen has 12, and the
score of a van doesn't change with what else is filtered in. Default weight 0, so
saved rank settings don't shift until Harry gives it weight (as with distance).
Why: an exponential approach rises fast in the first months and flattens out,
which matches "half a year is still OK", and never penalises a long MOT.
Rejected: min–max over days left (exaggerates tiny differences when every van has
a fresh MOT, and rewards 2-year-old MOTs over 1-year ones that are just as good)
and a linear ramp to 365 days (scores six months as only half as good).

## D-055 — Remember rejected plates; flag a relisted van at read time (2026-10-07)
Context: a van Harry has rejected can come back as a new eBay item or be typed in
again by hand, and nothing says he has already turned it down. A rejected listing
may also be deleted, so the memory can't live on the listings themselves.
Decision:
- A table `rejected_regs` (`reg` primary key, `listing_id`, `title`, `rejected_at`),
  regs cleaned with `mot.clean_reg()`; a reg it refuses isn't remembered.
- One function, `rejected.sync(conn, listing_id)`, runs after every create and PATCH
  (and must be called by any later path that writes `status` or `reg`, such as
  milestone 4b's auto-reject). It keeps one rule true: a rejected listing with a
  plate has that plate remembered. The **first** rejection of a plate keeps the row
  (its `rejected_at` stays, its title follows edits); a later rejected listing with
  the same plate is the relist, so it is flagged rather than taking over. A listing
  that stops being rejected, or whose plate changes or is cleared, gives up its row;
  if another rejected listing still has that plate, the row passes to it (lowest id,
  `rejected_at` = its `updated_at`). Deleting a listing leaves its row — that's the
  memory.
- Backfill: an idempotent `rejected.backfill()` at startup adds a row for any
  rejected listing with a plate that has none. No rejection time was ever stored, so
  `rejected_at` is the listing's `updated_at` (its last edit, at or after the
  rejection); when several rejected listings share a plate the lowest id wins.
  Startup rather than a one-shot script, like D-053, so it also catches a path that
  forgot to sync.
- The flag is derived when listings are read: `rejected_before` =
  `{listing_id, title, rejected_at}` when the listing's plate is remembered under a
  different listing id, else null — so a plate extracted or looked up later still
  triggers it. It is a registry pseudo-field (`DERIVED_KEYS`, not editable) of type
  `checkbox`, so the filter bar offers it as Checked/Unchecked. No column of its
  own (`in_table: False`): the "Rejected before" pill sits in the Status cell,
  where a mostly empty column would waste width, and in the popup's actions row,
  where it opens the old listing if it still exists. Tooltip: old title and date.
- Because one listing's status or plate changes another listing's flag, the
  frontend reloads the listings after a PATCH that touches `status`, `reg` or
  `title`, rather than only swapping in the returned row.
- Flag only: a scrape never auto-rejects a relisted van.
Why: a table survives deletes; deriving the flag at read time means nothing stored
goes stale when a plate turns up later. Rejected: storing a flag column on listings
(would need rewriting whenever any other listing changes) and "latest rejection
wins" (would flag the original listing as a relist of its own copy).

## D-056 — Highlight VAT and size terms in the description with a backdrop (2026-10-07)
Context: whether a van is Plus VAT, and its length/height or wheelbase, are often
only stated in the description (the `notes` field), buried in long eBay prose.
Harry wants those words to stand out while reading or pasting a description.
Decision:
- One matcher, `frontend/src/lib/keywords.ts`: plain case-insensitive regexes, no
  AI (inside D-036's limits), and a function splitting text into plain and
  highlighted segments. Terms: VAT — "plus VAT", "+VAT"/"+ VAT", "ex VAT"
  (also "ex. VAT", "ex-VAT"), "excl VAT"/"excl. VAT"/"excluding VAT", "no VAT"
  (extended to "no VAT to add" when it follows), "VAT free"/"VAT-free"; size codes
  `L1H1`–`L4H3` with an optional space; wheelbase — any "wheelbase" or "wheel
  base", taking a "long/medium/short/extra long" in front with it, and the
  abbreviations `LWB`, `MWB`, `SWB`, `ELWB`, `XLWB`. Everything matches whole words
  only, so "Swbxyz" or "vatable" don't light up.
- A `<textarea>` can't colour its own text, so `HighlightTextarea` puts a `div`
  behind a transparent-background textarea with the same border, padding, font and
  wrapping. The backdrop's text is transparent and only its `<mark>`s have a
  background; the text you see, the caret and the selection are the textarea's
  own, so a slight misalignment could only shift a yellow box, never the text.
  Backdrop scroll follows the textarea's; both reserve a stable scrollbar gutter so
  their wrap widths match when a classic scrollbar appears.
- Used for the popup's notes box (`NotesField`, its debounce and flush unchanged)
  and the manual-entry form's notes box. Highlight only — nothing fills
  `vat_status` or size codes from the matches; that's milestone 4b's job.
Why: the backdrop is the standard way to mark up a plain textarea without turning
it into a contenteditable editor (which would bring its own caret, paste and undo
problems) or adding a library. Rejected: a read-only highlighted preview beside
the box (the description would show twice) and highlighting only in the table cell
(it shows a few words).

## D-057 — A current-style plate must carry an issued age identifier (2026-10-07)
Context: `mot.extract_reg()` read Renault Master model codes in titles ("LM35dCi",
"MM35dCi") as plates, so five listings carried a bogus reg and, since D-055, three
showed a false "Rejected before". A real current-style plate (two letters, two
digits, three letters) can only carry an age identifier that DVLA has issued.
Decision:
- `mot.plate_issued(reg, today)` is false only for a current-style plate whose age
  identifier isn't issued yet, counted from today's date (never hardcoded): March
  codes `02` up to this year's two digits once March has begun (last year's before),
  September codes `51` up to this year + 50 once September has begun (last year's +
  50 before). In 2026-10 that allows `02`–`26` and `51`–`76`. Any other shape (older
  formats, Northern Irish, private plates) is left alone. The plan said March codes
  run to "current two-digit year" without the month condition; a `27` plate in
  January 2027 isn't real either, so the March rule waits for March like September's
  does. The scheme wraps in 2050 (`00`), which this ignores.
- `extract_reg()` drops matches that fail it *before* the "two different plates means
  ambiguous" rule, so "Master LM35dCi, reg PE18 OGB" still yields `PE18OGB`.
- Hand entry refuses one too: `main.normalise_reg()` (create, PATCH, plate lookup)
  answers 400 with a plain-English reason. Small and consistent — it's the same
  function, and it means the clean-up below can never wipe a plate Harry typed.
  Nothing else about hand-typed plates changes (they're still not shape-checked).
- Clean-up of stored data: an idempotent startup pass, like D-053/D-055, clears `reg`
  on any listing whose plate fails the check (leaving `updated_at` alone — a tidy, not
  an edit), runs `rejected.sync()` on each so D-055's invariants hold, then
  `rejected.forget()` drops any remembered plate that fails it (a deleted listing's
  row). After the first boot it finds nothing, because no write path can store such a
  plate any more.
Why: the age identifier is the one part of a modern plate with a rule that can be
checked offline, and it is exactly what model codes like `35` (March 2035) break.
Rejected: a list of known model codes (never complete), refusing letters-then-"dCi"
patterns (too specific), and leaving the bad regs for Harry to clear by hand.

## D-058 — Fill size codes and Plus VAT from the title and description (2026-10-07)
Context: D-056 only highlights size and VAT wording, so a listing titled "… MWB
L2H2 …" still showed empty Length/Height boxes. Harry expected the boxes to fill.
Decision:
- `normalise.description_hints(title, notes)`: plain regexes (no AI, inside D-036),
  mirroring D-056's terms. Size codes `L1H1`–`L4H3` (optional space) fill
  `length_code`/`height_code`, each only when every code in the text agrees on it —
  "L2H2 or L3H2" fills H2 and leaves the length empty. Plus VAT wording ("plus
  VAT", "+VAT", "ex VAT", "excl VAT") sets `vat_status = 'plus_vat'` unless "no VAT"
  or "VAT free" also appears. Wheelbase words (SWB/MWB/LWB) fill nothing: they map
  to different L codes on different makes (a Transit MWB is L3, a Movano MWB L2).
- Applied in `normalise.tidy()`, so every write path gets it: manual create, PATCH,
  eBay scrape and import. Model-string codes (D-053) and values set in the same
  write win. Only empty fields fill. On a PATCH, a hint fills only if the old
  title/notes didn't already give it — so editing the notes of a van whose Length
  Harry cleared doesn't put it back, but pasting in new text with a code does.
- Existing rows: a one-off pass, `normalise.fill_all_from_descriptions(conn)`, run by
  hand once (not at startup — a startup pass would refill a box Harry emptied on
  every boot). Leaves `updated_at` alone, like D-053's tidy.
Why: the codes are unambiguous when written out, and "Plus VAT" wording is the
whole reason D-043 exists. Rejected: waiting for milestone 4b's AI (the regexes
already find these), mapping wheelbase words per make (a table to maintain, and
wrong guesses fill boxes), and a startup pass.
Supersedes: D-056 (its "highlight only — nothing fills" line; the rest stands)

## D-059 — Fill Length from wheelbase words, per model (2026-10-07)
Context: D-058 left SWB/MWB/LWB filling nothing because the word means a different L
code on different makes. Harry wrote `docs/WHEELBASE.md` as the per-make table and
asked for the words to fill Length too. Checked against the 66 stored vans that
already had a Length and a wheelbase word: 64 agree with the table.
Decision:
- `normalise.WHEELBASE_LENGTHS`, keyed by base model: Relay/Jumper/Boxer/Ducato and
  Master/Movano/NV400/Interstar are SWB L1, MWB L2, LWB L3, extra-long L4; Transit
  (2014-on) is SWB L2, MWB L3, LWB L4. Any other model — Sprinter, Crafter, Transit
  Custom, no model at all — fills nothing. A Transit whose year is before 2014 fills
  nothing.
- The model is the listing's model, else the first known base model named in the
  title ("citroen relay swb van" with an empty model still counts as a Relay).
- Wheelbase words fill `length_code` only, only when every word in the text maps to
  the same code, and only when the text has no `L1H1`-style code at all — a written
  code always beats a wheelbase word, even when the codes disagree among themselves.
  Bare "wheelbase" with no size word counts for nothing.
- Same fill rules as D-058 (only empty boxes, a value set in the same write wins, a
  PATCH doesn't refill what the old text already gave). A change of model now also
  triggers the fill, since it can make an existing wheelbase word readable.
- Existing rows: `fill_all_from_descriptions()` run by hand once more.
Why: the table is short, the data bears it out, and empty Length boxes on LWB vans
hide them from the size filter. Rejected: guessing for unlisted models, and letting
wheelbase words break a tie between conflicting codes.
Supersedes: D-058 (its "wheelbase words fill nothing" line; the rest stands)
