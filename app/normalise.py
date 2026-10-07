"""One spelling per make and model (D-053).

Every write path runs make/model through here — create/PATCH validation, the eBay
scrape and import, and the plate lookup's suggestions — and a pass at startup
tidies rows written before. Stdlib only.
"""

import re
import unicodedata

# ---------------------------------------------------------------- size codes

# Amendment 01 §C: van size codes as they appear in an MOT model string, e.g.
# "RELAY 35 L3H2 BLUEHDI". Plenty of models carry no codes at all (Fiat reports a
# bare "DUCATO") — no match just means the user picks them from the dropdowns.
MODEL_LENGTH_RE = re.compile(r"\bL([1-4])\b|L([1-4])H", re.IGNORECASE)
MODEL_HEIGHT_RE = re.compile(r"H([1-3])\b", re.IGNORECASE)


def parse_size_codes(model: str | None) -> tuple[str | None, str | None]:
    """(length_code, height_code) read out of a model string, or (None, None)."""
    if not model:
        return None, None
    length = MODEL_LENGTH_RE.search(model)
    height = MODEL_HEIGHT_RE.search(model)
    return (
        "L" + (length.group(1) or length.group(2)) if length else None,
        "H" + height.group(1) if height else None,
    )


# ---------------------------------------------------------------- makes

# Lower-cased, accent-stripped spelling -> the one we store.
MAKE_ALIASES = {
    "vw": "Volkswagen",
    "volkswagon": "Volkswagen",
    "merc": "Mercedes-Benz",
    "mercedes": "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "mercedesbenz": "Mercedes-Benz",
}

# Brands written in capitals; everything else is title-cased.
CAPS_MAKES = {"LDV", "MAN", "BMW", "DAF", "MG", "AMC"}

# ---------------------------------------------------------------- models

# Known base models, grouped by make for reading only — matching runs across all of
# them, so a van with no make (common from eBay) or the wrong one still tidies.
# The spelling here is the one stored.
BASE_MODELS = {
    "Citroen": ["Relay", "Jumper", "Dispatch", "Berlingo"],
    "Peugeot": ["Boxer", "Expert", "Partner"],
    "Fiat": ["Ducato", "Scudo", "Talento", "Doblo"],
    "Renault": ["Master", "Trafic", "Kangoo"],
    "Vauxhall": ["Movano", "Vivaro", "Combo"],
    "Nissan": ["NV400", "Interstar", "NV300", "Primastar", "NV200"],
    "Ford": ["Transit Custom", "Transit Connect", "Transit"],
    "Mercedes-Benz": ["Sprinter", "Vito"],
    "Volkswagen": ["Crafter", "Transporter", "Caddy"],
    "Iveco": ["Daily"],
    "MAN": ["TGE"],
    "Toyota": ["Proace"],
    "LDV": ["Deliver 9", "V80"],
}

# Make names a model string may start with ("Renault master"), longest first so
# "Mercedes Benz" is dropped whole rather than leaving "Benz Sprinter".
_MAKE_PREFIXES = sorted(
    {m.lower() for m in BASE_MODELS} | set(MAKE_ALIASES) | {"mercedes-benz"},
    key=len,
    reverse=True,
)
# Longest first, so "Transit Custom" wins over "Transit".
_MODEL_NAMES = sorted(
    (name for names in BASE_MODELS.values() for name in names), key=len, reverse=True
)


def _plain(value) -> str:
    """Accents stripped, whitespace collapsed: 'Citroën  Relay' -> 'Citroen Relay'."""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.split())


def _cap_word(word: str) -> str:
    """'relay' -> 'Relay', 'l3h2' -> 'L3H2', 'p/v' -> 'P/V', 'mercedes-benz' -> 'Mercedes-Benz'."""
    if any(ch.isdigit() for ch in word):
        return word.upper()
    return re.sub(r"[^\W\d_]+", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), word)


def _starts_with(text: str, prefix: str) -> bool:
    """Case-insensitive prefix match that ends on a word boundary."""
    if not text.lower().startswith(prefix.lower()):
        return False
    rest = text[len(prefix):]
    return not rest or not rest[0].isalnum()


def canonical_make(value) -> str | None:
    if value is None:
        return None
    text = _plain(value)
    if not text:
        return None
    alias = MAKE_ALIASES.get(text.lower())
    if alias:
        return alias
    if text.upper() in CAPS_MAKES:
        return text.upper()
    return " ".join(_cap_word(w) for w in text.split())


def split_model(value) -> tuple[str | None, str | None]:
    """(make named at the start of the model, or None; the tidied base model)."""
    if value is None:
        return None, None
    text = _plain(value)
    leading_make = None
    for prefix in _MAKE_PREFIXES:
        if _starts_with(text, prefix) and text[len(prefix):].strip():
            leading_make = canonical_make(text[: len(prefix)])
            text = text[len(prefix):].strip(" -")
            break
    if not text:
        return leading_make, None
    for name in _MODEL_NAMES:
        if _starts_with(text, name):
            return leading_make, name
    return leading_make, " ".join(_cap_word(w) for w in text.split())


def canonical_model(value) -> str | None:
    return split_model(value)[1]


def tidy(fields: dict, existing: dict | None = None) -> dict:
    """Tidy make/model in a dict of listing columns, in place; returns it.

    `existing` is the stored row on an update, None on an insert. Size codes are
    filled from the model only when empty in the row and not being set in this
    same write. A make named at the start of the model fills an empty make.
    """
    existing = existing or {}
    if "make" in fields:
        fields["make"] = canonical_make(fields["make"])
    if "model" in fields:
        raw = fields["model"]
        length, height = parse_size_codes(raw)
        for key, code in (("length_code", length), ("height_code", height)):
            if code and key not in fields and not existing.get(key):
                fields[key] = code
        leading_make, fields["model"] = split_model(raw)
        make_now = fields["make"] if "make" in fields else existing.get("make")
        if leading_make and not make_now:
            fields["make"] = leading_make
    return fields


def tidy_all(conn) -> int:
    """Startup pass over stored rows (D-053). Idempotent; returns rows changed.

    Leaves updated_at alone — this is a tidy, not an edit.
    """
    rows = conn.execute(
        "SELECT id, make, model, length_code, height_code FROM listings "
        "WHERE make IS NOT NULL OR model IS NOT NULL"
    ).fetchall()
    changed = 0
    for row in rows:
        before = dict(row)
        after = tidy({"make": before["make"], "model": before["model"]}, existing=before)
        updates = {k: v for k, v in after.items() if v != before.get(k)}
        if updates:
            assignments = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE listings SET {assignments} WHERE id = ?", [*updates.values(), row["id"]]
            )
            changed += 1
    return changed
