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
| 2. Listings CRUD, read-only table, drawer editor, filters, sorting, Add dropdown | done |
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
`DVLA_VES_API_KEY`. It supplies `yearOfManufacture` and fuel type; without it, reg lookup
still returns make/model/year from the MOT source. (`euroStatus` is also available but the app
no longer tracks it — see Decisions made.)

---

## What works right now

- **Table** — thumbnail · Title · Price · Make · Model · Year · Mileage · Height · Length ·
  Reg · Location · Seller · Source · Status · Active · MOT due · MOT · Notes preview · custom
  columns. The order is `main.FIELD_SPECS`' order, with custom columns appended at the end.
- **Read-only table** — the only clickable thing in a row is the Title, which opens the original
  listing in a new tab. Clicking anywhere else in the row opens the drawer, which is where all
  editing happens.
- **Status** is a coloured pill. `rejected` dims the row.
- **Sorting** — click a header; numeric columns sort numerically, blanks always sink to the bottom.
- **Filters** — status chips (multi-select), source, title search, max price, show-inactive.
- **Add listing ▾** — Manual entry (with a Look up button on the plate field) or From eBay link.
  Manual entry's Source can be Facebook, eBay or Manual/other, so an eBay listing can be typed
  in by hand before milestone 4's importer exists.
- **Detail drawer** — click a row; all fields editable, notes autosave 800ms after you stop typing,
  image strip, delete with confirm.
- **Columns modal** — add/rename/reorder/delete custom properties of any type. Deleting a property
  strips its values from every listing.
- **Searches modal** — edit the saved eBay searches now, so they're ready when scraping goes live.

---

## Decisions made

Choices the spec left open, resolved the simplest way:

- **The table is read-only; the drawer is the editor** — this replaces Amendment 01 §A's
  inline-editable cells. The Title link is the only clickable element in a row (it opens the
  original listing); every other cell just displays, and clicking one opens the drawer. Editing
  in two places invited stray clicks that silently changed data.
- **`euro_status` is gone from the app** — every van under consideration is Euro 6, so the column,
  drawer field and manual-entry input were removed, along with the field from `EDITABLE_FIELDS`
  and `db.MIGRATIONS`. Databases created before this keep an unused `listings.euro_status` column.
- **The frontend loads every listing once** (`GET /api/listings?active=-1`) and does all filtering
  and sorting client-side, as §8 requires. `active=-1` means "don't filter on active" — the API
  still honours `active=0`/`active=1`.
- **MOT column is a placeholder** (`—`, or `add reg` when there's no reg); the `Check MOT` button
  lives in the drawer. Probing the cache per row would be one request per listing on load.
  Milestone 5 will add a cached-MOT summary to the listings payload so the column can show
  expiry dates directly.
- **`mot_due` is hand-entered, separate from the MOT lookup** — a `date` input in the drawer's MOT
  section and on manual entry, stored as an ISO `YYYY-MM-DD` string in `listings.mot_due` and
  validated server-side (a real calendar date, or null). It gets its own sortable **MOT due**
  column, shown as `14 Mar 2027` and in red once the date has passed. Milestone 5's DVSA fetch
  fills `mot_cache`; it will be free to prefill this field, but the user's own value stands alone.
- **`description` is gone — notes absorbed it** — one editable free-text field instead of a
  pasted-in read-only block plus a notes box. The manual-entry form's big textarea now writes
  straight to `notes`, the drawer's Description panel is deleted, `description` is out of
  `EDITABLE_FIELDS` (a payload containing it 400s), reg extraction on create scans title + notes,
  and the column is dropped from `SCHEMA` and from `data/vancrm.db`. Existing descriptions were
  merged into notes first. Milestone 4's eBay importer should write the item description into
  `notes`.
- **Notes autosave flushes rather than drops** — `debounce()` exposes `.flush()`, and the notes
  textarea flushes on blur, on drawer close and on `beforeunload` (that last one with
  `fetch(keepalive)`). Before this, a refresh within 800ms of the last keystroke lost the note.
- **Notes preview is 5 words** (`truncateWords`), with the full text on hover via `title` and a
  160px `text-overflow: ellipsis` cap, so a long note can't stretch the row.
- **Custom property keys are slugified from the label and never change**, so renaming a column keeps
  existing values. Renaming to a label that collides with an existing key is rejected at creation time.
- **`custom` merge**: `PATCH {"custom": {"k": v}}` merges; `{"custom": {"k": null}}` (or an empty
  string) removes the key. Unknown keys are rejected with 400.
- **One field registry, `main.FIELD_SPECS`** — the table, the drawer and the manual-entry form
  used to keep three hand-maintained field lists, and they had drifted (`seller_name` and `url`
  were editable but missing from the table; `image_urls` and `is_active` were editable via the
  API with no control anywhere). They now all build from `GET /api/schema`, which serves the
  registry; `EDITABLE_FIELDS` is derived from it too. A startup check refuses to boot if a
  `listings` column is missing from the registry and from `UNMANAGED_COLUMNS`, so a new
  migration can't silently skip the UI.
- **PATCH allowlist** covers only user-editable fields — `id`, `source`, `external_id` and all
  timestamps cannot be set through the API.
- **Reg extraction on manual add** runs server-side only (one implementation, not two): if `reg` is
  left blank, the regex runs over title + notes and stores a match only if exactly one distinct
  plate is found.
- **Sandbox/production eBay switching** is via `EBAY_ENV`; both base URLs will be derived from it.

## Notes

- Secrets live only in `.env`, which is gitignored along with `data/`. Nothing logs credentials.
- No git repository has been initialised yet — run `git init` when you want history.
