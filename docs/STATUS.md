# Status

Living document — describes *now*. Rewrite freely; nothing here is history.

## Current goal

None in progress. **Ranking, data clean-up and description hints** finished on
2026-10-07 (CHANGELOG; the phase-by-phase plan and handover notes are in
[`docs/PLAN.md`](PLAN.md), the why in D-051–D-057). Pick the next goal from
**Next** below.

`data/vancrm.db.bak-phase3`, `-phase5` and `-phase7` are copies of the DB from
before each data rewrite (make/model tidy, rejected-plates backfill, bogus regs
cleared). Delete them once Harry is happy with the result.

Notes for working in `frontend/`:

- TanStack Table is pinned to v8 (v9 is npm latest but has a different API).
- The `View` menu is column visibility; the topbar `Columns` button is the
  custom-properties CRUD.
- D-039 explains why filtering/ranking live in `lib/` selectors rather than
  TanStack filter fns (price, mileage and distance scores are min–max over the
  rows on screen; MOT left is a fixed curve, D-054); D-040 why the popup's fields are uncontrolled, and D-052
  why its text boxes save on blur/Enter/pick/unmount through `useCommit()` rather
  than per keystroke (only selects and checkboxes are still keyed on their value).
- `DialogContent` is a CSS grid, so any wide child inside it needs `min-w-0` on
  the content wrapper or the whole dialog overflows sideways.
- `npm run build` warns that the JS bundle is over 500 kB. Harmless for a
  localhost app; not worth code-splitting unless load time actually suffers.
- Leaflet's CSS is unlayered, so it beats Tailwind utilities on the same element
  (e.g. `.leaflet-container`'s font); style a child instead. Maps carry `isolate`
  so Leaflet's high z-indexes stay under dialogs and menus.
- Verification so far has been headless Playwright scripts (system Chrome) against
  the live API, each creating and deleting its own test data; they live in session
  scratchpads, not the repo.

Open, not blocking:

- The notes highlighting (D-056) was only checked in Chrome. Worth Harry opening
  one long description in Safari to see the yellow sits exactly on the words.
- Nothing in the app turns on the `.dark` class, so it is always the light theme;
  the `dark:` colours (pills, notes highlighting) were only checked by forcing it.

- Pinch zoom in the popup (D-042) hasn't been tried on a real trackpad — worth
  Harry pinching once in Safari and Chrome to confirm the zoom speed feels right.
- The all-vans map re-zooms to fit whenever a filter or search changes the pins.
  If that's annoying while zoomed into an area, keep the view instead (`FitToPoints`
  in `VanMap.tsx`).

## Done

- 2026-08-26: docs restructured to the standard layout (AGENTS.md + docs/).
- Milestones 1–3 (skeleton, CRUD + table, custom properties), 4 (eBay), 5 (MOT/reg
  lookup) are built. eBay is sandbox-verified and a real production scrape ran
  successfully on 2026-08-12 (all 5 saved searches, pagination past one page).
- 2026-10-04: the frontend rebuild on Vite + React (D-037), phases 0–7, and the
  Plus VAT toggle (D-043, D-044). See CHANGELOG.
- 2026-10-05: distance to homes + maps (D-047–D-050). See CHANGELOG.

## Next

1. **Remaining production eBay checks** — the sandbox couldn't answer these; production
   keys are in, they just haven't been run:
   - import-from-link against a live `ebay.co.uk` URL
   - the `ebay.us`/`ebay.to` shortener redirect (a short link to a van already in the
     table must resolve to the existing row, never a duplicate)
   - a liveness check on an item that has genuinely ended → `is_active=0`
   - the spares/repairs skip firing on a real listing (watch `skipped`)
   - re-run the Taxonomy category lookup on production to confirm the ids in D-003
2. **Milestone 4b — AI enrichment** (`app/ai.py`, via OpenRouter; the scope deviation
   is D-036). Condensed spec:
   - Config: `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` in `.env` (pick a current cheap
     model with Harry when building; verify the chat-completions request/response shape
     against OpenRouter's live docs first). Unconfigured → scrape/import silently skip
     enrichment; a manual analyse endpoint returns 503. `httpx` only.
   - Runs once per **newly inserted** eBay listing (scrape and import), after the
     detail fetch. A failure never fails the scrape; batch-level failures only in
     `errors`. A **Re-analyse** button in the listing popup re-runs on demand.
   - Model extracts strict JSON: `size_code` (`L1H1`–`L4H3` or null, normalising
     SWB/MWB/LWB and roof wording where unambiguous), `vat_status`
     (`plus_vat`/`no_vat`/`inc_vat`/null), `mileage` (only when stated), `flags`
     (short red-flag tags: rust, cat S/N, non-runner, no MOT, ex-fleet,
     spares/repairs).
   - Deterministic post-pass in Python: comparable price = `price_gbp × 1.2` when
     `plus_vat` (derived, not stored) so sorting is honest; extracted mileage below the
     latest MOT odometer → clocking flag, don't fill; spares/repairs wording → status
     auto-set to rejected (stays inserted so the UNIQUE dedupe stops it returning).
   - Fill rules: AI values only ever fill empty fields; record `ai_analysed_at`.
     `vat_status` already exists (D-043, manual toggle; add `inc_vat`/`no_vat` to
     `VAT_STATUSES`). New columns `ai_flags` (JSON TEXT), `ai_analysed_at` via
     `db.MIGRATIONS` + `FIELD_SPECS`.
   - Acceptance: rescrape doesn't re-call the model for analysed rows or overwrite
     user edits; a "plus VAT" van sorts by its ×1.2 price; empty key → 4a behaviour
     exactly, app boots.

## Broken

- Nothing known to be broken. Two dormant/untested paths, by circumstance not fault:
  the DVLA VES merge in `mot.py` (no key issued yet — field names verified against
  docs, path untested end-to-end) and the items in "remaining production eBay checks"
  above.
