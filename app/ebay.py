"""eBay Browse API client: OAuth, saved-search scrape, upsert, import from a link.

Verified against eBay's published Browse API contract (OpenAPI `buy_browse_v1_oas3`,
version v1.20.4) and against the live API with the keyset in `.env`, on 2026-08-12.
What that verification settled is written up in the README under "Decisions made";
the two findings that shape the code here are:

* **Search returns FIXED_PRICE listings only unless `buyingOptions` is filtered.**
  The contract says so in as many words, so the filter is not optional garnish —
  without it every auction and classified-ad van is invisible, which is most of
  them on eBay UK. `CLASSIFIED_AD` is accepted by the live API today.
* **An unknown filter name is not an error.** The call returns 200 with the filter
  silently ignored and a note in the response's `warnings[]`. So warnings are
  collected into the scrape summary rather than dropped — a typo'd filter would
  otherwise look like a search that simply found nothing.
"""

import html
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

import httpx

from app import db, mot

EBAY_VARS = ("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET")

# A scrape does one detail HTTP call per new item and can run for minutes, so the
# UI polls this for feedback rather than sitting on a silent spinner. Plain module
# state is enough here — one user, one scrape at a time.
PROGRESS = {"running": False, "processed": 0, "label": None, "started_at": None}

BASES = {
    "PRODUCTION": "https://api.ebay.com",
    "SANDBOX": "https://api.sandbox.ebay.com",
}
# An identifier, not a URL to call: the same scope string is used against both
# environments (confirmed — the sandbox token endpoint accepts it).
OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope"

TIMEOUT = 45.0
# Wall clock, never time.monotonic() — see the note on mot.TOKEN_MARGIN_S. macOS
# freezes the monotonic clock while asleep, which silently serves dead tokens.
TOKEN_MARGIN_S = 60

PAGE_SIZE = 200      # the contract's documented maximum for item_summary/search
MAX_PAGES = 3        # spec §5.2
MAX_REDIRECTS = 5    # amendment §E, for the ebay.us / ebay.to shorteners

# The user is buying a van to convert, never a project or a parts donor, so
# "For parts or not working" items are dropped before they can reach the table.
# 7000 is eBay's condition id for it; the text check catches the vehicle
# categories that describe the condition without carrying the id.
PARTS_CONDITION_IDS = {"7000"}
PARTS_CONDITION_RE = re.compile(r"for parts|not working|spares?\s*(?:or|/|&)\s*repair", re.I)

# Aspect names vary by seller, so match case-insensitively against a set of
# spellings and ignore everything unrecognised (amendment §E step 3).
ASPECT_KEYS = {
    "make": ("make", "manufacturer"),
    "model": ("model", "model series"),
    "year": ("year", "year of manufacture", "manufacture year", "model year"),
    "mileage": ("mileage", "mileage (miles)", "miles", "odometer reading"),
}

YEAR_RE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
DIGITS_RE = re.compile(r"\d[\d,]*")
SHORTENER_HOSTS = {"ebay.us", "ebay.to", "www.ebay.us", "www.ebay.to"}
# A legacy item id is a bare 9-13 digit path segment: /itm/123456789012 and
# /itm/some-title-slug/123456789012 both end in one, and a slug full of digits
# ("...-2-35A-...") never forms a whole segment, so it can't be mistaken for one.
ITEM_ID_RE = re.compile(r"(?:^|/)(\d{9,13})(?=/|$)")

# eBay item descriptions are HTML, frequently a whole seller template. The text
# lands in `notes` (this app has no description column — see the README), so it
# is stripped to plain text and capped rather than pasted in whole.
DESCRIPTION_LIMIT = 4000
TAG_RE = re.compile(r"<[^>]+>")
# Block-level tags become line breaks (either end of them — a bullet list is one
# line per item whether the seller closed the <li> or not). Blank lines are dropped
# afterwards, so an over-eager break costs nothing.
BREAK_RE = re.compile(r"<\s*/?\s*(br|p|div|li|tr|ul|ol|table|h[1-6])\b[^>]*>", re.I)
DROP_RE = re.compile(r"<(script|style)\b.*?</\1>", re.I | re.S)


class EbayError(Exception):
    """An upstream failure with a status to return and a message fit for the UI."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def configured() -> bool:
    return all(os.environ.get(name) for name in EBAY_VARS)


def environment() -> str:
    """PRODUCTION or SANDBOX. Anything unrecognised is treated as production."""
    value = (os.environ.get("EBAY_ENV") or "PRODUCTION").strip().upper()
    return value if value in BASES else "PRODUCTION"


def base_url() -> str:
    return BASES[environment()]


def marketplace() -> str:
    return os.environ.get("EBAY_MARKETPLACE_ID") or "EBAY_GB"


# ---------------------------------------------------------------- auth (spec §5.1)

# Module-level, so a scrape of five searches costs one token and not one per call.
# `base` rides along so switching EBAY_ENV can never reuse the other environment's
# token — they are different issuers and the mix-up reads as a credentials failure.
_token = {"value": None, "expires_at": 0.0, "base": None}


def _access_token(force: bool = False) -> str:
    now = time.time()
    base = base_url()
    if (
        not force
        and _token["value"]
        and _token["base"] == base
        and _token["expires_at"] - now > TOKEN_MARGIN_S
    ):
        return _token["value"]

    try:
        response = httpx.post(
            f"{base}/identity/v1/oauth2/token",
            auth=(os.environ["EBAY_CLIENT_ID"], os.environ["EBAY_CLIENT_SECRET"]),
            data={"grant_type": "client_credentials", "scope": OAUTH_SCOPE},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        raise EbayError(502, "Could not reach eBay to sign in — check your connection")

    if response.status_code != 200:
        # No response body in the message: it can echo the client id back.
        raise EbayError(
            502,
            "eBay rejected the credentials — check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET "
            f"in .env, and that they are a {environment().lower()} keyset (EBAY_ENV is "
            f"{environment()})",
        )

    payload = response.json()
    _token.update(
        value=payload["access_token"],
        expires_at=now + float(payload.get("expires_in", 7200)),
        base=base,
    )
    return _token["value"]


# ---------------------------------------------------------------- http

def _request(path: str, params: dict | None = None) -> httpx.Response:
    """GET a Browse API path with auth + marketplace headers. Never raises on 4xx."""
    if not configured():
        raise EbayError(503, "eBay is not configured yet — add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env")

    def call(fresh_token: bool) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {_access_token(force=fresh_token)}",
            "X-EBAY-C-MARKETPLACE-ID": marketplace(),
            "Accept": "application/json",
        }
        try:
            return httpx.get(f"{base_url()}{path}", headers=headers, params=params, timeout=TIMEOUT)
        except httpx.HTTPError:
            raise EbayError(502, "Could not reach the eBay Browse API — check your connection")

    response = call(fresh_token=False)
    if response.status_code in (401, 403):
        # A cached token the gateway won't take: retry once with a fresh one before
        # blaming the credentials (same reasoning as mot.fetch_history).
        response = call(fresh_token=True)
    return response


def _json_or_error(response: httpx.Response, what: str) -> dict:
    if response.status_code == 200:
        return response.json()
    if response.status_code == 404:
        raise EbayError(404, f"{what} was not found on eBay")
    if response.status_code in (401, 403):
        raise EbayError(502, "eBay refused the request — check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env")
    if response.status_code == 429:
        raise EbayError(429, "eBay's rate limit is reached — try again shortly")
    raise EbayError(502, f"The eBay Browse API returned {response.status_code} for {what}")


# ---------------------------------------------------------------- mapping (spec §5.3)

def _text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _price_gbp(item: dict) -> float | None:
    """The price, but only when eBay quotes it in pounds (acceptance checklist)."""
    price = item.get("price") or {}
    if (price.get("currency") or "").upper() != "GBP":
        return None
    try:
        return float(price["value"])
    except (KeyError, TypeError, ValueError):
        return None


def _location(item: dict) -> str | None:
    loc = item.get("itemLocation") or {}
    parts = [_text(loc.get("city")), _text(loc.get("postalCode"))]
    joined = ", ".join(p for p in parts if p)
    return joined or _text(loc.get("country"))


def _images(item: dict) -> list[str]:
    urls = []
    primary = (item.get("image") or {}).get("imageUrl")
    if primary:
        urls.append(primary)
    for extra in item.get("additionalImages") or []:
        url = extra.get("imageUrl")
        if url:
            urls.append(url)
    seen, unique = set(), []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    return unique


def description_text(raw: str | None) -> str:
    """An eBay HTML description as plain text, capped at DESCRIPTION_LIMIT."""
    if not raw:
        return ""
    text = DROP_RE.sub(" ", raw)
    text = BREAK_RE.sub("\n", text)
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)
    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.split("\n")]
    cleaned = "\n".join(line for line in lines if line)
    if len(cleaned) > DESCRIPTION_LIMIT:
        cleaned = cleaned[:DESCRIPTION_LIMIT].rstrip() + "\n…(description truncated)"
    return cleaned


def _as_int(value) -> int | None:
    match = DIGITS_RE.search(str(value or ""))
    if not match:
        return None
    try:
        return int(match.group(0).replace(",", ""))
    except ValueError:
        return None


def aspect_fields(item: dict) -> dict:
    """make / model / year / mileage read out of `localizedAspects` (amendment §E)."""
    found: dict = {}
    for aspect in item.get("localizedAspects") or []:
        name = (aspect.get("name") or "").strip().lower()
        value = _text(aspect.get("value"))
        if not name or not value:
            continue
        for field, names in ASPECT_KEYS.items():
            if name in names and field not in found:
                found[field] = value
    for field in ("year", "mileage"):
        if field in found:
            number = _as_int(found[field])
            if number is None:
                found.pop(field)
            else:
                found[field] = number
    year = found.get("year")
    if year is not None and not (1950 <= year <= datetime.now(timezone.utc).year + 1):
        found.pop("year")
    return found


def title_year(title: str | None) -> int | None:
    match = YEAR_RE.search(title or "")
    return int(match.group(1)) if match else None


def is_spares_or_repairs(item: dict) -> bool:
    if str(item.get("conditionId") or "") in PARTS_CONDITION_IDS:
        return True
    return bool(PARTS_CONDITION_RE.search(item.get("condition") or ""))


def _listing_fields(item: dict, detail: dict | None) -> dict:
    """The listings columns for one eBay item, summary merged with its detail."""
    source = {**item, **(detail or {})}
    fields = {
        "source": "ebay",
        "external_id": source.get("itemId") or item.get("itemId"),
        "url": _text(source.get("itemWebUrl")),
        "title": _text(source.get("title")) or "eBay listing",
        "price_gbp": _price_gbp(source),
        "location": _location(source),
        "seller_name": _text((source.get("seller") or {}).get("username")),
        "image_urls": json.dumps(_images(source)),
        "notes": description_text((detail or {}).get("description")),
    }
    for field, value in aspect_fields(source).items():
        fields[field] = value
    if not fields.get("year"):
        year = title_year(fields["title"])
        if year:
            fields["year"] = year
    return fields


# ---------------------------------------------------------------- search (spec §5.2)

def _filters(search: dict) -> str:
    filters = ["itemLocationCountry:GB"]
    min_price = search.get("min_price")
    max_price = search.get("max_price")
    if min_price or max_price:
        lo = f"{float(min_price):g}" if min_price else ""
        hi = f"{float(max_price):g}" if max_price else ""
        filters.append(f"price:[{lo}..{hi}]")
        filters.append("priceCurrency:GBP")
    # Not optional: without it eBay returns FIXED_PRICE listings only, and most
    # UK vans are auctions or classified ads.
    filters.append("buyingOptions:{FIXED_PRICE|AUCTION|CLASSIFIED_AD}")
    return ",".join(filters)


def search_items(search: dict, warnings: list[str]) -> list[dict]:
    """Every item summary for one saved search, up to MAX_PAGES pages."""
    items: list[dict] = []
    for page in range(MAX_PAGES):
        params = {
            "q": search["query"],
            "filter": _filters(search),
            "limit": str(PAGE_SIZE),
            "offset": str(page * PAGE_SIZE),
        }
        if search.get("category_id"):
            params["category_ids"] = str(search["category_id"])

        payload = _json_or_error(_request("/buy/browse/v1/item_summary/search", params), "the search")
        for warning in payload.get("warnings") or []:
            message = warning.get("message")
            if message and message not in warnings:
                warnings.append(message)

        page_items = payload.get("itemSummaries") or []
        items.extend(page_items)
        total = payload.get("total") or 0
        if len(page_items) < PAGE_SIZE or (page + 1) * PAGE_SIZE >= total:
            break
    return items


def fetch_item(item_id: str) -> dict:
    """Full item detail — description, aspects, end date (spec §5.3)."""
    path = f"/buy/browse/v1/item/{quote(str(item_id), safe='')}"
    return _json_or_error(_request(path), "that item")


def fetch_item_by_legacy_id(legacy_id: str) -> dict:
    """Item detail from a website item id (amendment §E step 2)."""
    return _json_or_error(
        _request("/buy/browse/v1/item/get_item_by_legacy_id", {"legacy_item_id": str(legacy_id)}),
        "that item",
    )


# ---------------------------------------------------------------- upsert (spec §5.3)

def _existing_id(conn, external_id: str) -> int | None:
    row = conn.execute(
        "SELECT id FROM listings WHERE source = 'ebay' AND external_id = ?", (external_id,)
    ).fetchone()
    return row["id"] if row else None


def _insert(conn, fields: dict) -> int:
    now = db.now_iso()
    fields = {
        **fields,
        "status": "new",
        "first_seen_at": now,
        "last_seen_at": now,
        "created_at": now,
        "updated_at": now,
    }
    fields.setdefault("notes", "")
    columns = ", ".join(fields)
    placeholders = ", ".join("?" * len(fields))
    cursor = conn.execute(
        f"INSERT INTO listings ({columns}) VALUES ({placeholders})", list(fields.values())
    )
    return cursor.lastrowid


def _touch_existing(conn, listing_id: int, price: float | None) -> None:
    """A re-seen item: price and timestamps only.

    Everything a person can edit — status, notes, custom, reg, year, mileage — is
    left exactly as it is. That is the whole point of a rescrape being safe.
    """
    now = db.now_iso()
    if price is None:
        conn.execute(
            "UPDATE listings SET last_seen_at = ?, updated_at = ? WHERE id = ?", (now, now, listing_id)
        )
    else:
        conn.execute(
            "UPDATE listings SET price_gbp = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
            (price, now, now, listing_id),
        )


def _finalise_new(conn, listing_id: int, fields: dict) -> None:
    """Reg extraction, then a free MOT check for the plate it found.

    A DVSA failure here is not a scrape failure: the listing is already saved and
    the MOT column just falls back to its Check button.
    """
    reg = mot.extract_reg(fields.get("title"), fields.get("notes"))
    if not reg:
        return
    conn.execute("UPDATE listings SET reg = ? WHERE id = ?", (reg, listing_id))
    if not mot.configured():
        return
    try:
        mot.get_cached_or_fetch(conn, reg)
    except Exception:
        pass


def _year_allowed(year: int | None, search: dict) -> bool:
    """Year range filter, applied in Python — see the README for why not server-side.

    An item whose year cannot be determined is kept: under-filtering shows the user
    one extra van, over-filtering hides the right one.
    """
    if year is None:
        return True
    low, high = search.get("year_min"), search.get("year_max")
    if low and year < int(low):
        return False
    if high and year > int(high):
        return False
    return True


def upsert_item(conn, item: dict, search: dict) -> str:
    """Insert, update or skip one search result. Returns 'new'|'updated'|'skipped'."""
    item_id = item.get("itemId")
    if not item_id:
        return "skipped"
    if is_spares_or_repairs(item):
        return "skipped"

    existing = _existing_id(conn, item_id)
    if existing is not None:
        _touch_existing(conn, existing, _price_gbp(item))
        return "updated"

    # Cheap pre-check before spending a detail call on an obviously out-of-range van.
    if not _year_allowed(title_year(item.get("title")), search):
        return "skipped"

    try:
        detail = fetch_item(item_id)
    except EbayError:
        # No description and no aspects, but the summary alone is still a listing.
        detail = None

    if detail and is_spares_or_repairs(detail):
        return "skipped"

    fields = _listing_fields(item, detail)
    if not _year_allowed(fields.get("year"), search):
        return "skipped"

    listing_id = _insert(conn, fields)
    _finalise_new(conn, listing_id, fields)
    return "new"


def scrape(conn) -> dict:
    """Run every enabled saved search. Returns {new, updated, skipped, errors}."""
    if not configured():
        raise EbayError(503, "eBay is not configured yet — add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env")

    summary = {"new": 0, "updated": 0, "skipped": 0, "errors": []}
    rows = conn.execute("SELECT * FROM searches WHERE enabled = 1 ORDER BY id").fetchall()
    if not rows:
        summary["errors"].append("No searches are enabled — add one under Searches")
        return summary

    PROGRESS.update(running=True, processed=0, label=None, started_at=time.time())
    try:
        seen: set[str] = set()
        for row in rows:
            search = db.row_to_search(row)
            PROGRESS["label"] = search["label"]
            warnings: list[str] = []
            try:
                items = search_items(search, warnings)
            except EbayError as err:
                summary["errors"].append(f"{search['label']}: {err.message}")
                continue
            finally:
                summary["errors"].extend(f"{search['label']}: {w}" for w in warnings)

            for item in items:
                item_id = item.get("itemId")
                if item_id in seen:
                    # The same van matches several searches; count and process it once.
                    continue
                if item_id:
                    seen.add(item_id)
                try:
                    summary[upsert_item(conn, item, search)] += 1
                except EbayError as err:
                    summary["errors"].append(f"{search['label']}: {err.message}")
                except Exception as err:  # one bad item must not end the scrape
                    summary["errors"].append(f"{search['label']}: could not save an item ({err})")
                else:
                    # Commit per item so an interruption keeps what it already found.
                    conn.commit()
                finally:
                    PROGRESS["processed"] += 1
        return summary
    finally:
        PROGRESS["running"] = False


# ---------------------------------------------------------------- liveness (spec §5.4)

def _ended(item: dict) -> bool:
    raw = item.get("itemEndDate")
    if not raw:
        # Good-till-cancelled listings carry no end date; absence is not an ending.
        return False
    try:
        end = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return end < datetime.now(timezone.utc)


def check_item(external_id: str) -> dict:
    """{active, price_gbp, message} for one eBay item id."""
    try:
        item = fetch_item(external_id)
    except EbayError as err:
        if err.status == 404:
            return {"active": False, "price_gbp": None, "message": "This listing has gone from eBay"}
        raise
    if _ended(item):
        return {"active": False, "price_gbp": _price_gbp(item), "message": "This listing has ended"}
    return {"active": True, "price_gbp": _price_gbp(item), "message": "Still live on eBay"}


# ---------------------------------------------------------------- import (amendment §E)

def parse_item_id(url: str | None) -> str | None:
    """The legacy (website) item id in an eBay URL, or None.

    Handles /itm/123456789012, /itm/some-title-slug/123456789012, any query string
    or fragment, and a bare id pasted on its own. Shorteners are resolved first by
    resolve_url().
    """
    text = (url or "").strip()
    if not text:
        return None
    if re.fullmatch(r"\d{9,13}", text):
        return text
    parsed = urlparse(text if "//" in text else "https://" + text)
    matches = ITEM_ID_RE.findall(parsed.path)
    return matches[-1] if matches else None


def is_shortener(url: str) -> bool:
    host = urlparse(url if "//" in url else "https://" + url).netloc.lower()
    return host in SHORTENER_HOSTS


def resolve_url(url: str) -> str:
    """Follow an ebay.us / ebay.to short link to the listing it points at."""
    try:
        with httpx.Client(follow_redirects=True, max_redirects=MAX_REDIRECTS, timeout=TIMEOUT) as client:
            response = client.get(url if "//" in url else "https://" + url)
        return str(response.url)
    except httpx.HTTPError:
        raise EbayError(502, "Could not follow that short link — try the full listing URL")


def import_from_url(conn, url: str) -> tuple[int, bool]:
    """Import one eBay listing by URL. Returns (listing_id, created)."""
    if not configured():
        raise EbayError(503, "eBay is not configured yet — add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to .env")

    target = (url or "").strip()
    if is_shortener(target):
        target = resolve_url(target)
    item_id = parse_item_id(target)
    if not item_id:
        raise EbayError(422, "Couldn't find an item id in that URL")

    detail = fetch_item_by_legacy_id(item_id)
    external_id = detail.get("itemId")
    if not external_id:
        raise EbayError(502, "eBay returned an item with no id")

    existing = _existing_id(conn, external_id)
    if existing is not None:
        return existing, False

    if is_spares_or_repairs(detail):
        raise EbayError(422, "That listing is 'for parts or not working' — not one to track")

    fields = _listing_fields(detail, detail)
    listing_id = _insert(conn, fields)
    _finalise_new(conn, listing_id, fields)
    conn.commit()
    return listing_id, True
