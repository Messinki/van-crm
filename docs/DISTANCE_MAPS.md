# Distance to homes + maps — plan

Working document for the distance-and-maps goal. Delete this file when the last
phase lands (its outcome moves to CHANGELOG/ARCHITECTURE as usual). The why lives
in DECISIONS: D-047 (homes and distance), D-048 (geocoding), D-049 (maps).

**Starts after frontend-refactor Phase 7** — Harry chose to finish the demolition
first, 2026-10-04. Phase 7 landed 2026-10-04, so this is next.

## What Harry asked for (agreed 2026-10-04)

- **Homes.** Several "home" locations (expect 2–5), each entered as a **postcode**
  (full or first half), with a **short label** ("Bristol", "Mum's"). Managed in a
  **Homes** dialog in the topbar, like Searches and Columns. Each home can be
  **switched off** temporarily — distances then use only the enabled ones. No
  weighting.
- **Distance.** Straight-line, **whole miles**, from each van to each enabled home.
  Only the **closest** is shown — table and popup alike (the popup does *not* list
  every home). Outcode-level accuracy (a few miles) is fine.
- **The pill.** Everywhere that closest distance appears — table cell, popup, the
  map's pin card — a pill beside it names the home it was measured to (its label).
- **Sorting, filtering, ranking.** Distance sorts like any column, appears in the
  filter bar as a range ("within 100 mi" = a max), and is a rank-panel factor.
  The column is visible by default, next to Location.
- **No location / can't place it** → "—" and sorts last. Fixed by editing the
  Location field, which looks it up again.
- **Location map.** Clicking the table's Location cell, or a map button beside
  the popup's Location field, opens a small map with that van's pin and the home
  pins. **No lines, no radius circles.**
- **All-vans map.** A **Table | Map** toggle in the topbar. The map shows exactly
  the rows the table would (same search, chips, filters). **All van pins one
  colour, home pins another.** Clicking a van pin shows a small card (photo,
  price, title, distance + pill); clicking the card opens the normal popup.
- **Coordinates are stored**, looked up once when a listing is scraped, imported
  or created, **again whenever its location changes**, plus a one-off fill for
  the listings that already exist.
- Facebook/manual entries: Harry types at least the first half of a postcode
  into Location ("BS5").

Reconciled while writing this up: the suggested per-home pill colour is dropped
because answer 15 makes all home pins one colour. Pills use that one home colour
and tell homes apart by label. Easy to revisit.

## Verified API facts (live, 2026-10-04)

**postcodes.io** — `https://api.postcodes.io`, no key, UK only, open data. Probed
directly; response fields below are what came back, not from memory.

| Need | Call | Coordinates in |
|---|---|---|
| Full postcode | `GET /postcodes/{pc}` | `result.latitude`, `result.longitude` |
| Many full postcodes | `POST /postcodes` body `{"postcodes": [...]}`, **max 100** | `result[i].result.latitude/longitude`; `result[i].result` is `null` for an unknown one |
| First half (outcode) | `GET /outcodes/{outcode}` (e.g. `RM13`) | `result.latitude`, `result.longitude`; unknown → HTTP 404 `{"error":"Outcode not found"}` |
| Town/place name | `GET /places?q=Yeovil&limit=5` | `result[i].latitude/longitude`; also `name_1`, `local_type` (Town/Village/…), `county_unitary`, `region` |

**Leaflet stack** (npm, 2026-10-04): `react-leaflet` 5.0.0 (peers: React ^19,
leaflet ^1.9 — we're on React 19.2), `leaflet` 1.9.4, `@types/leaflet` 1.9.22,
`react-leaflet-cluster` 4.1.3 (peers react-leaflet ^5). The react-leaflet docs
site still says `react@rc` / `react-leaflet@next` — stale; v5.0.0 is the
release. Leaflet's own CSS must be imported or tiles render scrambled.

**OSM tiles** — `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Policy: visible
"© OpenStreetMap contributors" attribution, a valid Referer (the browser sends
it), honour cache headers, **no pre-fetching or offline download**. Light
interactive personal use is explicitly fine. If tiles come back as "access
blocked" images from localhost, stop and raise it — don't silently swap
providers.

## What the location strings look like (DB sample, 2026-10-04)

385 of 388 listings have a location. eBay writes `Town, OUTCODE ***` (e.g.
`Accrington, BB5 ***`, `Halifax, HX3***`, `cannock, ws11***` — case and spacing
vary). Occasionally a full postcode is in there (`High Wycombe HP11 2JL, HP11 ***`).
Facebook/manual entries are mostly towns, sometimes with a county
(`Stafford, Staffordshire`, `Newport`, `willisden nw10`, `NN9 6QY`, `PO16`).

**Lookup order** per location string (stop at the first hit):

1. A full postcode anywhere in it → postcode lookup.
2. An outcode anywhere in it (`BB5`, `nw10`; ignore the `***`) → outcode lookup.
3. Otherwise the text before the first comma → places search, 20 results,
   ranked (D-050): exact name match, then a `county_unitary` /
   `district_borough` / `region` matching the text after the comma, then City >
   Town > Village > anything else, then postcodes.io's order. (Bare "Newport"
   is still a guess — it lands on the Welsh city; Harry fixes a wrong one by
   adding a postcode.)
4. Nothing found → "not found".

## Data model

- **New table `homes`**: `id`, `label`, `postcode`, `lat`, `lng`, `enabled`
  (default 1), `position`, `created_at`. Coordinates come from the postcode
  when the home is saved, so a home is never stored unplaced.
- **New listings columns** (via `db.MIGRATIONS`): `lat REAL`, `lng REAL`,
  `geocoded_from TEXT`. All three go in `UNMANAGED_COLUMNS` — not user-editable,
  but returned by `GET /api/listings`.
  - `geocoded_from` holds the location string the lookup last ran on. A listing
    **needs a lookup** when it has a location and `geocoded_from` differs from it.
  - "Not found" sets `geocoded_from` with null coordinates, so junk isn't
    retried every scrape. A **network failure leaves `geocoded_from` alone**, so
    it is retried next time automatically. (On a location *edit* it also clears
    the old coordinates — D-050.)
- **New registry pseudo-field `distance`** in `FIELD_SPECS` + `DERIVED_KEYS`:
  numeric, read-only, cell `distance`, visible in table and popup, after
  `location`. It is **computed in the browser**, not stored. Enabling a home or
  adding one re-sorts instantly with no refetch, the way `effectivePrice` works
  for VAT (D-043).

## Phases

Each phase ends verified against the running app and committed. Push when the
whole goal is done (and at the end of any session with commits).

### Phase 1 — backend: geocoding, homes API, stored coordinates — done 2026-10-04

**Result:** the one-off fill located **385 of 385** listings with a location, 0
not found, 0 failed (~15 s); all coordinates fall inside the UK. Verified as
below, plus the scrape/import hooks with eBay faked in-process. Found on the
way: a rescrape never changes a listing's location (`_touch_existing` only
updates price), so the post-scrape pass only ever covers new rows and earlier
failures. `distance` in the registry moved to Phase 2, so the table doesn't
show an empty column in between.

- `app/geo.py`: `locate(text) -> (lat, lng) | None` using the lookup order above,
  over `httpx` with a short timeout and a descriptive User-Agent; a module-level
  cache keyed on the normalised query (many vans share `BB5`). A network error
  raises a distinct exception so callers can tell it from "not found".
  `fill_missing(conn)` runs the lookup for every listing that needs one and
  returns `{located, not_found, failed}`. Use the bulk `POST /postcodes` for
  full postcodes; outcodes and places are one call each (cached).
- Migrations: the three listings columns + the `homes` table. Update
  `UNMANAGED_COLUMNS` (startup registry check must pass).
- Hook-in points. **A geocoding failure never fails the save or the scrape.**
  - `POST /api/listings`: locate after insert.
  - `PATCH /api/listings/{id}`: if `location` changed, locate again; the response
    carries the new `lat`/`lng`. Clearing the location clears all three.
  - eBay scrape and import: one `fill_missing` pass at the end, so new rows and
    rows whose location changed on rescrape are covered. Lookup failures are
    *not* scrape errors (D-002 is about eBay warnings).
- Endpoints: `GET/POST/PATCH/DELETE /api/homes[/{id}]` (POST/PATCH with a new
  postcode geocodes it; an unknown postcode → 422 "couldn't find that postcode";
  postcodes.io unreachable → 503 with a plain-English message).
  `POST /api/geocode/missing` → runs `fill_missing`, returns the counts. (The
  "how many unplaced" count needs no endpoint — the browser already has every
  listing's `location` and `lat`.)
- Run the one-off fill via that endpoint and record the result (how many
  located / not found).

Verify with curl: home CRUD incl. a bad postcode; PATCH a test listing's
location from a town → outcode → blank and watch lat/lng follow; the fill
counts; the app still boots with the network off.

### Phase 2 — distance column, pill, Homes dialog — done 2026-10-05

**Result:** built as below and verified headless (35 checks, own test
listings and homes, all deleted afterwards): distances and pills match an
independent haversine; sorting either way keeps blanks last; switching a home
off moves the pills and re-sorts live; the popup shows the same figure beside
Location; rename, reorder, postcode change and a refused bad postcode (box put
back, error toast) all behave; Retry places a listing whose lookup never got
an answer. How it's wired, beyond the bullets:

- `App` runs every listing through `withNearest(listings, homes)` once, which
  attaches `nearest: {miles, home} | null`. Table, popup, filters and sorting
  all read that, so they can't disagree. Homes load with the other boot
  queries, so distances never pop in after the first paint.
- The table cell is left-aligned like its header, with the miles in a
  fixed-width slot, so numbers line up whatever the pill's length.
- The pill colour is **teal** — Phase 4's home pins should match it.
- A "—" has a tooltip saying why: no location, not recognised (add a
  postcode), not looked up yet (Retry), or no home switched on.
- The Homes dialog's Retry only appears when something is retryable; a
  location postcodes.io didn't recognise isn't retried (D-048), so the dialog
  lists those strings and says to edit the Location instead.


- Add `distance` to `FIELD_SPECS` + `DERIVED_KEYS` (see Data model).
- `lib/distance.ts`: haversine in miles; `closestHome(listing, enabledHomes)`
  → `{ miles, home } | null` (rounded to whole miles for display, unrounded for
  sorting). `sortValue(listing, 'distance')` returns the miles, so the existing
  sorting, nulls-last behaviour and (Phase 3) filters and rank pick it up.
- Homes Query hooks in `api/queries.ts`; types in `lib/schema.ts`.
- `HomesDialog` (topbar button "Homes"): add / rename / change postcode /
  enable toggle / reorder / delete. Show "N vans couldn't be placed" with a
  **Retry** button that calls `/api/geocode/missing`.
- `distance` cell: `42 mi` + `HomePill` (the home's label, in the one home
  colour). "—" when there's no enabled home or no coordinates. The same
  `DistanceValue` component renders in the popup, beside Location.

Verify headless as before (Playwright + own test data, created and deleted):
column values against a hand-computed haversine; toggling a home off moves the
pill to the next-closest and re-sorts; no homes → all "—".

### Phase 3 — filter bar and rank panel — done 2026-10-05

**Result:** verified headless (17 checks) against Harry's real homes plus
test listings and a test home, all removed afterwards: "≤ 50 mi" shows
exactly the 17 visible vans an independent haversine count gives; switching
a home on re-applies the filter live; a distance-only ranking orders the
whole table closest first (0 → 178 mi); rank settings saved before this
restore distance at 0.

- The filter needed no nudge — `distance` is `type: number` and `sortValue`
  handles it. Two additions: a registry `unit` key (`"mi"`), so the chip reads
  "Distance ≤ 50 mi" and the editor "Distance (mi)"; and `filterValue()`,
  which compares the **whole miles shown**, so a van showing "100 mi" (really
  100.4) passes "≤ 100". Sorting and ranking keep the unrounded figure.
- `RANK_FACTORS` gained `distance` (closer is better, `inverseNormaliser`),
  default weight 0.
- A van with no distance scores a neutral 0.5 on it, like a missing price or
  mileage — so it sits mid-ranking, not last. Checking this exposed a bug
  inherited from app.js: `Number(null)` is 0, so a *missing* mileage or price
  had been scoring as the *best*. Fixed in its own commit.

### Phase 4 — map dependency + the single-van map — done 2026-10-05

**Result:** verified headless (17 checks, own test listings, deleted
afterwards): the Location cell opens the map and not the popup; the popup's
map-pin button stacks the map on top of it, and Escape closes just the map;
pins are 1 van + each enabled home; tiles really load from
tile.openstreetmap.org (no "access blocked" image) with the attribution
showing; an unplaceable location gets the same sentence as the "—" tooltip
instead of a map; a blank location has no map button and its cell still
opens the popup. How it's wired, beyond the bullets:

- Location got its own registry `cell` and `widget` (`"location"`), so the
  table and popup pick the map-opening versions from the spec like every
  other special field. The table cell reaches the dialog through TanStack's
  `TableMeta.onShowMap`; the dialog lives in `App` (`mapId`), after
  `DetailDialog` so it stacks on top.
- Pins: vans orange (`#ea580c`), homes teal (`#0d9488`, matching the pill)
  and a little bigger with a white centre, so they differ without the
  colour. Only **enabled** homes are drawn, so the pins agree with the pill.
- `VanMap` re-fits only when a pin's coordinates actually change, and caps
  the fit at zoom 11 — outcode accuracy doesn't justify street level. It
  also watches its own box size (Phase 5 puts it in a flexible layout).
- The popup's ↑/↓/←/→ now ignore keys pressed inside another dialog, so
  panning the map with the arrow keys doesn't flip listings behind it.
- `missingReason()` moved from `DistanceValue.tsx` to `lib/distance.ts` so
  the dialog can share it.

- **Before installing**: update AGENTS.md's fixed frontend stack rule to add
  Leaflet / react-leaflet / react-leaflet-cluster (D-049).
- `npm install leaflet react-leaflet react-leaflet-cluster` +
  `@types/leaflet` (dev). Import Leaflet CSS once.
- `components/map/` — a shared `VanMap` component taking van points and home
  points; van pins one colour, home pins another with their label in a
  tooltip. Use simple `divIcon` circles in the two colours, not Leaflet's
  default marker images (those need image-path fixing under Vite).
- `LocationMapDialog`: opened by clicking the table's Location cell (stop the
  click reaching the row, like the +VAT chip) and by a map-pin button beside
  the popup's Location field. Fits the van + enabled homes in view. A van
  without coordinates shows "Couldn't place this location" instead of a map.

Verify: the dialog opens from both places, shows the right pins, closes
cleanly; the row click still opens the popup everywhere else.

### Phase 5 — all-vans map view

- Topbar **Table | Map** toggle (persisted to localStorage like other view
  state). The map uses the same visible-rows selector as the table
  (`lib/visible.ts`), so search/chips/filters apply.
- Van pins clustered (`react-leaflet-cluster`) — many vans share an outcode and
  would otherwise stack invisibly. Home pins never cluster.
- Pin click → small card: thumbnail, price (inc-VAT figure when flagged),
  title, distance + pill. Card click → the existing `DetailDialog`, with ↑/↓
  stepping through the same visible order.
- A small "N not on the map" note for visible rows without coordinates.

Verify: pin count = visible rows with coordinates; changing a filter updates
the pins; card → popup → ↑/↓ works; the table view is unchanged.

### Phase 6 — docs wrap-up

ARCHITECTURE (geo.py, homes table, map components, API additions), CHANGELOG
entry, STATUS rewritten. Delete this file.

## Out of scope

Road distance or drive time, per-home weighting, lines or radius circles on the
maps, offline tiles, geocoding outside the UK.
