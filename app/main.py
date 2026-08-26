"""VanCRM — FastAPI app: routes, validation, startup."""

import json
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import db, ebay, mot

load_dotenv()

STATIC_DIR = Path(__file__).resolve().parent / "static"

STATUSES = ("new", "considering", "contacted", "viewing_booked", "rejected", "purchased")
STATUS_LABELS = {
    "new": "New",
    "considering": "Considering",
    "contacted": "Contacted",
    "viewing_booked": "Viewing booked",
    "rejected": "Rejected",
    "purchased": "Purchased",
}
SOURCES = ("ebay", "facebook", "manual")
PROPERTY_TYPES = ("text", "number", "checkbox", "select", "date")
HEIGHT_CODES = ("H1", "H2", "H3")
LENGTH_CODES = ("L1", "L2", "L3", "L4")

# ---------------------------------------------------------------- field registry
#
# ONE ordered description of every property a listing has. This list is the single
# source of truth for: the API allowlist (EDITABLE_FIELDS, derived below), the table
# column order, the drawer's field order and grouping, and the manual-entry form.
# The frontend fetches it from GET /api/schema and hardcodes none of it, so adding a
# field here is all it takes to make it appear everywhere.
#
# Keys per entry:
#   key         listings column name, or a derived pseudo-key (see DERIVED_KEYS)
#   label       human label — table header, drawer label, form label
#   type        text|url|number|integer|money|date|select|textarea|urls|checkbox
#   options     list of strings, `select` only
#   labels      value -> pretty label map, `select` only, when values aren't pretty
#   editable    may a PATCH set it (this is what EDITABLE_FIELDS is built from)
#   in_table    render as a table column (default True)
#   in_drawer   render in the drawer (default True)
#   in_form     render in the manual-entry form (default: settable at create time)
#   section     drawer grouping: Details|Images|Notes|MOT (default Details)
#   cell        table rendering hint
#   widget      drawer widget override where a plain input won't do
#   sortable    is the table column sortable (default True)
#   suggest     free-text field whose already-used values are offered as a
#               dropdown (a <datalist>) in the drawer and manual form — still
#               free text, the suggestions are only a shortcut. Meaningless on
#               `select`, which already constrains its values.
#
# Visibility defaults to "everywhere": a field with no in_table/in_drawer/section
# gets a table column AND a Details row in the drawer. Hiding is opt-out, per
# surface — set in_table: False to keep it out of the table, in_drawer: False to
# keep it out of the drawer. A field that isn't `editable` still shows in the
# drawer, as a read-only line.
FIELD_SPECS = [
    {
        # The drawer opens with its own image strip, so no drawer row for this.
        "key": "thumb", "label": "", "type": "text", "editable": False,
        "in_table": True, "in_drawer": False, "in_form": False, "cell": "thumb",
        "sortable": False,
    },
    {
        "key": "title", "label": "Title", "type": "text", "editable": True,
        "required": True, "in_form": True, "section": "Details", "cell": "title_link",
    },
    {
        "key": "price_gbp", "label": "Price", "type": "money", "editable": True,
        "in_form": True, "section": "Details", "cell": "money", "numeric": True,
    },
    {
        "key": "make", "label": "Make", "type": "text", "editable": True,
        "in_form": True, "section": "Details", "cell": "text", "suggest": True,
    },
    {
        "key": "model", "label": "Model", "type": "text", "editable": True,
        "in_form": True, "section": "Details", "cell": "text", "suggest": True,
    },
    {
        "key": "year", "label": "Year", "type": "integer", "editable": True,
        "in_form": True, "section": "Details", "cell": "number", "numeric": True,
        "suggest": True,
        # A year is a label, not a quantity: 2015, never "2,015".
        "grouped": False,
    },
    {
        "key": "mileage", "label": "Mileage", "type": "integer", "editable": True,
        "in_form": True, "section": "Details", "cell": "number", "numeric": True,
    },
    {
        "key": "height_code", "label": "Height", "type": "select",
        "options": list(HEIGHT_CODES), "editable": True, "in_form": True,
        "section": "Details", "cell": "text",
    },
    {
        "key": "length_code", "label": "Length", "type": "select",
        "options": list(LENGTH_CODES), "editable": True, "in_form": True,
        "section": "Details", "cell": "text",
    },
    {
        "key": "reg", "label": "Reg", "type": "text", "editable": True,
        "in_form": True, "section": "Details", "cell": "reg", "widget": "reg_lookup",
    },
    {
        "key": "location", "label": "Location", "type": "text", "editable": True,
        "in_form": True, "section": "Details", "cell": "text", "suggest": True,
    },
    {
        "key": "seller_name", "label": "Seller", "type": "text", "editable": True,
        "in_form": True, "section": "Details", "cell": "text", "suggest": True,
    },
    {
        # No column of its own: the title cell is a link to this URL when it's set.
        "key": "url", "label": "Link (URL)", "type": "url", "editable": True,
        "in_table": False, "in_form": True, "section": "Details",
    },
    {
        "key": "source", "label": "Source", "type": "text", "editable": True,
        "in_table": True, "in_form": True, "section": "Details", "cell": "badge",
        "suggest": True,
        # Prefills the manual form same as before, but it's just a starting value
        # now — matches the fallback create_listing() applies when it's omitted.
        "form_default": "facebook",
    },
    {
        "key": "status", "label": "Status", "type": "select", "options": list(STATUSES),
        "labels": STATUS_LABELS, "editable": True, "in_form": True,
        "section": "Details", "cell": "status_pill",
    },
    {
        # Hidden from the drawer: a listing is active from the moment it's added
        # (the column defaults to 1) and the table's tick is enough to read it back.
        "key": "is_active", "label": "Active", "type": "checkbox", "editable": True,
        "in_drawer": False, "in_form": False, "cell": "check",
    },
    {
        # No column of its own: the `thumb` column already surfaces image_urls[0].
        "key": "image_urls", "label": "Image URLs (one per line)", "type": "urls",
        "editable": True, "in_table": False, "in_form": True, "section": "Images",
    },
    {
        "key": "mot_due", "label": "MOT due", "type": "date", "editable": True,
        "in_form": True, "section": "MOT", "cell": "mot_due",
    },
    {
        # Not a column: the cached DVSA summary attached to every listing by
        # attach_mot(). The table renders expiry + fault badges from it (or a Check
        # button when there's nothing cached); the drawer has its own MOT panel, so
        # no drawer row. Sorts on the expiry date — see sortValue() in app.js.
        "key": "mot", "label": "MOT", "type": "text", "editable": False,
        "in_table": True, "in_drawer": False, "in_form": False, "cell": "mot",
    },
    {
        "key": "notes", "label": "Notes", "type": "textarea", "editable": True,
        "in_form": True, "section": "Notes", "cell": "notes", "widget": "notes",
        "sortable": False,
        "placeholder": "Paste the listing text here, plus anything you want to remember",
    },
    {
        # Not a column: a one-click Reject / Un-reject that writes `status`. It is
        # exactly what picking "Rejected" in the drawer's Status select does, put
        # where the scanning happens — rejecting junk from a scrape shouldn't cost
        # a drawer open. Table only; the drawer gets its own button in the actions
        # row rather than a registry field, alongside Delete.
        "key": "reject", "label": "", "type": "text", "editable": False,
        "in_table": True, "in_drawer": False, "in_form": False, "cell": "reject",
        "sortable": False,
    },
]

# Registry keys that are not listings columns — computed for display only.
DERIVED_KEYS = frozenset({"thumb", "mot", "reject"})

# Listings columns deliberately kept out of the UI: identity, bookkeeping, the
# JSON custom bag (it has its own /api/properties machinery), and the dead
# euro_status column older DBs still carry.
UNMANAGED_COLUMNS = frozenset({
    "id", "external_id", "custom", "euro_status",
    "first_seen_at", "last_seen_at", "created_at", "updated_at",
})

# Fields a PATCH (or manual POST) is allowed to touch. `custom` is not a registry
# field — custom properties are defined at runtime, so they're allowed separately.
EDITABLE_FIELDS = {f["key"] for f in FIELD_SPECS if f.get("editable")} | {"custom"}

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Amendment 01 §C: van size codes as they appear in an MOT model string, e.g.
# "RELAY 35 L3H2 BLUEHDI". Plenty of models carry no codes at all (Fiat reports a
# bare "DUCATO") — no match just means the user picks them from the dropdowns.
MODEL_LENGTH_RE = re.compile(r"\bL([1-4])\b|L([1-4])H", re.IGNORECASE)
MODEL_HEIGHT_RE = re.compile(r"H([1-3])\b", re.IGNORECASE)


def check_registry_covers_schema() -> None:
    """Fail startup if the listings table and FIELD_SPECS have drifted apart.

    Adding a column via db.MIGRATIONS without deciding how it appears in the UI is
    the drift this catches: every column must be a registry key or explicitly
    unmanaged, and every non-derived registry key must be a real column.
    """
    with db.connect() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(listings)")}

    keys = {f["key"] for f in FIELD_SPECS}
    missing = sorted(columns - keys - UNMANAGED_COLUMNS)
    if missing:
        raise RuntimeError(
            "listings column(s) not covered by the field registry: "
            f"{', '.join(missing)}. Add each one to FIELD_SPECS in app/main.py so it "
            "appears in the table and drawer, or to UNMANAGED_COLUMNS if it is "
            "deliberately hidden from the UI."
        )
    phantom = sorted(keys - DERIVED_KEYS - columns)
    if phantom:
        raise RuntimeError(
            "field registry key(s) with no listings column: "
            f"{', '.join(phantom)}. Add the column in db.MIGRATIONS, fix the key, or "
            "list it in DERIVED_KEYS if it is computed for display only."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    check_registry_covers_schema()
    yield


app = FastAPI(title="VanCRM", lifespan=lifespan)


# ---------------------------------------------------------------- helpers

def normalise_reg(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).replace(" ", "").upper()
    return cleaned or None


def _as_number(value, field: str, integer: bool):
    if value is None or value == "":
        return None
    try:
        return int(float(value)) if integer else float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{field} must be a number")


def _as_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def property_defs_by_key() -> dict:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM property_defs").fetchall()
    return {r["key"]: db.row_to_property(r) for r in rows}


def coerce_custom_value(prop: dict, value):
    """Validate one custom value against its property definition's declared type."""
    ptype, label = prop["type"], prop["label"]
    if ptype == "checkbox":
        if isinstance(value, bool):
            return value
        if value in (0, 1, "true", "false"):
            return value in (1, "true")
        raise HTTPException(400, f"'{label}' must be true or false")
    if ptype == "number":
        if value == "":
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise HTTPException(400, f"'{label}' must be a number")
        return int(number) if number.is_integer() else number
    if ptype == "select":
        if value == "":
            return None
        if value not in prop["options"]:
            raise HTTPException(400, f"'{value}' is not an option for '{label}'")
        return value
    if ptype == "date":
        if value == "":
            return None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value)):
            raise HTTPException(400, f"'{label}' must be a date (YYYY-MM-DD)")
        return str(value)
    return str(value)


def merge_custom(existing: dict, incoming: dict) -> dict:
    """Merge incoming keys into the existing custom object; a null value drops the key."""
    if not isinstance(incoming, dict):
        raise HTTPException(400, "custom must be an object")
    defs = property_defs_by_key()
    merged = dict(existing)
    for key, value in incoming.items():
        if key not in defs:
            raise HTTPException(400, f"unknown custom property '{key}'")
        if value is None:
            merged.pop(key, None)
        else:
            coerced = coerce_custom_value(defs[key], value)
            if coerced is None:
                merged.pop(key, None)
            else:
                merged[key] = coerced
    return merged


def clean_listing_fields(payload: dict, existing: dict | None = None) -> dict:
    """Filter to the allowlist and coerce each value to its stored representation."""
    unknown = set(payload) - EDITABLE_FIELDS
    if unknown:
        raise HTTPException(400, f"cannot set field(s): {', '.join(sorted(unknown))}")

    out = {}
    for field, value in payload.items():
        if field in ("price_gbp",):
            out[field] = _as_number(value, field, integer=False)
        elif field in ("year", "mileage"):
            out[field] = _as_number(value, field, integer=True)
        elif field == "reg":
            out[field] = normalise_reg(value)
        elif field == "status":
            if value not in STATUSES:
                raise HTTPException(400, f"invalid status '{value}'")
            out[field] = value
        elif field == "height_code":
            code = (_as_text(value) or "").upper() or None
            if code and code not in HEIGHT_CODES:
                raise HTTPException(400, "height_code must be H1, H2 or H3")
            out[field] = code
        elif field == "length_code":
            code = (_as_text(value) or "").upper() or None
            if code and code not in LENGTH_CODES:
                raise HTTPException(400, "length_code must be L1-L4")
            out[field] = code
        elif field == "mot_due":
            date = _as_text(value)
            if date:
                if not ISO_DATE_RE.match(date):
                    raise HTTPException(400, "mot_due must be a date like 2027-03-14")
                try:
                    datetime.strptime(date, "%Y-%m-%d")
                except ValueError:
                    raise HTTPException(400, f"'{date}' is not a real date")
            out[field] = date or None
        elif field == "image_urls":
            urls = value
            if isinstance(urls, str):
                urls = [line.strip() for line in urls.splitlines() if line.strip()]
            if not isinstance(urls, list):
                raise HTTPException(400, "image_urls must be a list or newline-separated text")
            out[field] = json.dumps([str(u).strip() for u in urls if str(u).strip()])
        elif field == "custom":
            base = existing["custom"] if existing else {}
            out[field] = json.dumps(merge_custom(base, value))
        elif field in ("notes",):
            out[field] = "" if value is None else str(value)
        elif field == "is_active":
            out[field] = 1 if value in (True, 1, "true", "1") else 0
        elif field == "title":
            title = _as_text(value)
            if not title:
                raise HTTPException(400, "title is required")
            out[field] = title
        else:
            out[field] = _as_text(value)
    return out


def get_listing_or_404(conn: sqlite3.Connection, listing_id: int) -> dict:
    row = conn.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "listing not found")
    return db.row_to_listing(row)


def parse_size_codes(model: str | None) -> tuple[str | None, str | None]:
    """(length_code, height_code) read out of an MOT model string, or (None, None)."""
    if not model:
        return None, None
    length = MODEL_LENGTH_RE.search(model)
    height = MODEL_HEIGHT_RE.search(model)
    return (
        "L" + (length.group(1) or length.group(2)) if length else None,
        "H" + height.group(1) if height else None,
    )


def attach_mot(conn: sqlite3.Connection, listings: list[dict]) -> list[dict]:
    """Hang the cached MOT summary (or None) on each listing, in one query.

    The table's MOT column reads this, so it must ride along with the listings
    rather than costing a request per row. Nothing here ever calls DVSA — it only
    reports what mot_cache already holds.
    """
    regs = sorted({l["reg"] for l in listings if l.get("reg")})
    summaries: dict[str, dict] = {}
    if regs:
        placeholders = ", ".join("?" * len(regs))
        rows = conn.execute(
            f"SELECT reg, fetched_at, raw_json FROM mot_cache WHERE reg IN ({placeholders})", regs
        ).fetchall()
        for row in rows:
            summaries[row["reg"]] = mot.summary(json.loads(row["raw_json"]), row["fetched_at"])
    for listing in listings:
        listing["mot"] = summaries.get(listing.get("reg"))
    return listings


def slugify(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or "property"


def not_configured(what: str, detail: str):
    raise HTTPException(503, f"{what} is not configured yet — {detail}")


# ---------------------------------------------------------------- schema

@app.get("/api/schema")
def get_schema():
    """The field registry the frontend builds its table, drawer and form from.

    Custom properties are deliberately NOT merged in here — they live at
    /api/properties because they're user-defined at runtime.
    """
    return {"fields": FIELD_SPECS, "statuses": list(STATUSES), "sources": list(SOURCES)}


# ---------------------------------------------------------------- listings

@app.get("/api/listings")
def list_listings(
    status: str | None = None,
    source: str | None = None,
    q: str | None = None,
    active: int = 1,
):
    sql = "SELECT * FROM listings WHERE 1=1"
    params: list = []
    if status:
        wanted = [s for s in status.split(",") if s]
        sql += f" AND status IN ({','.join('?' * len(wanted))})"
        params += wanted
    if source:
        sql += " AND source = ?"
        params.append(source)
    if q:
        sql += " AND title LIKE ?"
        params.append(f"%{q}%")
    if active in (0, 1):
        sql += " AND is_active = ?"
        params.append(active)
    sql += " ORDER BY id DESC"
    with db.connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return attach_mot(conn, [db.row_to_listing(r) for r in rows])


@app.post("/api/listings", status_code=201)
def create_listing(payload: dict = Body(...)):
    # source is an ordinary editable field now; it just has a default when omitted.
    payload.setdefault("source", "facebook")
    if not _as_text(payload.get("title")):
        raise HTTPException(400, "title is required")

    fields = clean_listing_fields(payload)
    if not fields.get("reg"):
        fields["reg"] = mot.extract_reg(fields.get("title"), fields.get("notes"))

    now = db.now_iso()
    fields.update(
        first_seen_at=now,
        last_seen_at=now,
        created_at=now,
        updated_at=now,
    )
    columns = ", ".join(fields)
    placeholders = ", ".join("?" * len(fields))
    with db.connect() as conn:
        cursor = conn.execute(
            f"INSERT INTO listings ({columns}) VALUES ({placeholders})", list(fields.values())
        )
        return attach_mot(conn, [get_listing_or_404(conn, cursor.lastrowid)])[0]


@app.patch("/api/listings/{listing_id}")
def update_listing(listing_id: int, payload: dict = Body(...)):
    with db.connect() as conn:
        existing = get_listing_or_404(conn, listing_id)
        fields = clean_listing_fields(payload, existing=existing)
        if fields:
            fields["updated_at"] = db.now_iso()
            assignments = ", ".join(f"{f} = ?" for f in fields)
            conn.execute(
                f"UPDATE listings SET {assignments} WHERE id = ?",
                [*fields.values(), listing_id],
            )
        return attach_mot(conn, [get_listing_or_404(conn, listing_id)])[0]


@app.delete("/api/listings/{listing_id}")
def delete_listing(listing_id: int):
    with db.connect() as conn:
        get_listing_or_404(conn, listing_id)
        conn.execute("DELETE FROM listings WHERE id = ?", (listing_id,))
    return {"deleted": listing_id}


# ---------------------------------------------------------------- searches

@app.get("/api/searches")
def list_searches():
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM searches ORDER BY id").fetchall()
    return [db.row_to_search(r) for r in rows]


@app.post("/api/searches", status_code=201)
def create_search(payload: dict = Body(...)):
    label = _as_text(payload.get("label"))
    query = _as_text(payload.get("query"))
    if not label or not query:
        raise HTTPException(400, "label and query are required")
    with db.connect() as conn:
        cursor = conn.execute(
            "INSERT INTO searches (label, query, min_price, max_price, category_id, enabled, year_min, year_max)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (
                label,
                query,
                _as_number(payload.get("min_price"), "min_price", integer=False),
                _as_number(payload.get("max_price"), "max_price", integer=False),
                _as_text(payload.get("category_id")),
                0 if payload.get("enabled") in (False, 0, "false") else 1,
                _as_number(payload.get("year_min"), "year_min", integer=True),
                _as_number(payload.get("year_max"), "year_max", integer=True),
            ),
        )
        row = conn.execute("SELECT * FROM searches WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return db.row_to_search(row)


@app.patch("/api/searches/{search_id}")
def update_search(search_id: int, payload: dict = Body(...)):
    allowed = {"label", "query", "min_price", "max_price", "category_id", "enabled", "year_min", "year_max"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(400, f"cannot set field(s): {', '.join(sorted(unknown))}")
    fields = {}
    for field, value in payload.items():
        if field in ("min_price", "max_price"):
            fields[field] = _as_number(value, field, integer=False)
        elif field in ("year_min", "year_max"):
            fields[field] = _as_number(value, field, integer=True)
        elif field == "enabled":
            fields[field] = 0 if value in (False, 0, "false") else 1
        else:
            fields[field] = _as_text(value)
    if not fields.get("label", "x") or not fields.get("query", "x"):
        raise HTTPException(400, "label and query cannot be empty")
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM searches WHERE id = ?", (search_id,)).fetchone() is None:
            raise HTTPException(404, "search not found")
        if fields:
            assignments = ", ".join(f"{f} = ?" for f in fields)
            conn.execute(
                f"UPDATE searches SET {assignments} WHERE id = ?", [*fields.values(), search_id]
            )
        row = conn.execute("SELECT * FROM searches WHERE id = ?", (search_id,)).fetchone()
        return db.row_to_search(row)


@app.delete("/api/searches/{search_id}")
def delete_search(search_id: int):
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM searches WHERE id = ?", (search_id,)).fetchone() is None:
            raise HTTPException(404, "search not found")
        conn.execute("DELETE FROM searches WHERE id = ?", (search_id,))
    return {"deleted": search_id}


# ---------------------------------------------------------------- properties

@app.get("/api/properties")
def list_properties():
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM property_defs ORDER BY sort_order, id").fetchall()
    return [db.row_to_property(r) for r in rows]


@app.post("/api/properties", status_code=201)
def create_property(payload: dict = Body(...)):
    label = _as_text(payload.get("label"))
    ptype = payload.get("type")
    if not label:
        raise HTTPException(400, "label is required")
    if ptype not in PROPERTY_TYPES:
        raise HTTPException(400, f"type must be one of {', '.join(PROPERTY_TYPES)}")
    options = payload.get("options") or []
    if isinstance(options, str):
        options = [line.strip() for line in options.splitlines() if line.strip()]
    if ptype == "select" and not options:
        raise HTTPException(400, "a select property needs at least one option")

    key = slugify(label)
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM property_defs WHERE key = ?", (key,)).fetchone():
            raise HTTPException(400, f"a property named '{label}' already exists")
        next_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM property_defs"
        ).fetchone()["n"]
        cursor = conn.execute(
            "INSERT INTO property_defs (key, label, type, options, sort_order) VALUES (?,?,?,?,?)",
            (key, label, ptype, json.dumps([str(o) for o in options]), next_order),
        )
        row = conn.execute(
            "SELECT * FROM property_defs WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return db.row_to_property(row)


@app.patch("/api/properties/{property_id}")
def update_property(property_id: int, payload: dict = Body(...)):
    allowed = {"label", "options", "sort_order"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(400, f"cannot set field(s): {', '.join(sorted(unknown))}")
    fields = {}
    if "label" in payload:
        label = _as_text(payload["label"])
        if not label:
            raise HTTPException(400, "label cannot be empty")
        fields["label"] = label
    if "options" in payload:
        options = payload["options"] or []
        if isinstance(options, str):
            options = [line.strip() for line in options.splitlines() if line.strip()]
        fields["options"] = json.dumps([str(o) for o in options])
    if "sort_order" in payload:
        fields["sort_order"] = _as_number(payload["sort_order"], "sort_order", integer=True) or 0

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM property_defs WHERE id = ?", (property_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "property not found")
        if fields:
            assignments = ", ".join(f"{f} = ?" for f in fields)
            conn.execute(
                f"UPDATE property_defs SET {assignments} WHERE id = ?",
                [*fields.values(), property_id],
            )
        row = conn.execute("SELECT * FROM property_defs WHERE id = ?", (property_id,)).fetchone()
        return db.row_to_property(row)


@app.delete("/api/properties/{property_id}")
def delete_property(property_id: int):
    """Delete the definition and strip its key from every listing's custom object."""
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM property_defs WHERE id = ?", (property_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "property not found")
        key = row["key"]
        conn.execute("DELETE FROM property_defs WHERE id = ?", (property_id,))

        stripped = 0
        for listing in conn.execute("SELECT id, custom FROM listings").fetchall():
            custom = json.loads(listing["custom"] or "{}")
            if key in custom:
                del custom[key]
                conn.execute(
                    "UPDATE listings SET custom = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(custom), db.now_iso(), listing["id"]),
                )
                stripped += 1
    return {"deleted": property_id, "listings_updated": stripped}


# ---------------------------------------------------------------- MOT + reg lookup

@app.post("/api/lookup/reg")
def lookup_reg(payload: dict = Body(...)):
    """Amendment 01 §D: one plate in, everything two government sources know back.

    The MOT call warms mot_cache as a side effect, so a listing created straight
    after a lookup already has its MOT column filled in.
    """
    reg = normalise_reg(payload.get("reg"))
    if not reg:
        raise HTTPException(422, "enter a number plate to look up")
    if not mot.configured() and not mot.ves_configured():
        not_configured("Reg lookup", "add the five DVSA_* values to .env (DVLA_VES_API_KEY is optional)")

    raw, ves, reasons = None, None, []
    if mot.configured():
        try:
            with db.connect() as conn:
                raw, _, _ = mot.get_cached_or_fetch(conn, reg)
        except mot.MotError as err:
            reasons.append(err.message)
    if mot.ves_configured():
        try:
            ves = mot.fetch_ves(reg)
        except mot.MotError as err:
            reasons.append(err.message)

    if raw is None and ves is None:
        raise HTTPException(404, " · ".join(reasons) or f"Nothing found for {reg}")

    derived = mot.derive(raw or {})
    ves = ves or {}
    length_code, height_code = parse_size_codes(derived["model"])

    year = ves.get("yearOfManufacture")
    if year is None and derived["first_used_date"]:
        year = _as_number(str(derived["first_used_date"])[:4], "year", integer=True)

    return {
        "reg": reg,
        "make": derived["make"] or ves.get("make"),   # MOT is the better-cased one
        "model": derived["model"],                    # VES has no model at all
        "year": year,
        "fuel_type": derived["fuel_type"] or ves.get("fuelType"),
        "colour": derived["colour"] or ves.get("colour"),
        "engine_size": derived["engine_size"] or ves.get("engineCapacity"),
        "length_code": length_code,
        "height_code": height_code,
        "mileage": derived["latest_odometer_miles"],
        "mot_due": derived["latest_expiry"],
        "tax_status": ves.get("taxStatus"),
        "mot_cached": raw is not None,
        "sources": {"mot": raw is not None, "ves": bool(ves)},
        # When one source answers and the other doesn't, the call still succeeds
        # with the half that worked — so why the other half is missing has to
        # travel with the result. Without this a broken key, a rate limit and a
        # source that was never configured all look identical from the UI.
        "warnings": reasons,
    }


def mot_response(raw: dict, fetched_at: str, from_cache: bool) -> dict:
    return {
        "cached": True,
        "fetched_at": fetched_at,
        "from_cache": from_cache,
        "derived": mot.derive(raw),
        "summary": mot.summary(raw, fetched_at),
        "raw": raw,
    }


@app.get("/api/listings/{listing_id}/mot")
def get_mot(listing_id: int):
    """Whatever is already cached for this listing's reg. Never calls DVSA."""
    with db.connect() as conn:
        listing = get_listing_or_404(conn, listing_id)
        if not listing["reg"]:
            return {"cached": False, "reason": "no reg set"}
        row = conn.execute(
            "SELECT * FROM mot_cache WHERE reg = ?", (listing["reg"],)
        ).fetchone()
    if row is None:
        return {"cached": False}
    return mot_response(json.loads(row["raw_json"]), row["fetched_at"], from_cache=True)


@app.post("/api/listings/{listing_id}/mot")
def fetch_mot(listing_id: int, force: bool = Query(False)):
    if not mot.configured():
        not_configured("The MOT History API", "add the five DVSA_* values to .env")
    with db.connect() as conn:
        listing = get_listing_or_404(conn, listing_id)
        if not listing["reg"]:
            raise HTTPException(422, "add a number plate to this listing first")
        try:
            raw, fetched_at, from_cache = mot.get_cached_or_fetch(conn, listing["reg"], force=force)
        except mot.MotError as err:
            raise HTTPException(err.status, err.message)
    return mot_response(raw, fetched_at, from_cache)


# ---------------------------------------------------------------- eBay

EBAY_UNCONFIGURED = "add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env"


def require_ebay() -> None:
    if not ebay.configured():
        not_configured("eBay", EBAY_UNCONFIGURED)


@app.post("/api/scrape")
def scrape():
    """Run every enabled saved search and upsert what comes back (spec §5.2-5.3)."""
    require_ebay()
    with db.connect() as conn:
        try:
            return ebay.scrape(conn)
        except ebay.EbayError as err:
            raise HTTPException(err.status, err.message)


@app.get("/api/scrape/progress")
def scrape_progress():
    """Polled by the UI while a scrape is in flight — one detail call per new
    item means a large scrape can run for minutes with nothing else to show."""
    return ebay.PROGRESS


@app.post("/api/import/ebay", status_code=201)
def import_ebay(payload: dict = Body(...)):
    """Amendment 01 §E: one eBay URL in, one listing out (409 if it's already here)."""
    require_ebay()
    url = _as_text(payload.get("url"))
    if not url:
        raise HTTPException(422, "paste an eBay listing URL")
    with db.connect() as conn:
        try:
            listing_id, created = ebay.import_from_url(conn, url)
        except ebay.EbayError as err:
            raise HTTPException(err.status, err.message)
        if not created:
            # A dict detail so the frontend can open the row it already has.
            raise HTTPException(
                409, {"message": "That listing is already in the table", "listing_id": listing_id}
            )
        return attach_mot(conn, [get_listing_or_404(conn, listing_id)])[0]


@app.post("/api/listings/{listing_id}/check")
def check_listing(listing_id: int):
    """Spec §5.4: is this eBay listing still live? Refreshes price either way."""
    require_ebay()
    with db.connect() as conn:
        listing = get_listing_or_404(conn, listing_id)
        if listing["source"] != "ebay" or not listing["external_id"]:
            raise HTTPException(422, "only listings that came from eBay can be checked")
        try:
            result = ebay.check_item(listing["external_id"])
        except ebay.EbayError as err:
            raise HTTPException(err.status, err.message)

        ebay.apply_check(conn, listing_id, result)
        return {
            "active": result["active"],
            "message": result["message"],
            "listing": attach_mot(conn, [get_listing_or_404(conn, listing_id)])[0],
        }


@app.post("/api/listings/check-all")
def check_all_listings():
    """Spec §5.4 in bulk: re-check every eBay listing still marked active."""
    require_ebay()
    with db.connect() as conn:
        try:
            return ebay.check_all(conn)
        except ebay.EbayError as err:
            raise HTTPException(err.status, err.message)


@app.get("/api/listings/check-all/progress")
def check_all_progress():
    """Polled by the UI while a sweep is in flight — one eBay call per listing."""
    return ebay.CHECK_PROGRESS


# ---------------------------------------------------------------- static

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
