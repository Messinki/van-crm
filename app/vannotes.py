"""Van-type notes (D-061), stored in a JSON file in the repo rather than the DB
(D-065) so they can be read and edited by hand. The file is read on every request,
so a hand edit shows on the next reload, and rewritten whole on every save.

In the file each note's comment is a `lines` list; the API speaks `comment` (one
string, lines joined by newlines), so the frontend didn't change."""

import json
import os
import sqlite3
import threading
from pathlib import Path

NOTES_PATH = Path(__file__).resolve().parent.parent / "notes" / "van-notes.json"

_lock = threading.Lock()


class NotesFileError(Exception):
    """The notes file exists but can't be read as a list of notes."""


def _to_api(note: dict) -> dict:
    out = {k: v for k, v in note.items() if k != "lines"}
    out["comment"] = "\n".join(note.get("lines") or [])
    return out


def _to_file(note: dict) -> dict:
    """Keys in a fixed, readable order: what the note covers, its lines, then dates."""
    lines = (note.get("comment") or "").split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    return {
        "id": note["id"],
        "models": note.get("models") or [],
        "year_min": note.get("year_min"),
        "year_max": note.get("year_max"),
        "lines": lines,
        "created_at": note.get("created_at"),
        "updated_at": note.get("updated_at"),
    }


def _read() -> list[dict]:
    if not NOTES_PATH.exists():
        return []
    try:
        notes = json.loads(NOTES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise NotesFileError(f"{NOTES_PATH.name} isn't valid JSON: {exc}") from exc
    if not isinstance(notes, list) or not all(isinstance(n, dict) and "id" in n for n in notes):
        raise NotesFileError(f"{NOTES_PATH.name} should be a list of notes, each with an id")
    return notes


def _write(notes: list[dict]) -> None:
    NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)
    notes = sorted(notes, key=lambda n: n["id"])
    text = json.dumps(notes, indent=2, ensure_ascii=False) + "\n"
    tmp = NOTES_PATH.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, NOTES_PATH)  # never leaves a half-written file


def list_notes() -> list[dict]:
    """Newest first, as the table query used to return them."""
    return [_to_api(n) for n in sorted(_read(), key=lambda n: n["id"], reverse=True)]


def get(note_id: int) -> dict | None:
    return next((_to_api(n) for n in _read() if n["id"] == note_id), None)


def create(fields: dict) -> dict:
    with _lock:
        notes = _read()
        note = {"id": max((n["id"] for n in notes), default=0) + 1, **fields}
        notes.append(_to_file(note))
        _write(notes)
    return _to_api(_to_file(note))


def update(note_id: int, fields: dict) -> dict | None:
    with _lock:
        notes = _read()
        for i, n in enumerate(notes):
            if n["id"] == note_id:
                merged = {**_to_api(n), **fields}
                notes[i] = _to_file(merged)
                _write(notes)
                return _to_api(notes[i])
    return None


def delete(note_id: int) -> bool:
    with _lock:
        notes = _read()
        kept = [n for n in notes if n["id"] != note_id]
        if len(kept) == len(notes):
            return False
        _write(kept)
    return True


def import_from_db(conn: sqlite3.Connection) -> int:
    """One-off: copy the old `van_notes` table into the file when the file doesn't
    exist yet. The table is left as it was. Returns how many notes were copied."""
    if NOTES_PATH.exists():
        return 0
    has_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='van_notes'"
    ).fetchone()
    if not has_table:
        return 0
    rows = conn.execute("SELECT * FROM van_notes ORDER BY id").fetchall()
    if not rows:
        return 0
    notes = []
    for r in rows:
        note = dict(r)
        note["models"] = json.loads(note.get("models") or "[]")
        notes.append(_to_file(note))
    with _lock:
        _write(notes)
    return len(notes)
