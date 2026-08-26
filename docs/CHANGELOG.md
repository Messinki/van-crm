# Changelog

Append-only, newest first. One entry per completed goal or tag.
What happened — not why. Cite decision IDs for the why.

Format:

```
## v0.1 / Goal: short title (YYYY-MM-DD)
- What changed, one line each. Cite decisions as (D-012) where relevant.
```

History before this file lives in `git log` and in the deleted docs' history
(README.md, van-crm-spec.md, the two amendments). Summary of the pre-changelog state:
milestones 1–5 built (skeleton, listings CRUD + table, custom properties, eBay
scrape/import/liveness, DVSA MOT + reg lookup); first production scrape 2026-08-12.

---

## Goal: docs restructure (2026-08-26)
- Adopted the standard project layout: AGENTS.md (CLAUDE.md now a symlink) plus
  docs/STATUS, DECISIONS, ARCHITECTURE, CHANGELOG.
- Deleted van-crm-spec.md, both spec amendments, HOW_TO_RUN.md and the old mega-README;
  migrated the still-useful content (decisions → D-001–D-036, setup/credentials →
  ARCHITECTURE, open work incl. the milestone-4b spec → STATUS).
- Replaced README.md with a short landing page pointing at the docs.
