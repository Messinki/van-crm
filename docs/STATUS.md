# Status

Living document — describes *now*. Rewrite freely; nothing here is history.

## Current goal

The frontend rebuild on Vite + React + TypeScript (D-037, D-038). The plan, phase by
phase, is `docs/FRONTEND_REFACTOR.md` — work through it in order; each phase ends
verified and committed.

**Where it stands (2026-08-26): phases 0–3 done and verified; phase 4 half-built.**

- Phases 0–3 are committed: scaffold (dev on :5173 proxying to :8321, `/new`
  previews the build), typed data layer (`src/lib/schema.ts`, `src/api/queries.ts`,
  global error toasts), and the full table — schema-driven columns, ported cell
  renderers, sortValue sorting, title search, status chips, show-ended, column
  visibility (new), the faceted filter bar, and the rank panel. All verified
  headless (Playwright + system Chrome, scripts in the session scratchpad) against
  expectations computed from the API with the original app.js semantics; the old
  UI at `/` is untouched and still the reference.
- Phase 4 is **half-built and unwired**: `components/Topbar.tsx` (scrape/check-all
  with D-034 progress polling), `modals/ManualEntryDialog.tsx` (schema-driven form
  + reg lookup autofill), `modals/ImportDialog.tsx` (incl. the 409 → open-existing
  path), `modals/SearchesDialog.tsx`, plus shared `lib/lookup.ts`,
  `modals/LookupHint.tsx`, `modals/Suggestions.tsx` all exist and typecheck, but
  none are rendered from `App.tsx` yet. Still to do for phase 4: the custom-columns
  CRUD dialog, wiring everything into `App.tsx` (dialog open state, `onCreated` →
  select the new listing), suggestions datalists mounted, verification, and the
  `/` route flip. Then phases 5–7 (detail dialog at parity, popup redesign,
  demolition + docs).
- Note for the resuming session: TanStack Table is pinned to v8 (v9 is npm latest
  but has a different API); the `View` menu is column visibility while the topbar
  `Columns` button will be the custom-properties CRUD; D-039 explains why
  filtering/ranking live in `lib/` selectors rather than TanStack filter fns.

## Done

- 2026-08-26: docs restructured to the standard layout (AGENTS.md + docs/). The v1.0
  spec, both amendments, HOW_TO_RUN.md and the old mega-README were deleted; everything
  still load-bearing was migrated here, to DECISIONS (D-001–D-036) and to ARCHITECTURE.
- Milestones 1–3 (skeleton, CRUD + table, custom properties), 4 (eBay), 5 (MOT/reg
  lookup) are built. eBay is sandbox-verified and a real production scrape ran
  successfully on 2026-08-12 (all 5 saved searches, pagination past one page).

## Next

1. **The frontend rebuild** — `docs/FRONTEND_REFACTOR.md`, phases 1–7.
2. **Remaining production eBay checks** — the sandbox couldn't answer these; production
   keys are in, they just haven't been run:
   - import-from-link against a live `ebay.co.uk` URL
   - the `ebay.us`/`ebay.to` shortener redirect (a short link to a van already in the
     table must resolve to the existing row, never a duplicate)
   - a liveness check on an item that has genuinely ended → `is_active=0`
   - the spares/repairs skip firing on a real listing (watch `skipped`)
   - re-run the Taxonomy category lookup on production to confirm the ids in D-003
3. **Milestone 4b — AI enrichment** (`app/ai.py`, via OpenRouter; the scope deviation
   is D-036). Condensed spec:
   - Config: `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` in `.env` (pick a current cheap
     model with Harry when building; verify the chat-completions request/response shape
     against OpenRouter's live docs first). Unconfigured → scrape/import silently skip
     enrichment; a manual analyse endpoint returns 503. `httpx` only.
   - Runs once per **newly inserted** eBay listing (scrape and import), after the
     detail fetch. A failure never fails the scrape; batch-level failures only in
     `errors`. A **Re-analyse** drawer button re-runs on demand.
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
     New columns `vat_status`, `ai_flags` (JSON TEXT), `ai_analysed_at` via
     `db.MIGRATIONS` + `FIELD_SPECS`.
   - Acceptance: rescrape doesn't re-call the model for analysed rows or overwrite
     user edits; a "plus VAT" van sorts by its ×1.2 price; empty key → 4a behaviour
     exactly, app boots.

## Broken

- Nothing known to be broken. Two dormant/untested paths, by circumstance not fault:
  the DVLA VES merge in `mot.py` (no key issued yet — field names verified against
  docs, path untested end-to-end) and the items in "remaining production eBay checks"
  above.
