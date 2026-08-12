"""SQLite access: connection helper, schema creation, idempotent migrations, seeds."""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "vancrm.db"

LISTINGS_SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  external_id   TEXT,
  url           TEXT,
  title         TEXT NOT NULL,
  price_gbp     REAL,
  location      TEXT,
  seller_name   TEXT,
  image_urls    TEXT NOT NULL DEFAULT '[]',
  make          TEXT,
  model         TEXT,
  year          INTEGER,
  mileage       INTEGER,
  reg           TEXT,
  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','considering','contacted','viewing_booked','rejected','purchased')),
  notes         TEXT NOT NULL DEFAULT '',
  custom        TEXT NOT NULL DEFAULT '{}',
  is_active     INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (source, external_id)
);
"""

SCHEMA = LISTINGS_SCHEMA + """
CREATE TABLE IF NOT EXISTS searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  query       TEXT NOT NULL,
  max_price   REAL,
  category_id TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS property_defs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('text','number','checkbox','select','date')),
  options    TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mot_cache (
  reg         TEXT PRIMARY KEY,
  fetched_at  TEXT NOT NULL,
  raw_json    TEXT NOT NULL
);
"""

# Amendment 01 section A: columns added after v1.0 shipped.
# `euro_status` was dropped from the app — every van considered is Euro 6, so the
# field earned nothing. Older DBs keep the (now unused) column; nothing reads it.
MIGRATIONS = [
    ("listings", "height_code", "TEXT"),
    ("listings", "length_code", "TEXT"),
    # Hand-entered MOT expiry (ISO date, 'YYYY-MM-DD'). Independent of the DVSA
    # lookup in milestone 5 — that fills mot_cache, this is the user's own note.
    ("listings", "mot_due", "TEXT"),
    # Milestone 4: an optional year range per saved search. Nullable both ends, so
    # a search can cap the age without setting a floor. Applied in Python during
    # the scrape rather than as an eBay aspect filter — see the README.
    ("searches", "year_min", "INTEGER"),
    ("searches", "year_max", "INTEGER"),
    # A price floor to keep parts/accessories out: eBay keyword search matches
    # "peugeot boxer" against a £30 heater resistor as readily as an actual van,
    # and those are far cheaper than any base vehicle worth considering.
    ("searches", "min_price", "REAL"),
]

SEED_SEARCHES = [
    ("Relay/Boxer/Ducato", "citroen relay van", 3000, 8000),
    ("Peugeot Boxer", "peugeot boxer van", 3000, 8000),
    ("Fiat Ducato", "fiat ducato van", 3000, 8000),
    ("Transit MWB", "ford transit mwb medium roof", 3000, 8000),
    ("Renault Master", "renault master van", 3000, 8000),
]


def now_iso() -> str:
    """ISO-8601 UTC, second precision, e.g. 2026-08-11T10:04:22Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        _seed(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    _migrate_drop_source_check(conn)
    for table, column, coltype in MIGRATIONS:
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


def _migrate_drop_source_check(conn: sqlite3.Connection) -> None:
    """One-time rebuild for DBs created before `source` became free text (it used
    to be CHECK'd to ebay/facebook/manual). SQLite can't drop a CHECK constraint
    via ALTER TABLE, so this recreates the table on the current (unconstrained)
    DDL and copies the rows across.

    Runs in one explicit transaction: SQLite autocommits DDL (CREATE/ALTER/DROP)
    outside of an explicit BEGIN, so without this a failure partway through could
    leave the data stranded in listings_old with an empty listings in its place.
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='listings'"
    ).fetchone()
    if not row or "CHECK (source IN" not in row["sql"]:
        return
    conn.execute("BEGIN")
    try:
        old_columns = [r["name"] for r in conn.execute("PRAGMA table_info(listings)")]
        conn.execute("ALTER TABLE listings RENAME TO listings_old")
        conn.execute(LISTINGS_SCHEMA)
        for table, column, coltype in MIGRATIONS:
            if table != "listings":
                continue
            existing = {r["name"] for r in conn.execute("PRAGMA table_info(listings)")}
            if column not in existing:
                conn.execute(f"ALTER TABLE listings ADD COLUMN {column} {coltype}")
        new_columns = {r["name"] for r in conn.execute("PRAGMA table_info(listings)")}
        # Columns the old table has that the current schema no longer defines
        # (e.g. the retired euro_status) are dropped rather than copied.
        cols = ", ".join(c for c in old_columns if c in new_columns)
        conn.execute(f"INSERT INTO listings ({cols}) SELECT {cols} FROM listings_old")
        conn.execute("DROP TABLE listings_old")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _seed(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) AS n FROM searches").fetchone()["n"] == 0:
        conn.executemany(
            "INSERT INTO searches (label, query, min_price, max_price) VALUES (?, ?, ?, ?)",
            SEED_SEARCHES,
        )


def row_to_listing(row: sqlite3.Row) -> dict:
    """Decode the JSON-in-TEXT columns so the API always hands out real types."""
    listing = dict(row)
    listing["image_urls"] = json.loads(listing.get("image_urls") or "[]")
    listing["custom"] = json.loads(listing.get("custom") or "{}")
    listing["is_active"] = bool(listing["is_active"])
    return listing


def row_to_property(row: sqlite3.Row) -> dict:
    prop = dict(row)
    prop["options"] = json.loads(prop.get("options") or "[]")
    return prop


def row_to_search(row: sqlite3.Row) -> dict:
    search = dict(row)
    search["enabled"] = bool(search["enabled"])
    return search
