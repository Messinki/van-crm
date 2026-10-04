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
