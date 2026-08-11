# VanCRM

A personal, local-only web app for tracking vans for sale while shopping for a camper conversion base.
Single user, runs on your own machine, no auth, no deployment.

Spec: [van-crm-spec.md](van-crm-spec.md) + [van-crm-spec-amendment-01.md](van-crm-spec-amendment-01.md)
(the amendment wins where they conflict).

---

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # leave the keys blank until approvals land
.venv/bin/uvicorn app.main:app --port 8321
```

Then open <http://localhost:8321>.

The database is created at `data/vancrm.db` on first run and seeded with five saved
searches. Deleting that file resets everything.

---

## Build status

| Milestone | State |
|---|---|
| 1. Skeleton — structure, `.env`, schema + migrations + seeds | done |
| 2. Listings CRUD, table, inline edit, drawer, filters, sorting, Add dropdown | done |
| 3. Custom properties — typed columns, Columns modal | done |
| 4. eBay — auth, scrape, upsert, import-from-link, liveness | **not started** (waiting on dev account) |
| 5. MOT + reg lookup — DVSA, DVLA VES, `/api/lookup/reg` | **not started** (waiting on credentials) |
| 6. Polish — inactive strikethrough, error toasts, README | mostly done |

The eBay and MOT endpoints exist and are wired to the UI, but return **HTTP 503 with a
plain-English message** ("eBay is not configured yet — …"), which the frontend surfaces
as an error toast or inline hint. Nothing crashes; every other part of the app works.
Filling in `.env` is not enough on its own — the client modules (`app/ebay.py`,
`app/mot.py`) still need writing in milestones 4 and 5.

---

## Getting credentials

### eBay (milestone 4)
1. Sign up at <https://developer.ebay.com> and create an application.
2. Use the **Production** keyset's App ID as `EBAY_CLIENT_ID` and Cert ID as `EBAY_CLIENT_SECRET`.
3. Sandbox keys are issued immediately and work against the same code — set `EBAY_ENV=SANDBOX`
   to point at `api.sandbox.ebay.com` while production approval is pending.
4. Category IDs are deliberately not hardcoded. During milestone 4 they will be resolved via the
   Taxonomy API (`getCategorySuggestions` for "vans", marketplace `EBAY_GB`) and documented here.

### DVSA MOT History API (milestone 5)
Apply via the registration form linked from <https://documentation.history.mot.api.gov.uk>.
On approval DVSA emails a client ID, client secret, scope URL, access-token URL and API key —
these map to `DVSA_*` in `.env`. Note the API key is revoked if unused for 90 days.

This is the *new* (2023+) MOT History API. Anything referencing `beta.check-mot.service.gov.uk`
or `Accept: application/json+v6` is the old API and does not apply.

### DVLA Vehicle Enquiry Service (optional, milestone 5)
Request a free key from <https://developer-portal.driver-vehicle-licensing.api.gov.uk> and set
`DVLA_VES_API_KEY`. It supplies `euroStatus` and `yearOfManufacture`; without it, reg lookup
still returns make/model/year from the MOT source.

---

## What works right now

- **Table** — thumbnail · Title · Price · Make · Model · Year · Mileage · Height · Length ·
  Euro · Reg · Location · Source · Status · MOT · custom columns · Notes preview.
- **Inline editing** — click any editable cell for an input; Enter or blur saves, Escape cancels.
  The Title cell is *double-click* to edit, so single-click can follow the link.
  Height/Length are dropdowns (blank/H1–H3, blank/L1–L4).
- **Status** is always a coloured pill select. `rejected` dims the row.
- **Sorting** — click a header; numeric columns sort numerically, blanks always sink to the bottom.
- **Filters** — status chips (multi-select), source, title search, max price, show-inactive.
- **Add listing ▾** — Manual entry (with a Look up button on the plate field) or From eBay link.
- **Detail drawer** — click a row; all fields editable, notes autosave 800ms after you stop typing,
  image strip, description, delete with confirm.
- **Columns modal** — add/rename/reorder/delete custom properties of any type. Deleting a property
  strips its values from every listing.
- **Searches modal** — edit the saved eBay searches now, so they're ready when scraping goes live.

---

## Decisions made

Choices the spec left open, resolved the simplest way:

- **Title cell is double-click to edit** — the spec lists Title as inline-editable *and* as a link
  to the listing. Single-click follows the link; double-click edits.
- **The frontend loads every listing once** (`GET /api/listings?active=-1`) and does all filtering
  and sorting client-side, as §8 requires. `active=-1` means "don't filter on active" — the API
  still honours `active=0`/`active=1`.
- **MOT column shows a `Check` button whenever a reg is set**, without first probing the cache per
  row (that would be one request per listing on load). Milestone 5 will add a cached-MOT summary to
  the listings payload so the column can show expiry dates directly.
- **Custom property keys are slugified from the label and never change**, so renaming a column keeps
  existing values. Renaming to a label that collides with an existing key is rejected at creation time.
- **`custom` merge**: `PATCH {"custom": {"k": v}}` merges; `{"custom": {"k": null}}` (or an empty
  string) removes the key. Unknown keys are rejected with 400.
- **PATCH allowlist** covers only user-editable fields — `id`, `source`, `external_id` and all
  timestamps cannot be set through the API.
- **Reg extraction on manual add** runs server-side only (one implementation, not two): if `reg` is
  left blank, the regex runs over title + description and stores a match only if exactly one distinct
  plate is found.
- **Sandbox/production eBay switching** is via `EBAY_ENV`; both base URLs will be derived from it.

## Notes

- Secrets live only in `.env`, which is gitignored along with `data/`. Nothing logs credentials.
- No git repository has been initialised yet — run `git init` when you want history.
