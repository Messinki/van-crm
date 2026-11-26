# Changelog

Append-only, newest first. One entry per completed goal or tag.
What happened — not why. Cite decision IDs for the why.

Format:

```
## v0.1 / Goal: short title (YYYY-MM-DD)
- What changed, one line each. Cite decisions as (D-012) where relevant.
```

History before this file lives in `git log` and in the deleted docs' history
(README.md, van-crm-spec.md, the two amendments). Summary of the pre-changelog state:
milestones 1–5 built (skeleton, listings CRUD + table, custom properties, eBay
scrape/import/liveness, DVSA MOT + reg lookup); first production scrape 2026-08-12.

---

## Goal: engine and gearbox from the advert text (2026-11-26)
- Engine and gearbox are read from the title and description when not entered, with
  sources ranked you → DVSA → title → description; "HDi" is read against the build
  date, since sellers write it for BlueHDi too (D-068).
- Disagreeing sources show in amber under Engine / Gearbox; the Gearbox field says
  which source it's going by.
- Engine and gearbox wording is highlighted in the description.

## Goal: richer van-note matching, engine, VIN and recall flag (2026-11-26)
- The MOT lookup's cached data now gives each van a build date, an outstanding-recall
  flag (red **Recall** badge in the MOT column, a line in the MOT report) and a
  guessed engine (D-066).
- New listing fields: Engine (guess shown as placeholder; title wording used too),
  Gearbox, and VIN with a live DVSA **Check** for plate mismatches and recalls (D-066).
- Van notes match on build month, engine, gearbox and mileage; unknowns show greyed
  as "may apply" with the reason; recalls get their own heading with dates written
  from the note (D-067).
- Notes rewritten to match: engine notes use the engine condition, recalls are one
  line each with month windows, duplicated Sevel recalls merged, Sprinter's undated
  fuel-leak recall dropped.

## Goal: van notes in a file, recalls by build year (2026-11-26)
- Van notes moved from the database to `notes/van-notes.json`, committed to git; the
  Notes view and API are unchanged (D-065).
- Recall and fault lines tied to a build window split into their own notes, ranged to
  those build years (D-064); `Src:` lines and source caveats removed.
- The Boxer brake-pipe recall note was dropped (its build years were never found).

## Goal: layered van notes (2026-11-26)
- The popup shows matching notes most specific first and drops lines already shown
  by an earlier note (D-063).
- Relay/Boxer/Jumper/Ducato notes rewritten as layers: a body note for all four,
  engine notes (Fiat 2.3; 2.2 HDi, 2.0 BlueHDi, 2.2 BlueHDi), and Ducato recalls.

## Goal: van notes beside the MOT report (2026-11-26)
- The popup's matching van notes moved from beside the thumbnails to the right half of
  the MOT section, as a read-only **Known issues** list (D-062).
- The MOT report's list of all tests is always open.
- 13 researched fault notes added for the Relay family, Transit, Master family,
  Sprinter and Crafter.

## Goal: van-type notes (2026-11-26)
- A **Notes** view joins Table and Map: add a note with the plus button, tick the base
  models it applies to, give an optional year range and a comment; everything stays
  editable, and each note has a delete button (D-061).
- The listing popup shows the notes that match the van's model and year in the right
  third of the thumbnail row (thumbnails take the other two thirds); the box scrolls,
  and comments can be edited there too.

## Goal: No plates chip replaces New (2026-11-26)
- The New status chip is gone; a **No plates** chip lists every non-rejected van with
  no plate, so after a scrape you can work down it filling plates in (D-060).
- `new` is now labelled "No status" and shows no pill in the table.

## Goal: fill Length from wheelbase words (2026-10-07)
- SWB / MWB / LWB / extra-long wording (and "long wheelbase" etc.) fills an empty
  Length on Relay, Jumper, Boxer, Ducato, Master, Movano, NV400, Interstar and
  2014-on Transit, using `docs/WHEELBASE.md`; a written `L2H2`-style code still wins.
  A van with no model counts by the model named in its title (D-059).
- One-off backfill: 45 listings filled; two conversion-service ads (ids 1967, 2047)
  left out by hand.

## Goal: fill size and Plus VAT from descriptions (2026-10-07)
- An `L1H1`–`L4H3` code in the title or notes fills an empty Length/Height, and
  "plus VAT" / "+VAT" / "ex VAT" / "excl VAT" wording fills an empty VAT, on manual
  entry, edits, eBay scrape and import. Conflicting codes, "no VAT" and wheelbase
  words fill nothing (D-058).
- One-off backfill over the existing data: 183 listings filled.

## Goal: ranking, data clean-up and description hints (2026-10-07)
- Every price comparison, sort, filter, rank and total goes through `effectivePrice()`
  (listed price × 1.2 for Plus VAT); ranking already did, now it's a standing rule (D-051).
- Popup text boxes save on blur, Enter, a suggestion pick or closing/leaving the van,
  instead of on every keystroke — typing no longer loses focus (D-052).
- Make and model are stored in one spelling (`app/normalise.py`): makes title-cased
  without accents (`Citroen`), models cut to the base model (`Boxer`, `Relay`) after
  any L/H code is copied into Length/Height. Applied on every write path and once to
  the existing data (54 rows); suggestion lists merge case variants (D-053).
- New **MOT left** rank factor on a fixed exponential curve — 0.80 at six months,
  full marks from a year — using the DVSA expiry, else the hand-entered MOT due (D-054).
- Rejected plates are remembered in a new `rejected_regs` table (backfilled with 43
  plates); a listing whose plate was rejected under another listing shows a
  **Rejected before** pill in the table and popup, and can be filtered on (D-055).
- VAT wording, size codes (L1H1–L4H3) and wheelbase terms (LWB, MWB, "long wheel
  base"…) are highlighted yellow in the notes box, in the popup and manual form (D-056).
- Plates whose age identifier isn't issued yet (e.g. Renault's "LM35dCi" model code)
  are no longer read from titles or accepted by hand; five bogus regs were cleared,
  removing three false "Rejected before" flags (D-057).

## Goal: distance to homes + maps (2026-10-05)
- Listings are geocoded through postcodes.io (`app/geo.py`) into new `lat`, `lng` and
  `geocoded_from` columns: on create, on a location edit, after each scrape and
  import, and from a Retry button. The one-off fill placed 385 of 385 listings that
  had a location (D-048, D-050).
- New `homes` table and `/api/homes` CRUD, managed from a **Homes** topbar dialog:
  label, postcode, on/off switch, reorder (D-047).
- New **Distance** column beside Location: whole miles in a straight line to the
  closest enabled home, with a teal pill naming it; the same figure shows in the
  popup and on the map card. "—" with a tooltip saying why when there's none (D-047).
- Distance is a range filter ("≤ 50 mi") and a rank-panel factor, closer better.
- Clicking a Location cell, or the map button beside the popup's Location field,
  opens a map of that van and the enabled homes (D-049).
- A **Table | Map** topbar toggle shows the table's visible rows as clustered van
  pins plus home pins; a pin's card opens the popup, ↑/↓ follow the table order (D-049).
- Added Leaflet, react-leaflet and react-leaflet-cluster to the fixed frontend
  stack, on OSM tiles (D-049).
- Also fixed along the way: a missing price or mileage ranked as the best rather
  than neutral; deleting from the popup now moves to the next listing like reject.
  The popup's Link field gained an open-link button.

## Goal: frontend rebuild on Vite + React (2026-10-04)
- Replaced the vanilla-JS UI with a Vite + React + TypeScript app in `frontend/`,
  built into gitignored `app/static/dist/` and served at `/` (D-037, D-038). The old
  `app/static/app.js`, `style.css` and `index.html` are deleted.
- Listings table on TanStack Table: schema-driven columns, title search, status
  chips, show-ended, a new View menu for column visibility, the faceted filter bar
  and the rank panel. Saved filter/rank settings carried over (D-039).
- All API access through TanStack Query, including the scrape and check-all
  progress polling (D-034); errors surface as toasts.
- Topbar and every modal (manual entry with plate lookup, import from link, saved
  searches, custom columns) rebuilt as shadcn/ui dialogs.
- The side drawer became a centred listing popup: photos on the left with pinch
  zoom, editable fields on the right, ↑/↓ through the table's current order, ←/→
  through photos, Reject advances to the next listing (D-040, D-041, D-042, D-045,
  D-046). The table title is plain text; the original ad opens from the popup.

## Goal: Plus VAT toggle (2026-10-04)
- New `vat_status` column and a Plus VAT toggle beside the price in the popup and
  the manual form. Flagged listings show listed × 1.2 with a +VAT badge, and sort,
  filter and rank on that figure; the stored price stays as listed (D-043).
- The table's +VAT chip doubles as the toggle, shown on every priced row (D-044).

## Goal: docs restructure (2026-08-26)
- Adopted the standard project layout: AGENTS.md (CLAUDE.md now a symlink) plus
  docs/STATUS, DECISIONS, ARCHITECTURE, CHANGELOG.
- Deleted van-crm-spec.md, both spec amendments, HOW_TO_RUN.md and the old mega-README;
  migrated the still-useful content (decisions → D-001–D-036, setup/credentials →
  ARCHITECTURE, open work incl. the milestone-4b spec → STATUS).
- Replaced README.md with a short landing page pointing at the docs.
