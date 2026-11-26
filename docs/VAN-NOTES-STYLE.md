# Writing van notes

How to add or edit notes in `notes/van-notes.json` so new research matches the
existing ones. Matching rules are in D-067; this is only about content and style.
Read a few existing notes first — copy their voice.

## What a note is

One note = one set of facts that share the **same models + build window (+ engine)**.
Notes layer, most specific first (D-063): a family/body note, then engine notes, then
recalls. Put each fact in the one note where it's true of every van that matches —
never repeat a line across notes (duplicates are dropped when shown).

## File fields

Edit the JSON directly (app can be stopped). Keep the shape of the existing entries:

| Field | Rule |
| --- | --- |
| `id` | Next unused integer. Never reuse one. |
| `kind` | `fault` or `recall`. Nothing else. |
| `models` | Base models only, exactly as in the other notes: `Ducato`, `Relay`, `Jumper`, `Boxer`, `Transit`, `Transit Custom`, `Master`, `Movano`, `NV400`, `Interstar`, `Sprinter`, `Crafter`. Badge twins go together (Sevel: Relay/Jumper/Boxer/Ducato). |
| `built_from` / `built_to` | `"YYYY"` or `"YYYY-MM"` (build date, not reg year); `null` = open-ended. Use months for recalls with a stated build window. A single-year note repeats the year in both. |
| `engines` | `[]` unless the note only holds for one engine. Names must match `normalise.ENGINES` exactly (e.g. `"2.2 HDi"`, `"2.3 MultiJet"`). Engine notes usually leave years `null`. |
| `gearbox`, `mileage_min`, `mileage_max` | `null` unless the fact genuinely depends on them. |
| `lines` | The content — see below. |
| `created_at`, `updated_at` | ISO UTC, `2026-11-26T15:33:49Z` style. Bump `updated_at` on edits. |

## Lines

Each line is one fault or one check, written as a **terse fragment**:

- No full sentences, no trailing full stop, no "may", "can sometimes", "owners report".
  State it flat. Start with the part or symptom: `Turbo actuator seizes – limp mode`.
- Pattern: `Thing fails – symptom/consequence`, optionally `(cost)`.
  Use an en dash with spaces (` – `) to separate cause from effect.
- Costs go in brackets at the end: `(up to €1,500)`, `(~£150)`, `(£1,000+)`. Use the
  currency the source gave (Fiat/PSA ones are mostly €, UK garage quotes £). Prices
  are rough ranges — don't invent precision.
- Intervals as `change every 10 yrs / 144k miles`, `60k miles / 4 years`; miles, not km.
- Name codes only when they're diagnostic: `P20EE`, `U059E`.
- Practical buyer actions are fine as short imperatives: `Ask when done + what oil used`,
  `Check engine type on logbook, not advert`, `ask for the receipt`.
- Order lines by severity/likelihood — the big expensive or most common one first,
  cheap nuisances last.
- Short: a note is typically 1–8 lines, each under ~100 characters. If a line needs a
  second clause, it's probably two lines.
- Plain ASCII punctuation except ` – ` and currency symbols. No bullets, emoji or
  markdown inside lines.

### Don't

- No `Src:` lines, URLs, or "only forum reports" caveats (D-064).
- No dates inside lines when the note's build window already says them (D-067).
  Exception: a non-obvious carve-out, e.g. `Some 2016-19 vans had AdBlue instead`.
- No scoring, summaries or prose — facts a buyer can check (D-036).
- Don't pad with generic advice ("get a full service history") unless it's the
  single biggest factor for that platform (as in the Sprinter note).

## Recalls

- One recall = its own note, `kind: "recall"`, with the exact build window it applies to
  (months if known). Several recalls sharing the same window and model go in one note.
- Lines name the defect and the hazard only, 2–6 words: `Brake pipes rubbing`,
  `Ignition switch can cut dash + ABS`, `Alternator cable near driveshaft, fire risk`.
  Add `(critical)` for safety-critical ones. No campaign numbers.
- The app shows them under "Recalls — check the VIN" and writes the window from the
  note's dates, so don't repeat "built …" in the line.

## Research workflow

1. Look at the existing notes for that model first; add to the right one rather than
   creating a near-duplicate. Only create a new note when model, build window or engine
   differs.
2. Sources: owner/buyer guides, DVSA/DVLA recall lists, specialist garage write-ups.
   Keep a fact only if it's repeated or specific; leave out one-off anecdotes.
3. Verify the JSON loads (`python3 -c "import json;json.load(open('notes/van-notes.json'))"`),
   keep `ensure_ascii` style as in the file, and commit with
   `docs:` or `feat:` and a decision ID if the shape of notes changed.
