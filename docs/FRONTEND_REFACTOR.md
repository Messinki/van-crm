# Frontend refactor plan — Vite + React

Working document for the frontend rebuild. Delete this file when Phase 7 lands
(its outcome moves to CHANGELOG/ARCHITECTURE/DECISIONS as usual).

## Goal

Replace the vanilla-JS frontend (`app/static/app.js`, ~2,000 lines in one file)
with a React app. The Python backend, the SQLite database, the API surface and
port 8321 do not change. Working destructively is fine — the old UI is only kept
reachable during the rebuild because it costs nothing, not because we're
preserving it.

## Stack (agreed 2026-08-26)

- **Vite + React + TypeScript** — build tooling and component model. TypeScript
  is deliberate: the compiler is the automated reviewer for AI-written code.
- **TanStack Table v8** — the listings table: sorting, filtering, column
  visibility, computed score column.
- **TanStack Query v5** — all API access: caching, refetching, the scrape
  progress polling (D-034).
- **Tailwind CSS + shadcn/ui** — styling and primitives (Dialog, Popover,
  Dropdown, Badge, Sheet).

This supersedes the "no npm, no build step, no React" rule in AGENTS.md — a
DECISIONS.md entry records the supersession in Phase 0, and AGENTS.md's stack
rules are rewritten there too. **Verify the shadcn/Tailwind/Vite setup steps
against their live docs when scaffolding** — their init commands and Tailwind
major versions churn; don't work from memory.

## Layout and workflow

```
frontend/            # Vite project (package.json, src/, etc.)
  src/
    api/             # TanStack Query hooks, one module per resource
    components/      # table/, detail/, modals/, filters/, ui/ (shadcn)
    lib/             # schema types, formatting helpers (money, reg, dates)
app/static/dist/     # `npm run build` output — served by FastAPI, gitignored
```

- **Dev:** `uvicorn app.main:app --port 8321 --reload` plus `npm run dev` in
  `frontend/` — Vite on :5173 proxies `/api` to :8321.
- **Use:** `npm run build`, then just uvicorn as today — `/` serves the built
  app, the bookmark keeps working.

## What must survive the port (frontend-owned behaviour)

Backend "do not regress" decisions (D-001, D-004, D-014, D-015) are untouched by
this refactor. The frontend-owned ones to carry across:

- **D-034 scrape progress polling** — `POST /api/scrape` then poll
  `GET /api/scrape/progress` until done; same for check-all. Becomes a Query
  with `refetchInterval`.
- **D-002** — eBay warnings surfaced to the user as scrape errors, not swallowed.
- **Schema-driven UI** — columns and the manual-entry form are built from
  `GET /api/schema` + `GET /api/properties`, never hardcoded. This mirrors the
  FIELD_SPECS registry rule and is what keeps new fields cheap.
- **Filter/rank/column state persists to localStorage** (current behaviour).
- **Reg lookup autofill** and plate validation flow in the manual form.

## Phases

Each phase ends verified against the running app and committed. The old UI stays
served at `/` until Phase 4 flips the route.

### Phase 0 — checkpoint and paperwork

1. Verify and commit the in-flight working-tree changes (bulk check-all, filter
   bar, ranking panel) as a checkpoint — this is the behavioural reference for
   parity, and refactoring on a dirty tree loses bisect.
2. Append DECISIONS.md entries: (a) supersede the no-npm/no-React rule and adopt
   the stack above, with the why; (b) note `app/static/dist/` is gitignored
   build output.
3. Update AGENTS.md: stack rules, install/run/dev commands. Update STATUS.md.

### Phase 1 — scaffold

Create `frontend/` (Vite react-ts template), add Tailwind + shadcn/ui, TanStack
Table + Query. Configure the dev proxy and the build output path; add a FastAPI
route change (behind the flip in Phase 4) to serve `dist/`. Verify: dev server
shows a hello page that successfully fetches `/api/schema` through the proxy.

### Phase 2 — data layer

- `lib/schema.ts`: types for listings, field specs, properties, searches —
  hand-written from `/api/schema`'s shape, kept loose where the registry is
  dynamic (custom properties are `Record<string, unknown>` by nature).
- Query hooks per resource: listings, schema, properties, searches, MOT,
  scrape/check-all (mutation + progress polling), reg lookup, import.
- Global error → toast wiring (shadcn toast/sonner), replacing `errorMessage()`.

Verify: a throwaway page lists raw listing titles live from the API.

### Phase 3 — the table

The core. TanStack Table with:

- Columns from schema registry + custom properties, in registry order; column
  visibility UI; the current cell renderers ported (thumb, money, reg, MOT
  badge column, status, custom-property cells, notes truncation).
- Sorting (current `sortValue` semantics), title search, status chips,
  show-inactive toggle.
- The faceted filter bar: per-property condition editors (range / set / bool)
  as Popover components — port `matchesCondition`/`distinctValues` logic into
  TanStack Table custom filter fns.
- The ranking panel: weighted score column (price, mileage, length-code
  ordering), sortable, ported from `rankScores`/`lengthScore`.
- Filter/rank/column state → localStorage.

Verify side-by-side against the old UI on the same data: same rows, same order,
same counts under identical filters. Commit per sub-step (plain table → filters
→ ranking), not one lump.

### Phase 4 — chrome and modals

- Topbar: Scrape (with progress feedback), Check live (with progress), Add
  listing dropdown, Searches, Columns.
- Modals as shadcn Dialogs: manual entry (schema-driven fields + reg lookup
  autofill), import-from-link, saved searches CRUD, custom columns CRUD.
- Inline cell editing / status changes / reject with optimistic updates via
  Query mutations.
- **Flip `/` to serve the React build.** Old UI now unreachable.

### Phase 5 — detail view at parity (as a centred dialog)

Port the drawer's content into a centred Dialog — going straight to the popup
shell the redesign wants, so no throwaway drawer work — but keep the content at
parity first: editable fields, links, MOT panel (badges, check button, full
history), reject button, notes. Verify every drawer action works, then commit.

### Phase 6 — detail popup redesign

The agreed new design, on top of Phase 5:

- **Left/right navigation** through the listings *in their current filtered and
  sorted order* — buttons plus ←/→ arrow keys — so flicking through candidates
  never means closing the popup.
- **Bigger thumbnail** than the table's, shown in the default layout.
- **Click the thumbnail → gallery layout**: the popup re-lays out so 50% of it
  is an image gallery, flickable through all `image_urls` (buttons + arrow
  keys; Esc or a second click returns to the default layout).
- Open questions to settle while building, not before: exact popup size,
  whether field editing stays visible in gallery mode.

### Phase 7 — demolition and docs

- Delete `app/static/app.js`, `style.css`, the old `index.html`.
- ARCHITECTURE.md: new layout, commands, dev workflow. CHANGELOG entry.
  STATUS.md rewritten. Delete this file.

## Sequencing notes

- Milestone 4b (AI enrichment) waits until after this refactor so its UI is
  written once, in React.
- The remaining production eBay checks (STATUS §Next 3) are backend-only and can
  happen any time; they don't block this.
