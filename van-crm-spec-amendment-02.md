# VanCRM — Spec Amendment 02

**Date:** 2026-08-12 · **Status:** agreed with the user, not yet built.
Wins over v1.0 and Amendment 01 wherever they conflict. Section A closes out milestone 4;
section B defines **milestone 4b**, the next piece of work.

Decisions here were made explicitly by the user on 2026-08-12:

- Scraped/searched vans **insert straight into the listings table** with status `new`;
  triage happens there (keep = change status, archive = archived/rejected status). No
  separate review-queue surface.
- Search definition stays the spec's **saved-searches + one Scrape button** model
  (the Searches modal, now with year min/max, is that UI).
- AI enrichment (section B) runs **automatically on import** for each new eBay listing.
- Extraction targets: **size code, VAT status + comparable price, mileage (with MOT
  cross-check), condition red flags**.
- **Spares/repairs vans are never to be considered at all** — milestone 4a already skips
  eBay condition `7000` at scrape time; section B extends that to wording-only cases.

---

## A. Production verification (milestone 4a close-out)

Production keys are now in `.env` (`EBAY_ENV=PRODUCTION`, confirmed a PRD keyset,
2026-08-12). Run the checks the sandbox couldn't answer — the authoritative list lives in
the README build-status section ("Deferred until production keys arrive"):

1. A real scrape across the 5 saved searches: actual van volume, pagination past page 1,
   whether the seeded search wording yields sensible results.
2. Import-from-link with a real `ebay.co.uk` URL (slug + query string).
3. The `ebay.us` / `ebay.to` shortener redirect path. Note the design intent the user
   restated: a pasted **short link to a van already in the table must resolve to the
   existing row** (redirect → item id → `(source, external_id)` dedupe → 409 → drawer
   opens), never a duplicate. The id-extraction half is unit-tested; verify the
   redirect-following half live.
4. A liveness check against a listing that has genuinely ended → `is_active=0`.
5. The spares-or-repairs skip firing on a real listing (watch `skipped` in the summary).
6. Re-run the Taxonomy `getCategorySuggestions` lookup on production and confirm the ids
   recorded in the README (122202, 14256) — they came from the sandbox tree.

Record outcomes in the README build status and strike the deferred list.

---

## B. Milestone 4b — AI enrichment (`app/ai.py`)

### Deviation from the v1.0 non-goals, on purpose

v1.0 says "no AI scoring or summarising". This feature is **field extraction**, not
scoring: a cheap model reads the listing title + description and returns structured
facts. All judgement calls (VAT maths, mileage comparison, archiving) are deterministic
Python. It is opt-in via the key and the app runs identically without it. Record this
deviation in the README's Decisions made when built.

### Configuration

- `.env` gains `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (model id string; pick a
  current cheap model with the user when building — do not hardcode a default from
  memory). Add both to `.env.example`, blank.
- Unconfigured (either var empty) → scrape/import silently skip enrichment; the manual
  analyse endpoint returns 503 with a plain-English message. The empty-`.env` boot rule
  holds.
- Calls go through `httpx` to OpenRouter's chat-completions endpoint — the
  four-dependency rule holds. Verify request/response shape against OpenRouter's live
  docs before coding (same rule as eBay/DVSA).

### When it runs

- Automatically, once, for each **newly inserted** eBay listing (scrape and
  import-from-link both), after the detail fetch — the description is in `notes` by then.
- An enrichment failure (timeout, bad JSON, 4xx) must never fail the scrape — same rule
  as the MOT cache warm. Log to the scrape summary's `errors` only if the whole batch
  failed (e.g. bad key), not per-item noise.
- A **Re-analyse** button in the drawer (eBay rows, or any row with notes) re-runs it on
  demand and is the manual endpoint above.

### What the model extracts (strict JSON, one call per listing)

| Field | Values | Notes |
|---|---|---|
| `size_code` | `L1H1`…`L4H3`, or null | Normalise SWB/MWB/LWB/XLWB and "high roof"/"low roof" wording to L/H codes where the mapping is unambiguous for that make/model; otherwise null. Existing Amendment 01 §C height/length dropdowns are the target fields. |
| `vat_status` | `plus_vat` / `no_vat` / `inc_vat` / null | From "plus VAT", "+ VAT", "NO VAT", "inc VAT" wording. Null when unstated. |
| `mileage` | integer or null | Only when the description states it. |
| `flags` | array of short strings | Red flags worth surfacing: rust/corrosion, cat S/N write-off, non-runner, no MOT, ex-fleet, spares/repairs wording. Tags, not scores or prose. |

### Deterministic post-pass (Python, not the model)

- **VAT**: store `vat_status`; the table shows a **comparable price** — `price_gbp × 1.2`
  when `plus_vat`, otherwise `price_gbp` — so sorting is honest. Computed (derived), not
  a stored column.
- **Mileage vs MOT**: compare extracted mileage with the latest MOT odometer reading
  (already in the cached MOT data). Consistent (≥ latest MOT reading) and
  `listings.mileage` empty → fill it. **Below** the latest MOT reading → do not fill;
  add a clocking red flag to `flags`.
- **Spares/repairs wording** in `flags` → set the listing's status to archived/rejected
  automatically (it stays inserted so the `(source, external_id)` UNIQUE dedupe stops it
  returning on the next scrape — this catches listings the condition-id skip missed).

### Fill rules

AI-derived values only ever **fill empty fields**; nothing the user typed is ever
overwritten (same rule as reg lookup). Every enriched listing records `ai_analysed_at`.

### Schema (via `db.MIGRATIONS` + `FIELD_SPECS`, per CLAUDE.md conventions)

New `listings` columns: `vat_status`, `ai_flags` (JSON array TEXT, decoded in
`row_to_listing`), `ai_analysed_at`. Size lands in the existing Amendment 01 height/length
fields, not a new column. Suggested surfaces (implementer may adjust): `vat_status` in
table + drawer; `ai_flags` rendered as warning badges in the table (tooltip = full tag),
read-only in the drawer; `ai_analysed_at` drawer-only, read-only; comparable price as a
derived table column next to Price. The startup registry check will force these decisions
anyway.

### Verification criteria

- [ ] A scrape of real listings fills vat_status/size/flags on new rows; a rescrape does
      not re-call the model for already-analysed rows and overwrites nothing user-edited
- [ ] A "plus VAT" van sorts by its ×1.2 comparable price
- [ ] A listing whose description mileage is below its latest MOT odometer gets a
      clocking flag and its mileage field stays empty
- [ ] A listing with spares/repairs wording (but a normal condition id) is auto-archived
- [ ] With `OPENROUTER_API_KEY` empty: scrape works exactly as milestone 4a, Re-analyse
      returns 503, app boots
