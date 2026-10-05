"""UK geocoding through postcodes.io (D-048): free-text location -> coordinates.

postcodes.io is free, keyless and UK-only. Response shapes were probed against
the live API on 2026-10-04 — see docs/ARCHITECTURE.md for the table. Three
lookups cover every kind of location string this app holds:

* a full postcode   — `GET /postcodes/{pc}`, or `POST /postcodes` for up to 100
* an outcode        — `GET /outcodes/{outcode}` (eBay's `Accrington, BB5 ***`)
* a place name      — `GET /places?q=...` (manual entries: `Stafford`, `Newport`)

An unknown postcode or outcode answers 404; an unknown place answers 200 with an
empty list. Both mean "not found", which callers remember so junk isn't retried.
A network failure is a different thing — GeoUnavailable — and is never
remembered, so the lookup is retried next time.
"""

import re
from urllib.parse import quote

import httpx

BASE = "https://api.postcodes.io"
TIMEOUT = 10.0
HEADERS = {"User-Agent": "VanCRM/1.0 (single-user van tracker on localhost)"}
BULK_LIMIT = 100     # postcodes per POST /postcodes, the documented maximum

# A full postcode or an outcode anywhere in free text, any case, with or without
# the space: "HP11 2JL", "hp112jl", "BB5 ***", "ws11***". The look-arounds keep
# them from matching inside a longer run of letters and digits.
FULL_RE = re.compile(r"(?<![A-Z0-9])([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})(?![A-Z0-9])", re.I)
OUTCODE_RE = re.compile(r"(?<![A-Z0-9])([A-Z]{1,2}[0-9][A-Z0-9]?)(?![A-Z0-9])", re.I)

# Places come back as every settlement sharing the name, hamlets included, in no
# useful order: "Newport" lists an Essex village first and the Welsh city tenth.
# So ask for plenty and rank them — see _best_place().
PLACES_LIMIT = 20
SETTLEMENT_RANK = {"City": 0, "Town": 1, "Village": 2}

# Keyed on the normalised query, e.g. ("outcode", "BB5"). Holds hits and
# not-founds alike — dozens of eBay vans share an outcode — but never a network
# failure. Lives as long as the process.
_cache: dict[tuple, tuple[float, float] | None] = {}


class GeoUnavailable(Exception):
    """postcodes.io couldn't be reached or answered oddly. Try again later —
    unlike a None result, this says nothing about whether the place exists."""


def _call(method: str, path: str, **kwargs) -> dict | None:
    """One postcodes.io request: the parsed body, or None for a 404."""
    try:
        response = httpx.request(method, BASE + path, headers=HEADERS, timeout=TIMEOUT, **kwargs)
    except httpx.HTTPError:
        raise GeoUnavailable("Couldn't reach postcodes.io")
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise GeoUnavailable(f"postcodes.io answered {response.status_code}")
    try:
        return response.json()
    except ValueError:
        raise GeoUnavailable("postcodes.io sent back something that isn't JSON")


def _point(result: dict | None) -> tuple[float, float] | None:
    """(lat, lng) from a postcode/outcode/place result. A few real postcodes
    carry no coordinates at all; those count as not found."""
    if not result or result.get("latitude") is None or result.get("longitude") is None:
        return None
    return float(result["latitude"]), float(result["longitude"])


def _compact(code: str) -> str:
    return re.sub(r"\s+", "", code).upper()


# ---------------------------------------------------------------- the three lookups

def postcode(code: str) -> tuple[float, float] | None:
    key = ("postcode", _compact(code))
    if key not in _cache:
        body = _call("GET", f"/postcodes/{quote(key[1], safe='')}")
        _cache[key] = _point(body and body.get("result"))
    return _cache[key]


def prime_postcodes(codes: list[str]) -> None:
    """Fill the cache for many full postcodes in as few calls as possible."""
    wanted = sorted({_compact(c) for c in codes} - {k[1] for k in _cache if k[0] == "postcode"})
    for start in range(0, len(wanted), BULK_LIMIT):
        chunk = wanted[start:start + BULK_LIMIT]
        body = _call("POST", "/postcodes", json={"postcodes": chunk}) or {}
        for entry in body.get("result") or []:
            _cache[("postcode", _compact(entry.get("query") or ""))] = _point(entry.get("result"))


def outcode(code: str) -> tuple[float, float] | None:
    key = ("outcode", _compact(code))
    if key not in _cache:
        body = _call("GET", f"/outcodes/{quote(key[1], safe='')}")
        _cache[key] = _point(body and body.get("result"))
    return _cache[key]


def place(name: str, hint: str | None = None) -> tuple[float, float] | None:
    key = ("place", name.lower(), (hint or "").lower())
    if key not in _cache:
        body = _call("GET", "/places", params={"q": name, "limit": PLACES_LIMIT}) or {}
        _cache[key] = _point(_best_place(body.get("result") or [], name, hint))
    return _cache[key]


def _best_place(results: list[dict], name: str, hint: str | None) -> dict | None:
    """Pick one of several same-named places.

    In order: the name matches exactly (not "Stafford Park" for "Stafford"); the
    county or region matches whatever followed the first comma ("Stafford,
    Staffordshire"); a city beats a town beats a village beats a hamlet; then
    postcodes.io's own order. Still a guess for an ambiguous bare name — Harry
    fixes those by adding a postcode to the location.
    """
    wanted = name.lower()
    hint = (hint or "").lower()

    def in_hint(result: dict) -> bool:
        if not hint:
            return False
        for field in ("county_unitary", "district_borough", "region"):
            value = (result.get(field) or "").lower()
            if value and (value in hint or hint in value):
                return True
        return False

    def rank(indexed: tuple[int, dict]):
        index, result = indexed
        names = {(result.get("name_1") or "").lower(), (result.get("name_2") or "").lower()}
        return (
            wanted not in names,
            not in_hint(result),
            SETTLEMENT_RANK.get(result.get("local_type"), len(SETTLEMENT_RANK)),
            index,
        )

    if not results:
        return None
    return min(enumerate(results), key=rank)[1]


# ---------------------------------------------------------------- free text

def _place_parts(text: str) -> tuple[str, str | None]:
    """(place name, county hint) from a location with any postcodes taken out:
    "Stafford, Staffordshire" -> ("Stafford", "Staffordshire")."""
    bare = OUTCODE_RE.sub(" ", FULL_RE.sub(" ", text)).replace("*", " ")
    name, _, rest = bare.partition(",")
    return " ".join(name.split()), " ".join(rest.replace(",", " ").split()) or None


def locate(text: str | None) -> tuple[float, float] | None:
    """Coordinates for a free-text UK location, or None when nothing matches.

    Lookup order (D-048), each step falling through to the next when it finds
    nothing: a full postcode anywhere in the text, then an outcode anywhere in
    it, then the text before the first comma as a place name. Raises
    GeoUnavailable when postcodes.io can't be reached.
    """
    if not text or not text.strip():
        return None
    for match in FULL_RE.finditer(text):
        point = postcode(match.group(1) + match.group(2))
        if point:
            return point
    for match in OUTCODE_RE.finditer(text):
        point = outcode(match.group(1))
        if point:
            return point
    name, hint = _place_parts(text)
    return place(name, hint) if name else None


def locate_postcode(text: str | None) -> tuple[str, float, float] | None:
    """A home's postcode — full or just the first half — as (tidied postcode,
    lat, lng). None when it isn't postcode-shaped or postcodes.io doesn't know it."""
    code = _compact(text or "")
    if FULL_RE.fullmatch(code):
        tidy, point = f"{code[:-3]} {code[-3:]}", postcode(code)
    elif OUTCODE_RE.fullmatch(code):
        tidy, point = code, outcode(code)
    else:
        return None
    return (tidy, *point) if point else None


# ---------------------------------------------------------------- listings

# A listing needs a lookup when it has a location that isn't the one its stored
# coordinates came from. geocoded_from is set even when nothing was found, so a
# location postcodes.io can't place is looked up once, not on every scrape.
NEEDS_LOOKUP_SQL = """
    SELECT id, location FROM listings
    WHERE location IS NOT NULL AND TRIM(location) != ''
      AND (geocoded_from IS NULL OR geocoded_from != location)
"""


def _store(conn, listing_id: int, geocoded_from: str | None, point) -> None:
    lat, lng = point if point else (None, None)
    conn.execute(
        "UPDATE listings SET lat = ?, lng = ?, geocoded_from = ? WHERE id = ?",
        (lat, lng, geocoded_from, listing_id),
    )


def locate_listing(conn, listing_id: int, location: str | None) -> None:
    """Look up one listing's location right now (a create, or a location edit).

    Never raises: the listing is already saved in this same transaction, and a
    map lookup must not undo that. Any failure leaves it looked-up-never —
    coordinates cleared, so an edited location can't keep showing the old place
    — and the next fill_missing pass (Retry, or the next scrape) picks it up.
    """
    if not location or not location.strip():
        _store(conn, listing_id, None, None)
        return
    try:
        point = locate(location)
    except Exception:
        _store(conn, listing_id, None, None)
        return
    _store(conn, listing_id, location, point)


def fill_missing(conn) -> dict:
    """Look up every listing that needs it. Returns {located, not_found, failed}.

    Stops at the first network failure: postcodes.io is down or the machine is
    offline, and every remaining lookup would only sit out its own timeout.
    Those listings keep their old geocoded_from, so the next pass retries them.
    """
    conn.execute(
        "UPDATE listings SET lat = NULL, lng = NULL, geocoded_from = NULL"
        " WHERE (location IS NULL OR TRIM(location) = '') AND geocoded_from IS NOT NULL"
    )
    rows = conn.execute(NEEDS_LOOKUP_SQL).fetchall()
    counts = {"located": 0, "not_found": 0, "failed": 0}
    try:
        prime_postcodes([m.group(1) + m.group(2) for r in rows for m in FULL_RE.finditer(r["location"])])
    except GeoUnavailable:
        counts["failed"] = len(rows)
        return counts
    for done, row in enumerate(rows):
        try:
            point = locate(row["location"])
        except GeoUnavailable:
            counts["failed"] = len(rows) - done
            break
        _store(conn, row["id"], row["location"], point)
        counts["located" if point else "not_found"] += 1
    return counts
