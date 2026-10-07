"""Remembered plates of rejected vans, and the "Rejected before" flag (D-055).

`rejected_regs` holds one row per plate Harry has rejected. It outlives the
listing it came from, so a van that's deleted and later relisted is still caught.
The flag itself is never stored: `attach()` works it out each time listings are
read, so a plate that's only extracted or looked up later still triggers it.
"""

import sqlite3

from app import db, mot


def plate(reg) -> str | None:
    """The reg as rejected_regs stores it, or None if it isn't plate-shaped."""
    if not reg:
        return None
    try:
        return mot.clean_reg(reg)
    except mot.MotError:
        return None


def sync(conn: sqlite3.Connection, listing_id: int) -> None:
    """Bring rejected_regs in line with one listing after a write to it.

    Call it after anything that may change a listing's `status` or `reg` (create,
    PATCH, and any future auto-reject). A rejected listing with a plate has that
    plate remembered — unless another listing was rejected with it first, in
    which case this one is the relist and keeps its flag. A listing that's no
    longer rejected, or whose plate changed, gives up its row. A deleted listing
    isn't touched: its row is the memory.
    """
    row = conn.execute(
        "SELECT id, title, reg, status FROM listings WHERE id = ?", (listing_id,)
    ).fetchone()
    if row is None:
        return
    wanted = plate(row["reg"]) if row["status"] == "rejected" else None

    held = [r["reg"] for r in conn.execute(
        "SELECT reg FROM rejected_regs WHERE listing_id = ?", (listing_id,)
    )]
    released = [reg for reg in held if reg != wanted]
    for reg in released:
        conn.execute("DELETE FROM rejected_regs WHERE reg = ?", (reg,))

    if wanted:
        holder = conn.execute(
            "SELECT listing_id FROM rejected_regs WHERE reg = ?", (wanted,)
        ).fetchone()
        if holder is None:
            conn.execute(
                "INSERT INTO rejected_regs (reg, listing_id, title, rejected_at) VALUES (?, ?, ?, ?)",
                (wanted, listing_id, row["title"], db.now_iso()),
            )
        elif holder["listing_id"] == listing_id:
            # Same rejection, maybe a new title — the date it was rejected stays.
            conn.execute(
                "UPDATE rejected_regs SET title = ? WHERE reg = ?", (row["title"], wanted)
            )

    for reg in released:
        _hand_on(conn, reg)


def _hand_on(conn: sqlite3.Connection, reg: str) -> None:
    """A plate's row was given up: pass it to another rejected listing with that
    plate, if there is one, so the plate is still remembered."""
    other = conn.execute(
        "SELECT id, title, updated_at FROM listings"
        " WHERE status = 'rejected' AND reg = ? ORDER BY id LIMIT 1",
        (reg,),
    ).fetchone()
    if other is not None:
        conn.execute(
            "INSERT OR IGNORE INTO rejected_regs (reg, listing_id, title, rejected_at)"
            " VALUES (?, ?, ?, ?)",
            (reg, other["id"], other["title"], other["updated_at"]),
        )


def forget(conn: sqlite3.Connection, reg: str) -> None:
    """Drop a remembered plate that turned out not to be a plate at all (D-057).

    Only for that: a real plate's row is the memory and is never forgotten. Call
    it after the listings holding the reg have been cleared and synced, so there's
    no rejected listing left to hand the row on to.
    """
    conn.execute("DELETE FROM rejected_regs WHERE reg = ?", (reg,))


def backfill(conn: sqlite3.Connection) -> int:
    """Remember every rejected listing's plate that isn't remembered yet.

    Idempotent; runs at startup. Rejections were never timestamped, so a
    backfilled row's rejected_at is the listing's updated_at — its last edit,
    which is at or after the rejection. Oldest listing first, so when several
    rejected listings share a plate the original holds it.
    """
    added = 0
    rows = conn.execute(
        "SELECT id, title, reg, updated_at FROM listings"
        " WHERE status = 'rejected' AND reg IS NOT NULL AND reg != '' ORDER BY id"
    ).fetchall()
    for row in rows:
        reg = plate(row["reg"])
        if not reg:
            continue
        cursor = conn.execute(
            "INSERT OR IGNORE INTO rejected_regs (reg, listing_id, title, rejected_at)"
            " VALUES (?, ?, ?, ?)",
            (reg, row["id"], row["title"], row["updated_at"]),
        )
        added += cursor.rowcount
    return added


def attach(conn: sqlite3.Connection, listings: list[dict]) -> list[dict]:
    """Hang `rejected_before` on each listing: {listing_id, title, rejected_at} of
    the earlier rejection when its plate is remembered under another listing,
    else None."""
    remembered = {
        r["reg"]: dict(r)
        for r in conn.execute("SELECT reg, listing_id, title, rejected_at FROM rejected_regs")
    }
    for listing in listings:
        hit = remembered.get(plate(listing.get("reg")))
        if hit and hit["listing_id"] != listing["id"]:
            listing["rejected_before"] = {
                "listing_id": hit["listing_id"],
                "title": hit["title"],
                "rejected_at": hit["rejected_at"],
            }
        else:
            listing["rejected_before"] = None
    return listings
