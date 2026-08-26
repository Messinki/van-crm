# Status

Living document — describes *now*. Rewrite freely; nothing here is history.

## Current goal

Refactor the codebase (Harry's stated next step). Before that starts, the uncommitted
working-tree changes below need verifying and committing — refactoring on top of a
dirty tree loses the ability to bisect.

## In flight — uncommitted in the working tree (as of 2026-08-26)

- **Bulk Check live sweep** — `ebay.check_all` + `CHECK_PROGRESS`, the
  `/api/listings/check-all` endpoints and the topbar button. Described as working in
  the old README, but never committed.
- **A large frontend overhaul in `app.js`/`style.css`** (~800 lines): a filter bar with
  per-property condition editors (range/set/bool), popover UI, a ranking panel with
  weighted scores (including a length-code ordering), and filter/rank state persisted
  to `localStorage`. Not described in any doc; needs a look before committing.

## Done

- 2026-08-26: docs restructured to the standard layout (AGENTS.md + docs/). The v1.0
  spec, both amendments, HOW_TO_RUN.md and the old mega-README were deleted; everything
  still load-bearing was migrated here, to DECISIONS (D-001–D-036) and to ARCHITECTURE.
- Milestones 1–3 (skeleton, CRUD + table, custom properties), 4 (eBay), 5 (MOT/reg
  lookup) are built. eBay is sandbox-verified and a real production scrape ran
  successfully on 2026-08-12 (all 5 saved searches, pagination past one page).

## Next

1. Verify and commit the in-flight work above.
2. **The refactor** (scope to be agreed at the start of that session).
3. **Remaining production eBay checks** — the sandbox couldn't answer these; production
   keys are in, they just haven't been run:
   - import-from-link against a live `ebay.co.uk` URL
   - the `ebay.us`/`ebay.to` shortener redirect (a short link to a van already in the
     table must resolve to the existing row, never a duplicate)
   - a liveness check on an item that has genuinely ended → `is_active=0`
   - the spares/repairs skip firing on a real listing (watch `skipped`)
   - re-run the Taxonomy category lookup on production to confirm the ids in D-003
4. **Milestone 4b — AI enrichment** (`app/ai.py`, via OpenRouter; the scope deviation
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
