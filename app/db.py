"""SQLite access: connection helper, schema creation, idempotent migrations, seeds."""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "vancrm.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL CHECK (source IN ('ebay','facebook','manual')),
  external_id   TEXT,
  url           TEXT,
  title         TEXT NOT NULL,
  price_gbp     REAL,
  location      TEXT,
  seller_name   TEXT,
  image_urls    TEXT NOT NULL DEFAULT '[]',
  description   TEXT,
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
MIGRATIONS = [
    ("listings", "height_code", "TEXT"),
    ("listings", "length_code", "TEXT"),
    ("listings", "euro_status", "TEXT"),
]

SEED_SEARCHES = [
    ("Relay/Boxer/Ducato", "citroen relay van", 8000),
    ("Peugeot Boxer", "peugeot boxer van", 8000),
    ("Fiat Ducato", "fiat ducato van", 8000),
    ("Transit MWB", "ford transit mwb medium roof", 8000),
    ("Renault Master", "renault master van", 8000),
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
    for table, column, coltype in MIGRATIONS:
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


def _seed(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) AS n FROM searches").fetchone()["n"] == 0:
        conn.executemany(
            "INSERT INTO searches (label, query, max_price) VALUES (?, ?, ?)",
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
