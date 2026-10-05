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
