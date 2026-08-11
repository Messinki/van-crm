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
| 5. MOT + reg lookup — DVSA, `/api/lookup/reg`, MOT column and drawer panel | done (DVLA VES sub-step dormant until a key is set) |
| 6. Polish — inactive strikethrough, error toasts, README | mostly done |

The eBay endpoints exist and are wired to the UI, but return **HTTP 503 with a
plain-English message** ("eBay is not configured yet — …"), which the frontend surfaces
as an error toast or inline hint. Nothing crashes; every other part of the app works.
Filling in `.env` is not enough on its own — `app/ebay.py` still needs writing in
milestone 4.

MOT is live: with the `DVSA_*` values in `.env`, the table's MOT column, the drawer's
MOT panel and the plate lookup all work. Without them they return the same 503s.
`DVLA_VES_API_KEY` is still optional and still unset — the lookup runs MOT-only and
`tax_status` comes back `null` until a key is added; no code change is needed then.

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

**Verified working 2026-08-11** against the live API with the credentials in `.env`. The
response field names match spec §6.3 with no deviations; the only addition worth noting is
that each defect also carries a `dangerous` boolean alongside its `type`, and the app uses
it (a defect counts as dangerous if either says so).

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
- **MOT column** — expiry date (red once it's inside 30 days or past), then small badges: `D3`
  dangerous and `M3` major defect counts over the last three years, and `⚠` for a mileage
  jump backwards or a corrosion/rust/oil-leak/"excessively" wording in a recent defect. Every
  badge has a tooltip. A reg with nothing cached shows a **Check** button in the cell; no reg
  shows `add reg`. Sorting the column sorts by expiry date.
- **Drawer MOT panel** — Check MOT / Refresh, then the vehicle line, latest result and expiry,
  the flagged defect texts, the mileage history newest-first, and a collapsible per-test
  breakdown with defects coloured by severity.
- **Look up plate** — in the drawer and on manual entry. Fills make, model, year, height,
  length, mileage and MOT due, but only where the field is empty, and shows fuel · colour ·
  engine size as a read-only line. It also warms the MOT cache, so a new listing has its MOT
  column filled in without a separate Check.
- **Suggestions on repeated fields** — Make, Model, Year, Location and Seller offer a dropdown of
  values already used on other listings (drawer and manual entry both). Free text either way.
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
- **The MOT summary rides on the listings payload** (replaces the earlier "MOT column is a
  placeholder" decision). `GET /api/listings` runs one extra `SELECT ... FROM mot_cache WHERE
  reg IN (…)` and hangs a compact summary — expiry, result, mileage, defect counts, warning
  flags — on each listing as `mot`. The table renders from that, so the column costs no
  per-row requests, and single-listing responses (create, PATCH, the MOT fetch itself) carry
  the same key so one row can be re-rendered on its own. Attaching happens in the route layer
  (`main.attach_mot`), never in `db.py`; `mot` stays a `DERIVED_KEYS` pseudo-field.
- **Serious-fault flagging uses DVSA's own classification, not AI** — `D`/`M` badges count
  defects typed `DANGEROUS` and `MAJOR` (or carrying `dangerous: true`) across every test
  completed in the last three years, alongside the spec's keyword flags. A fail that was fixed
  on a retest still counts: it's a history signal, not a verdict on the current MOT. Defect
  types the API stopped using (older tests carry `FAIL`, `PRS`, `USER ENTERED`) are bucketed as
  advisories unless flagged dangerous.
- **Reg lookup returns more than Amendment 01 §D asked for** — the response adds `mileage`
  (latest odometer reading), `mot_due` (latest expiry), `colour`, `engine_size` and `fuel_type`
  on top of §D's fields, because the point of the button is to type as little as possible.
  `euro_status` is not in it (that field is gone from the app). Both surfaces fill *only* empty
  inputs, so `mot_due` prefills on a new listing but never overwrites a date the user set.
- **L/H autofill only works for makes that spell the codes out** — the regexes from §C run over
  the MOT model string, which is `RELAY 35 HVY L4H2 ENT BHDI SS` for Citroën/Peugeot but a bare
  `DUCATO` for Fiat. No match leaves both dropdowns blank rather than guessing.
- **MOT errors are never cached** — a 404 or a credentials failure leaves any existing
  `mot_cache` row alone, and the message is surfaced inline (drawer, manual form) or as a toast
  (the table's Check button). The DVSA access token is cached module-level and reused until a
  minute before it expires, so a run of checks costs one token request.
- **`mot_due` is hand-entered, separate from the MOT lookup** — a `date` input in the drawer's MOT
  section and on manual entry, stored as an ISO `YYYY-MM-DD` string in `listings.mot_due` and
  validated server-side (a real calendar date, or null). It gets its own sortable **MOT due**
  column, shown as `14 Mar 2027` and in red once the date has passed. The DVSA lookup prefills it
  from the real expiry when the field is empty, but never overwrites a value the user set — and
  the MOT column beside it always shows what DVSA says, independently of this field.
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
- **Repeated free-text fields suggest what's been typed before** — Make, Model, Year, Location and
  Seller carry `suggest: True` in `FIELD_SPECS`, which gives them a `<datalist>` dropdown of the
  distinct values already on the listings, in the drawer and on manual entry. They stay free text:
  the list is a shortcut, never a constraint, so a new make can still be typed in. The values come
  from `state.listings` in the browser (the frontend already holds every listing) rather than a new
  endpoint, and are rebuilt each time the drawer or the manual form opens. Custom properties don't
  get this — a repeated-value custom field is what a `select` property is for.
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
- **Visibility is opt-out, per surface.** A registry field with no `in_table` / `in_drawer` /
  `section` shows up in *both* the table and the drawer's Details section — adding a field is
  still a one-line change. Hiding it from one surface without hiding it from the other is
  `in_table: False` or `in_drawer: False`. Currently hidden: `is_active` from the drawer (a
  listing is active from the moment it's added; the column defaults to 1), `mot` from the drawer
  (which has its own MOT panel), `thumb` from the drawer (which has its own image strip), and
  `url` / `image_urls` from the table (the title cell and thumbnail carry them).
- **`source` is editable.** It was create-only originally — a listing's origin looked like a fact
  about where it came from, not a preference — but a mis-set source on a manual entry was then
  unfixable, so PATCH now accepts it, validated against `SOURCES` in `clean_listing_fields()`
  like any other select. `POST` just defaults it to `facebook` when omitted.
- **PATCH allowlist** covers only user-editable fields — `id`, `external_id` and all
  timestamps cannot be set through the API.
- **Reg extraction on manual add** runs server-side only (one implementation, not two): if `reg` is
  left blank, the regex runs over title + notes and stores a match only if exactly one distinct
  plate is found.
- **Sandbox/production eBay switching** is via `EBAY_ENV`; both base URLs will be derived from it.

## Notes

- Secrets live only in `.env`, which is gitignored along with `data/`. Nothing logs credentials.
- History lives at <https://github.com/Messinki/van-crm> (`.env` and `data/` never leave this machine).
