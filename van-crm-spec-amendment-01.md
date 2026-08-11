# VanCRM — Spec Amendment 01

Apply on top of `van-crm-spec.md` v1.0. Where this conflicts with v1.0, **this document wins**. Everything not mentioned here is unchanged.

---

## A. Core properties per listing

The canonical property set for every listing is now:

| Property | Column | Notes |
|---|---|---|
| Link | `url` | existing |
| Price | `price_gbp` | existing |
| Make | `make` | existing |
| Model | `model` | existing |
| Height | `height_code` | **new** — TEXT, van size code `H1`–`H3`, e.g. `H2` |
| Length | `length_code` | **new** — TEXT, van size code `L1`–`L4`, e.g. `L3` |
| Year | `year` | existing |
| Number plate | `reg` | existing |
| Mileage | `mileage` | existing |
| Location | `location` | existing |
| Photos | `image_urls` | existing |

### Schema change
Add to `listings` (write an idempotent migration in `db.py` that checks `PRAGMA table_info` and `ALTER TABLE ... ADD COLUMN` if missing — the user may already have data):

```sql
height_code TEXT,     -- 'H1'|'H2'|'H3' or NULL
length_code TEXT,     -- 'L1'|'L2'|'L3'|'L4' or NULL
euro_status TEXT      -- e.g. 'EURO 6', from DVLA lookup (section D); Euro 6 is a hard requirement for the user
```

### Table column order (replaces §8.2 fixed-column list)
thumbnail · Title (links to `url`) · Price · Make · Model · Year · Mileage · Height · Length · Euro · Reg · Location · Source · Status · MOT · then custom property columns · Notes preview.

Make, Model, Euro are inline-editable like the other cells. Height and Length render as small select dropdowns: Length = blank/L1/L2/L3/L4, Height = blank/H1/H2/H3. Codes sort alphabetically, which is also the correct size order.

---

## B. Add button → dropdown

The **Add listing** button in the top bar becomes a dropdown with two options:

1. **Manual entry** → opens the manual-entry modal (section C)
2. **From eBay link** → opens a small modal with one URL field + "Import" button (section D... see section E)

---

## C. Manual entry with number-plate autofill

The manual-entry modal keeps all v1.0 fields plus the new ones (make, model, height, length). New behaviour:

- The **Number plate** field sits at the **top** of the form with a **"Look up"** button beside it.
- Pressing Look up calls `POST /api/lookup/reg` (section D) and autofills: **make, model, year, euro status** (and fuel type, shown as a read-only line under the reg field). Fields the user has already typed into are **not** overwritten — only empty fields are filled.
- Autofilled values remain editable before saving.
- Height and length are size codes, and the lookup response's model string often contains them (e.g. "RELAY 35 **L3H2** BLUEHDI"). After a successful lookup, run regexes `\bL([1-4])\b|L([1-4])H` and `H([1-3])\b` (case-insensitive) over the returned model string; on a match, autofill `length_code`/`height_code` (again, only if empty). No match → leave blank for the user to set from the dropdowns.
- Look up failures show inline under the field ("No record found for this plate" / "Lookup credentials not configured") and never block manual completion of the form.

---

## D. Reg lookup endpoint

`POST /api/lookup/reg` — body `{"reg": "AB12CDE"}`. Merges two government sources and returns one object.

### Source 1 — DVSA MOT History API (already integrated, §6)
Provides: `make`, `model`, `fuelType`, `firstUsedDate` (→ derive `year` as the year component), plus the full MOT history.

**Side effect**: store the response in `mot_cache` keyed by reg, exactly as a normal MOT check would — one API call, and the listing's MOT column is already populated the moment it's created.

### Source 2 — DVLA Vehicle Enquiry Service (VES) — new, optional
- Docs to verify against: https://developer-portal.driver-vehicle-licensing.api.gov.uk — the user requests an API key via the portal's application form (free; add `DVLA_VES_API_KEY=` to `.env` and `.env.example`).
- `POST https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles` with header `x-api-key: {DVLA_VES_API_KEY}` and JSON body `{"registrationNumber": "AB12CDE"}`.
- Useful fields (verify names against docs): `yearOfManufacture`, `euroStatus`, `fuelType`, `engineCapacity`, `taxStatus`, `motStatus`, `make`.
- **VES does not return the model** — that comes from the MOT API.

### Merge rules
- `year`: prefer VES `yearOfManufacture`; fall back to MOT `firstUsedDate` year.
- `make`: prefer MOT (better cased); fall back to VES.
- `model`: MOT only.
- `euro_status`: VES only; `null` if VES not configured or field absent.
- `length_code` / `height_code`: parsed from the MOT model string per section C; `null` if not present.
- If VES key is missing, the endpoint still works MOT-only. If both sources fail, return 404 with a reason string.

Response shape:
```json
{
  "reg": "AB12CDE",
  "make": "CITROEN", "model": "RELAY 35 L3H2 BLUEHDI",
  "year": 2019, "fuel_type": "DIESEL", "euro_status": "EURO 6",
  "length_code": "L3", "height_code": "H2",
  "tax_status": "Taxed", "mot_cached": true,
  "sources": {"mot": true, "ves": true}
}
```

The same endpoint also powers a **"Look up plate"** button in the detail drawer for existing listings (e.g. an eBay listing where the user has just typed in the reg from the photos): it fills only empty fields via PATCH and warms the MOT cache.

---

## E. Import from eBay link

Modal: one field ("Paste eBay listing URL"), an Import button, and a result state.

### Backend: `POST /api/import/ebay` — body `{"url": "..."}`
1. **Extract the legacy item id**: match `/itm/` followed by, or ending in, a run of 9–13 digits (handles both `ebay.co.uk/itm/123456789012` and `ebay.co.uk/itm/some-title/123456789012`; strip query strings first). If the URL is a shortener (`ebay.us`, `ebay.to`), follow redirects with `httpx` (max 5) and parse the final URL. If no id found → 422 "Couldn't find an item id in that URL".
2. **Fetch**: `GET {base}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id={id}` with the standard auth + marketplace headers (verify endpoint path against Browse API docs).
3. **Map** exactly as the scrape upsert does (§5.3), including description, all images, and reg extraction — plus map `localizedAspects[]` where present: aspect names like "Make"→make, "Model"→model, "Year"/"Year of Manufacture"→year, "Mileage"→mileage (strip commas/units). Aspect names vary by seller — match case-insensitively and ignore unrecognised aspects.
4. Insert with `source='ebay'` and the real `external_id`, so the liveness check and future scrapes recognise it (if a later scrape returns the same item, the UNIQUE constraint makes it an update, not a duplicate). If the item already exists in the DB → return 409 with the existing listing id, and the frontend opens that row's drawer instead.
5. Response: the created listing. Frontend closes the modal, prepends the row, opens its drawer, and — if a reg was extracted — shows a hint "Reg found: AB12 CDE — look up?".

---

## F. Milestone & acceptance updates

- Milestone 2 now includes: schema migration, new columns in table/drawer/manual modal, Add dropdown (manual path only).
- Milestone 4 (eBay) now includes: import-from-link (section E).
- Milestone 5 (MOT) now includes: `POST /api/lookup/reg` with MOT-only merge; VES is a sub-step that activates when the key is present.

Additional acceptance criteria:
- [ ] Manual entry: typing a real reg and pressing Look up fills make/model/year without overwriting a make the user already typed; MOT column is populated on the new row without a separate Check
- [ ] Pasting a full eBay URL (with title slug and query string) imports the listing with photos and description; pasting the same URL again opens the existing row rather than duplicating
- [ ] Height/length are L/H code dropdowns; a lookup whose model string contains "L3H2" autofills both codes; sorting by Length orders L1→L4
- [ ] With no DVLA key configured, reg lookup still returns make/model/year from the MOT source
