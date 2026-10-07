# Plan: ranking, data clean-up and description hints (2026-10-07) — done

Seven phases (phase 7 added after phase 5), done in order, each by a fresh agent. Each phase ends in one or more
verified commits. When a phase is done, tick its box here and note anything the
next phase needs under **Handover** at the bottom.

- [x] Phase 1 — Ranking and every price use the inc-VAT price
- [x] Phase 2 — Fix focus loss while typing in the popup's fields
- [x] Phase 3 — One spelling per make and model
- [x] Phase 4 — "Time until MOT" ranking factor
- [x] Phase 5 — Remember rejected plates and flag relisted vans
- [x] Phase 6 — Highlight VAT and size terms in the description
- [x] Phase 7 — Stop model codes being read as number plates (added after phase 5)

## Rules for every phase

- Read `AGENTS.md` (the project rules), `docs/STATUS.md`, and the parts of
  `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` the phase touches before you write
  code. Follow the **Do not regress** list in AGENTS.md.
- A non-obvious choice gets a `docs/DECISIONS.md` entry (next free D-number, in the
  file's own format) **before** it's implemented. Where this plan already makes the
  choice, the entry records it — don't re-open it unless the code proves it wrong,
  and if it does, say so in Handover.
- Commit each verified step: `type: imperative summary (D-0xx)`, ending with the
  `Co-Authored-By` line from the session. Never commit a broken state, `.env`,
  `data/` or `app/static/dist/`. Don't push — the session that launched you will.
- Verify against the running app. The frontend check is a clean `npm run build`
  in `frontend/`. Start the backend with
  `.venv/bin/uvicorn app.main:app --port 8321` in the background if nothing is
  listening on 8321, and stop it when you're done if you started it. Previous
  sessions verified the UI with headless Playwright scripts (system Chrome) kept in
  the session scratchpad, not the repo; do the same.
- `data/vancrm.db` is Harry's real data (≈380 listings). Tests create and delete
  their own listings. Before anything that rewrites existing rows (phase 3, phase 5's
  backfill), copy the DB to `data/vancrm.db.bak-<phase>` first.
- Update `docs/STATUS.md` (current goal = this plan, which phase is done) and, if
  structure changed, `docs/ARCHITECTURE.md`, in the commit that caused it. The
  CHANGELOG entry is written once, after the last phase.

---

## Phase 1 — Ranking and every price use the inc-VAT price

**Want:** a Plus VAT van ranks, sorts, filters and shows by its price × 1.2, and
any price feature added later does the same without having to remember to.

**What's there:** `effectivePrice()` in `frontend/src/lib/format.ts` (D-043).
`sortValue(listing, 'price_gbp')` in `lib/filtering.ts` returns it, and
`rankScores()` in `lib/ranking.ts` reads price through `sortValue`, so ranking
*looks* right already.

**Do:**
1. Audit every read of `price_gbp` in `frontend/src` (cells, `AllVansMap.tsx`,
   `visible.ts`, `distance.ts`, `DetailFields.tsx`, filters, rank) and in `app/`.
   Each one must either go through `effectivePrice()` / `sortValue()`, or be a place
   that deliberately shows or edits the *listed* figure (the price box itself, the
   "listed £x + VAT" note). Fix any that don't; comment the deliberate ones.
2. Confirm with a real check: two scratch listings, one £10,000 Plus VAT and one
   £11,000 without — with rank on and only Price weighted, the £11,000 van must
   rank above the Plus VAT one (it's £12,000 really). Same for the price column sort,
   a price range filter (≤ £11,500 keeps the £11,000 one only) and the map card.
3. Make it stick: add a rule to AGENTS.md's Rules (one line: anything that
   compares, sorts, ranks, filters or totals price uses `effectivePrice()`, never
   `price_gbp` directly) and a pointer comment beside `price_gbp` in `FIELD_SPECS`.

If nothing was wrong, the commit is just the rule + comments — say so in Handover.

## Phase 2 — Fix focus loss while typing in the popup's fields

**Want:** typing in Make, Model, Location, Seller etc. in the listing popup keeps
focus; today the box loses focus after every letter.

**Likely cause (confirm it):** popup fields are uncontrolled inputs keyed on their
saved value (D-040), but they save from React's `onChange`, which fires on every
keystroke, not on blur. Each letter saves → the query cache updates → the `key`
changes → the input remounts → focus is gone. It probably hits every text/number
input in `DetailFields.tsx` (`EditableField`'s input, `PriceField`, `LocationField`,
`UrlField`, and the textarea branch for image URLs), not only the ones with
suggestions — the suggestion boxes are just where it's noticed. The manual-entry
form is controlled and probably fine; check it anyway.

**Do:** save on commit, not per keystroke — on blur and on Enter, plus straight
away when a value is picked from the suggestion list (a datalist pick arrives as an
input event whose `inputType` is `insertReplacementText` or missing — check this in
Chrome). That's the save-on-blur behaviour D-040 says it wanted. Make sure an edit
in progress is **not lost** when the popup closes (Esc, click outside), or ←/→ /
next-listing moves to another van while the cursor is still in the box — the notes
field already solves this with a flush (`flushRef` in `DetailDialog.tsx`); reuse
that idea. Record the change as a decision that supersedes the relevant part of
D-040.

**Verify:** Playwright: open a listing, type a multi-letter make into Make one key
at a time, focus stays and the full value saves; pick a suggestion — it saves;
type then press Esc immediately — the value is saved; type then press → — saved on
the right listing. Number fields (Price, Mileage) and the plate lookup still work.

## Phase 3 — One spelling per make and model

**Want:** `CITROEN`, `Citroen`, `citroen` and `Citroën` are one make; `relay`,
`RELAY` and `RELAY 35 L3H2 EPRISE BHDI S/S` are one model. Filters and the
suggestion lists show each once.

**What the data looks like now** (makes): Peugeot 82, Fiat 61, Citroen 58, Renault
47, Nissan 23, Citroën 21, Vauxhall 6, VAUXHALL 6, CITROEN 6, PEUGEOT 4, … Models
include `Relay`, `RELAY`, `nv400`, `Renault master`, `Ducato 35 H/R P/V Multijet`,
`BOXER 435 PRO L4H2 BLUEHDI` — the long ones come from DVSA's model string via the
plate lookup and from eBay aspects.

**Decided:**
- **Make:** strip accents, title-case — `Citroen`, `Peugeot`, `Vauxhall`. A small
  alias map handles the rest: `VW` → `Volkswagen`, `Mercedes`/`Mercedes Benz` →
  `Mercedes-Benz`, and all-caps brands stay caps (`LDV`, `MAN`). `Citroen` without
  the accent because it's the majority spelling and what eBay and DVSA send.
- **Model:** reduce to the base model. A known list per make (Relay, Boxer, Ducato,
  Jumper, Master, Movano, Interstar, NV400, Transit, Transit Custom, Sprinter,
  Crafter, Trafic, Vivaro, Daily, Movano …) is matched case-insensitively against
  the start of the model string, after dropping a leading make name ("Renault
  master" → `Master`). A match becomes the canonical spelling (`NV400`, not
  `Nv400`). No match → title-case each word, keeping any word with a digit in caps.
  Before a long model string is cut down, run it through `parse_size_codes()` and
  fill `length_code`/`height_code` if they're empty, so the L/H codes aren't lost.
  The trim detail (`35 HVY`, `EPRISE BHDI`) is dropped — accepted.
- **Where:** one Python function (a small new module, e.g. `app/normalise.py`, is
  fine — stdlib only) applied on every write path: create/PATCH validation in
  `main.py`, eBay `_listing_fields` (scrape and import), and the plate-lookup
  suggestions (`make`/`model` it hands the UI). Plus a one-off, idempotent pass over
  existing rows at startup (or a one-shot script — your call, record it). Back the DB
  up first.
- The frontend's `Suggestions` list may also dedupe case-insensitively as a belt and
  braces, but the fix is the stored data.

**Verify:** after the pass, `SELECT make, count(*) … GROUP BY make` and the same for
model show one spelling each; a PATCH with `make: "CITROËN"` stores `Citroen`; a
lookup suggestion comes back normalised; the Make filter chip lists each make once.

## Phase 4 — "Time until MOT" ranking factor

**Want:** a new rank factor where a year or more of MOT left is best and an MOT
about to run out is worst, on an exponential curve that keeps half a year
"still OK".

**Decided:**
- Days left `d` = MOT expiry − today. Expiry is the DVSA one (`listing.mot.expiry`)
  when cached, otherwise the hand-entered `mot_due`. No date at all → neutral 0.5,
  like the other factors. Expired (`d ≤ 0`) → 0.
- Score = `(1 − e^(−d/τ)) / (1 − e^(−365/τ))`, capped at 1, with τ = 130 days. That
  gives about 0.22 at 1 month, 0.54 at 3 months, 0.80 at 6 months, 0.93 at 9 months
  and 1.0 from a year on — rising fast early, flattening out, never penalising a
  long MOT. Put τ and the 365-day cap as named constants beside the function.
- Unlike price and mileage this is **not** min–max normalised across the rows on
  screen: the curve is absolute, so a van with 11 months doesn't score 0 just
  because everything else has 12. Record that as a decision.
- Factor key `mot`, label "MOT left". Default weight 0, so saved rank settings
  don't shift (the way `distance` was added — see the comment on `DEFAULT_RANK`).
  Wire it through everything that lists rank factors: `RANK_FACTORS`, `ScoreParts`,
  the rank panel sliders, and any score breakdown/tooltip that shows the parts.

**Verify:** a unit-ish check of the curve values above (a tiny script, or a
console check); then in the app with only MOT weighted: scratch vans with 20 days,
200 days, 400 days and no date order 400 → 200 → none → 20.

## Phase 5 — Remember rejected plates and flag relisted vans

**Want:** when a van is rejected its plate is remembered, so if it's relisted
(a new eBay item, or entered by hand again) it's flagged as already rejected.

**Decided:**
- New table `rejected_regs` (reg TEXT PRIMARY KEY, listing_id, title,
  rejected_at), created in `db.py`'s schema. A table rather than reading it off the
  listings, because a rejected listing can be deleted and the memory must survive
  that. Regs stored cleaned with `mot.clean_reg()`.
- Written whenever a listing's status becomes `rejected` (any path — PATCH, the
  Reject button, future auto-reject) and it has a reg; also when a rejected
  listing's reg is set or changed later. Un-rejecting (status back to anything
  else) removes that listing's row. One-off backfill from existing rejected
  listings that have a reg (≈45). Back the DB up first.
- The flag is derived at read time, not stored: each listing in the API payload
  gets `rejected_before` = `{listing_id, title, rejected_at}` when its reg is in
  `rejected_regs` under a *different* listing id, else null. Because it's derived, a
  plate that's only extracted or looked up later still triggers it.
- Register it as a derived pseudo-field in `FIELD_SPECS` (+ `DERIVED_KEYS`), not
  editable, so it can show as a column/badge and be filtered — follow how `mot` and
  `distance` are registered. Show it as a warning pill ("Rejected before") in the
  table (beside the title or status) and in the popup, with a tooltip giving the old
  title and date; clicking it in the popup may open the old listing if it still
  exists.
- The scrape does **not** auto-reject a relisted van — flag only.

**Verify:** reject a scratch van with plate AB12CDE; create another with the same
plate (and one with it typed `ab12 cde`) → both flagged with the first one's title;
un-reject the first → flags clear; reject again, delete the first → flag stays.
The registry startup check still passes.

## Phase 6 — Highlight VAT and size terms in the description

**Want:** in a listing's description (the `notes` field — eBay descriptions land
there; manual entries are pasted there too), these terms are highlighted yellow:

- **VAT:** "plus VAT", "+ VAT", "+VAT", "ex VAT", "excl(uding) VAT", "no VAT",
  "VAT free", "no VAT to add" — case-insensitive.
- **Size codes:** `L1H1`…`L4H3`, with optional space ("L3 H2"), any case.
- **Wheelbase:** "long/medium/short/extra long wheelbase" and "wheel base",
  `LWB`, `MWB`, `SWB`, `ELWB`, `XLWB` — whole words only (so not inside other
  words).

**Decided:**
- One matcher module, `frontend/src/lib/keywords.ts`, exporting the patterns and a
  function that splits text into plain/highlighted segments. Plain regex, no AI —
  this stays inside D-036's limits.
- A `<textarea>` can't colour its own text, so use the backdrop technique: a
  `div` behind a transparent-background textarea with identical font, padding,
  wrapping and scroll, rendering the same text with `<mark>` around matches; keep
  the scroll positions in sync. Wrap it as one component and use it for the notes
  box in the popup (`NotesField` in `DetailFields.tsx`, keeping its debounce/flush)
  and the notes box in the manual-entry form. Yellow that reads in light and dark
  themes.
- Highlight only. No auto-filling of `vat_status` or size codes from the matches
  (that's milestone 4b's job).

**Verify:** Playwright: a scratch listing whose notes contain "£9,500 plus VAT,
L3H2, long wheel base, MWB, no vat, Swbxyz" — the six real terms get marks, "Swbxyz"
doesn't; typing new matching text highlights live; caret, selection and scrolling
in a long description still line up with the text; dark mode readable.

## Phase 7 — Stop model codes being read as number plates

Added after phase 5 found it (see STATUS "Broken"). `mot.extract_reg()` reads
Renault Master model codes such as "LM35dCi" / "MM35dCi" in a title as a plate
(`LM35DCI`), so those listings carry a bogus reg — and three of them (2302, 2067,
2076) now show a false "Rejected before" flag.

**Decided:**
- A current-style plate (two letters, two digits, three letters) is only accepted
  if its age identifier has been issued: March codes `02`…current two-digit year,
  September codes `51`…current year + 50 (only once September of that year has
  begun). Today (2026-10) that allows up to `26` and `76`. Compute from today's
  date, don't hardcode. Apply it inside `extract_reg()` so every caller benefits.
- Clean up existing data: back up the DB to `data/vancrm.db.bak-phase7`, then clear
  `reg` on listings whose stored reg is a current-style plate that fails the
  check, and remove matching `rejected_regs` rows (use `app/rejected.py`'s own
  functions so its invariants hold). A one-off startup pass or a one-shot script —
  match whatever phase 3/5 did and record it. List the cleared listings in Handover.
- Hand-typed regs through PATCH: check what `clean_reg()` / D-015 validation does
  today; reject a not-yet-issued age identifier there too only if that's a small,
  consistent change — otherwise leave hand entry alone and say so.

**Verify:** `extract_reg("Renault Master LM35dCi 2015")` → None,
`extract_reg("2018 PE18 OGB")` → `PE18OGB`, a `76` September plate accepted, a `77`
refused; after the clean-up the three false flags are gone and the real relists
(2043 BF68VHJ, 1963 CF69GFX) are still flagged. Remove the item from STATUS
"Broken".

---

## Handover

(Each phase adds a few lines here: what was done, anything surprising, anything
the next phase should know.)

**Phase 1 (2026-10-07, D-051).** Nothing was actually wrong: every compare, sort,
filter, rank and map read already went through `effectivePrice()`/`sortValue()`,
and the backend never compares prices (only eBay's search `min_price`/`max_price`,
which is the listed figure on purpose). The one stray was `VatTotal` ("= £x inc.
VAT") repeating the × 1.2 sum — now it calls `effectivePrice()`. The table cell and
map card null-check `effectivePrice()` instead of `price_gbp`; the popup box and
the "Listed at" tooltip are commented as deliberate listed-price reads. Rule added
to AGENTS.md, pointer comment beside `price_gbp` in `FIELD_SPECS`. Verified in
headless Chrome against the live app with two scratch vans (£10,000 Plus VAT,
£11,000): price-only rank (isolated and across all 142 visible rows), price column
sort both ways, ≤/≥ £11,500 filters, table cell + tooltip, popup box/total, manual
form total, both map cards — all correct; scratch vans deleted. Phase 4 note: a
new rank factor goes in `RANK_FACTORS`, `RANK_LABELS`, `DEFAULT_RANK.weights`,
`ScoreParts` and `rankScores()` in `lib/ranking.ts`; `store.ts` restores weights
by iterating `RANK_FACTORS`, so a new factor defaults from `DEFAULT_RANK`.

**Phase 2 (2026-10-07, D-052).** Cause confirmed as planned: every popup box saved
from `onChange` and was keyed on its saved value, so the first letter remounted it
(repro: typing "Renault" left "R" in the box and focus on the dialog). New
`useCommit()` hook in `DetailFields.tsx` holds the edit and saves on blur, Enter
(not in the image-URL textarea), a picked value, and unmount; boxes are no longer
keyed — an effect writes the saved value in when no edit is in progress. Applied to
every text/number/date box, Price, Location, Link, image URLs, text custom
properties and the plate (`PlateField` gained `onBlur`/`onKeyDown` pass-throughs;
the plate's old focus-check workaround is gone). Selects and checkboxes unchanged.
Esc/click-outside/next-van need no dialog-level flush registry: the body is keyed
on the listing id and closing unmounts it, so each box's unmount saves. Verified
in headless Chrome (all PASS): focus kept on every key with zero PATCHes until
commit; Tab and Enter save (focus kept after Enter); Price, Mileage, Year, MOT
date; Esc and click-outside right after typing save; typing then the next-listing
chevron saves on the van left and the next van shows its own value; ↑ inside a box
doesn't change van; image URLs keep Enter as newline; custom property; plate typed
`pe18ogb` + Enter saves `PE18OGB` and the box tidies to `PE18 OGB` in place;
plate lookup fills Make/Model into the boxes; manual-entry form unaffected.
**Not verified:** a real datalist pick in Chrome — headless Chrome never opens the
suggestion popup, so the pick was simulated with both event shapes (a plain
`Event` and `insertReplacementText`), both of which save at once. Chrome's own
spinner and date-picker changes arrive as a plain `Event` (observed), which is why
the plain-Event rule is believed to match datalist picks too. Worst case, if a real
pick looked like typing, it would save on blur instead — nothing is lost. Note the
plan's "type then press →": since D-045, ←/→ are photos and arrows inside a box
only move the caret, so the next-van path tested was the chevron and Esc.
For phase 3: once a box commits, whatever the server stores is written back into
it (even while it keeps focus after Enter), so a server-side make/model tidy will
show in the popup with no extra frontend work. The lookup still hands the UI raw
DVSA casing today (`FIAT` / `DUCATO` in the test). Side effect of the test: one real
lookup of an existing van's plate (PE18OGB) refreshed its MOT cache row.

**Phase 3 (2026-10-07, D-053).** New `app/normalise.py` holds the make/model rules
and `parse_size_codes()` (moved from `main.py`, which re-imports it). `tidy()` runs
at the end of `clean_listing_fields()` (create + PATCH) and of eBay
`_listing_fields()` (scrape + import); the plate lookup returns
`canonical_make()`/`canonical_model()` while its size codes still come from the raw
DVSA string. Existing rows: an idempotent `tidy_all()` at startup (my call — catches
anything an older build writes; leaves `updated_at` alone). DB backed up to
`data/vancrm.db.bak-phase3` first. Real data: 54 rows changed — makes went from 15
spellings (+ empty) to 8 (Peugeot 86, Citroen 85, Fiat 63, Renault 51, Nissan 24,
Vauxhall 12, Ford 4, AMC 2; 57 empty), models from 29 to 11 (Relay 90, Boxer 85,
Ducato 62, Master 50, NV400 18, Movano 12, Transit 3, Sprinter 2, Transit Custom 1,
Interstar 1, Other 1; 59 empty). Two Boxers gained size codes from their long model
string (L4H2, L3H2); nothing but make/model/size codes differs from the backup. Two
deviations from the plan's letter, both in D-053: the base-model list is matched
across all makes (many eBay rows have no make), and when the make is empty and the
model began with one (`Renault master`), that make is kept rather than thrown away
(2 rows). `AMC` is a parts brand on two junk listings; it's in the stay-capitals
list. `Renault | Other` is left as is — the title says Master but nothing is
inferred from titles. The frontend `Suggestions` datalists also merge spellings
case/accent-insensitively (most-used spelling wins). Verified: second pass changes
0 rows; POST with `citroën` + `RELAY 35 L3H2 EPRISE BHDI S/S` → `Citroen`/`Relay`/L3/H2;
PATCH `CITROËN` → `Citroen`; PATCH with explicit codes keeps them; lookup PE18OGB
(from cache, no DVSA call) → `Fiat`/`Ducato`; `_listing_fields` with fake aspects;
headless Chrome: Make and Model filter chips and both datalists list each value
once, and typing `CITROËN` + Enter in the popup shows `Citroen`. Not exercised: a
live eBay scrape/import (only the field-building function was run offline). For
later phases: a `Relay` no longer carries its trim, so anything wanting `L3H2`
text from the model must read `length_code`/`height_code` instead.

**Phase 4 (2026-10-07, D-054).** Built as planned, no deviations. `lib/ranking.ts`
gained factor `mot` ("MOT left", default weight 0), `MOT_TAU_DAYS = 130`,
`MOT_FULL_DAYS = 365`, an exported `motCurve(days)` and `motScore()` (DVSA
`mot.expiry`, else `mot_due`, else 0.5; days counted from today's local date).
It's on the fixed curve, not min–max. The rank panel and `store.ts` picked it up
through `RANK_FACTORS` with no changes of their own; the score cell's tooltip now
uses `RANK_LABELS` ("MOT left 0.84") rather than the raw keys. Verified: the real
`motCurve` bundled with rolldown and run in node gives 0 at ≤0 days, 0.222 (1 mo),
0.537 (3), 0.803 (6), 0.935 (9), 1.000 at 365/400/730; `rankScores` prefers a
cached DVSA expiry over `mot_due`. In headless Chrome against the live app with
four scratch vans and only MOT weighted: order 400 → 200 → no date → 20 days,
scores 100/84/50/15, tooltip and slider show "MOT left"; old saved rank settings
without a `mot` weight restore it as 0 and keep their other weights. Across
Harry's real rows (212 in the payload, 90 with a DVSA expiry) every MOT part
matched the curve on the expected date. Scratch vans deleted. Not exercised: a
van with only a hand-entered `mot_due` among the real data (none exist; the
scratch vans covered that path).

**Phase 5 (2026-10-07, D-055).** New `app/rejected.py` and table `rejected_regs`.
`sync()` runs after every create and PATCH; `backfill()` at startup (idempotent —
second boot added 0); `attach()` adds `rejected_before` to every listing payload via
a new `attach_derived()` in `main.py` (MOT + flag; every route that returned
`attach_mot()` now returns that). Registered as a `checkbox` pseudo-field (in
`DERIVED_KEYS`, `in_table: False`) so the filter bar offers Checked/Unchecked; the
pill rides inside the Status cell and in the popup's actions row (a button to the
old listing while it exists). Choices the plan left open, all in D-055: the
**first** rejection of a plate keeps the row (a later rejected copy is the relist
and stays flagged); un-rejecting hands the row to another rejected listing with the
plate, if any; `rejected_at` for backfilled rows is the listing's `updated_at` (no
rejection time was ever stored). The frontend reloads all listings after a PATCH
touching `status`/`reg`/`title`, since one van's change flips another's flag.
DB backed up to `data/vancrm.db.bak-phase5`. Backfill: **43 plates** (45 rejected
listings with a reg; two plates were each rejected twice). **7 listings are flagged
now**: 2284 and 2277 (already rejected copies of 2051/11), 2043 (BF68VHJ) and 1963
(CF69GFX, both new + ended); and **3 false flags** — 2302, 2067 and 2076 carry
`LM35DCI` / `MM35DCI`, which are Renault Master model codes ("LM35 dCi") that
`extract_reg()` mistook for plates, matching rejected 2091/2120 with the same
"plate". That's an `extract_reg()` bug from before this phase (35 isn't an issued
age identifier yet); not fixed here — see STATUS "Broken". Verified: an API script
(19 checks, incl. the plan's reject → relist + `ab12 cde` → un-reject → re-reject →
delete sequence, plate set/changed later on a rejected listing, create-as-rejected)
and headless Chrome (15 checks: pills + tooltip in the table, popup pill opens the
old listing, Un-reject in the popup and Reject in the table update other rows' flags
without a reload, Checked/Unchecked filters, flag survives deleting the original,
popup pill goes plain once it's gone). Scratch listings and their `rejected_regs`
rows deleted; real listings identical to the backup. Not exercised: the eBay paths
(they only insert status `new`, so `sync()` isn't called there — a future
auto-reject must call it); dark mode (nothing sets the `.dark` class today, so
the pill's `dark:` colours are untested, like the other pills').

**Phase 6 (2026-10-07, D-056).** Built as planned. `lib/keywords.ts` (patterns +
`keywordSegments()`) and `components/HighlightTextarea.tsx`, used by the popup's
`NotesField` (debounce/flush untouched) and the manual form's notes box (image URLs
stay a plain textarea). Choices beyond the plan's list, in D-056: "ex. VAT",
"ex-VAT", "excl. VAT" and "VAT-free" also match, "no VAT to add" is marked as one
phrase, and a bare "wheelbase"/"wheel base" is marked too (with any
long/medium/short/extra long in front). The backdrop's text is transparent — only
the marks' yellow shows through — so the visible text, caret and selection are the
textarea's own. Note the plan's sample text has **five** real terms, not six (plus
VAT, L3H2, long wheel base, MWB, no vat); all five marked, "Swbxyz" not. Verified:
a node check of the matcher (30 expected hits and 16 near-misses such as
"VATable", "Vatican", "swb2", "XL3H2", "inc VAT"; segments always rejoin to the
input), and headless Chrome against the live app (22 checks, all pass): sample marks; typing marks live with focus kept;
Esc straight after typing still saves; both layers' computed font/padding/border/
wrap match and their widths/heights are equal; a 12k-character description, as
rendered, with the box forced short and scrolled (backdrop scrollTop follows,
including after typing at a scrolled caret), at a narrow window, and forced dark —
each compared pixel-wise against a 1px-shifted control and per character against
the same text without marks. Every character lands within 0.11px horizontally and
0px vertically (Chrome's run-splitting at a `<mark>` edge, not kerning — turning
kerning off didn't remove it); invisible, and it can't move the text itself.
Screenshots checked by eye in light and forced dark (`.dark` on `<html>` — nothing
in the app sets it): dark gives light text on a muted olive-yellow, readable.
Scratch listings deleted. Two things to know: the notes box grows to fit its text
(`field-sizing-content` on the shared Textarea), so in normal use it never scrolls
inside itself — the scroll sync was exercised by forcing a max-height. And it was
only run in Chrome; Safari's rendering of the backdrop is unverified (worth Harry
opening one description in Safari to see the yellow sits on the words).

**Phase 7 (2026-10-07, D-057).** `mot.plate_issued()` / `age_identifier_issued()`
check a current-style plate's age identifier against today's date; `extract_reg()`
drops a failing match **before** its two-plates-means-ambiguous rule (so "Master
MM35dCi, reg PE18 OGB" still gives `PE18OGB`). One deviation from the plan's letter,
in D-057: March codes also wait for March (in Jan–Feb 2027, `27` is refused), like
September's do. Hand entry: `main.normalise_reg()` (create, PATCH, plate lookup) now
answers 400 "LM35DCI isn't a real plate yet — '35' plates haven't been issued" —
a small change in the one function all three use, and it means the clean-up can't
wipe a plate Harry typed. Other hand-typed shapes are still not checked. Clean-up:
an idempotent startup pass, `main.clear_unissued_regs()` (like phases 3/5), clears
the reg (leaving `updated_at`), runs `rejected.sync()` on each, then the new
`rejected.forget()` drops any failing remembered reg. DB backed up to
`data/vancrm.db.bak-phase7` first. Before clearing, every stored reg failing the
check was listed with its title — all five are Renault Master model codes:
**2067** and **2302** (`LM35DCI`, new), **2091** (`LM35DCI`, rejected), **2076**
(`MM35DCI`, new), **2120** (`MM35DCI`, rejected); `rejected_regs` lost `LM35DCI`
and `MM35DCI` (43 → 41). Nothing else in the DB differs from the backup. The three
non-current-style regs (FSZ3532 and LGZ6458, Northern Irish; A3OPO, private) are
untouched. Flags across all 384 listings (active + ended): **7 → 4** — 2302, 2067,
2076 gone; 2284, 2277, 2043 (BF68VHJ) and 1963 (CF69GFX) still flagged. Verified: a
script of 26 checks on the rule (the plan's cases, `76` accepted / `77` refused today,
`00`/`01`/`50` refused, the 1 March and 1 September boundaries via `today=`, NI and
private plates pass); an API script (create with a model-code title stores no reg,
typed `lm35 dci` → 400, PATCH `AB77 CDE` → 400, `ab76 cde` → `AB76CDE`, private plate
accepted, lookup `MM35DCI` → 400 before any DVSA call); the clean-up's hand-on and
deleted-listing paths on a copy of the DB; a second boot clears nothing. Scratch
listings deleted. Not exercised: the UI (no frontend change; the pill is driven by
the `rejected_before` the API now returns as null for the three) and how a 400 on
the plate box reads in the popup — it arrives through the global mutation-error
toast like any other validation error, and the box keeps the typed text (from
reading `useCommit()` and `main.tsx`, not run in a browser).
