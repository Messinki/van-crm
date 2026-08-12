"""DVSA MOT History API client: auth, fetch, 7-day cache, derived fields.

This is the new (2023+) MOT History API, not the old beta.check-mot one. Field
names below were verified against a live response on 2026-08-11.

The optional DVLA Vehicle Enquiry Service lives here too — it is two functions
and only feeds /api/lookup/reg, so it doesn't earn a module of its own.
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

import httpx

from app import db

DVSA_VARS = ("DVSA_CLIENT_ID", "DVSA_CLIENT_SECRET", "DVSA_API_KEY", "DVSA_TOKEN_URL", "DVSA_SCOPE")

HISTORY_URL = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{reg}"
VES_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles"

TIMEOUT = 30.0
CACHE_MAX_AGE = timedelta(days=7)
# A token lasts an hour; refresh once under a minute is left.
#
# Timed against the wall clock, not time.monotonic(): the token's own expiry is
# wall-clock, and macOS stops the monotonic clock while the machine sleeps. A
# laptop shut overnight wakes with monotonic hours behind, so a monotonic
# deadline would keep serving a token that expired during the night — DVSA then
# answers 401 on every fetch until the process restarts.
TOKEN_MARGIN_S = 60

# The plate goes into the URL as a path segment, so it has to be checked before
# it is interpolated. A slash reads as a new segment and the DVSA gateway answers
# 403 MOTH-BR-01 for the unmatched path — indistinguishable, from the status code
# alone, from a rejected API key. Verified against the live API on 2026-08-12.
REG_CHARS = re.compile(r"\A[A-Z0-9]{1,15}\Z")

# Spec §5.3's plate pattern, for pulling a reg out of free text (a listing title,
# a pasted description). It lives here rather than in main.py because both the
# manual-add route and the eBay importer need it and one regex is enough.
REG_RE = re.compile(r"\b[A-Z]{2}[0-9]{2}\s?[A-Z]{3}\b", re.IGNORECASE)

RECENT_YEARS = 3
KEYWORDS = ("corrod", "rust", "oil leak", "excessively")
KM_TO_MILES = 0.621

# Defect severities DVSA uses today. Older (pre-2018) tests carry other strings —
# FAIL, PRS, USER ENTERED — which are bucketed as advisories unless the defect
# also carries dangerous: true.
DEFECT_LEVELS = ("DANGEROUS", "MAJOR", "MINOR", "ADVISORY")


class MotError(Exception):
    """An upstream failure with a status to return and a message fit for the UI."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def configured() -> bool:
    return all(os.environ.get(name) for name in DVSA_VARS)


def ves_configured() -> bool:
    return bool(os.environ.get("DVLA_VES_API_KEY"))


# ---------------------------------------------------------------- auth

# Module-level so a run of MOT checks costs one token, not one per lookup.
_token = {"value": None, "expires_at": 0.0}


def _access_token(force: bool = False) -> str:
    now = time.time()
    if not force and _token["value"] and _token["expires_at"] - now > TOKEN_MARGIN_S:
        return _token["value"]

    try:
        response = httpx.post(
            os.environ["DVSA_TOKEN_URL"],
            data={
                "grant_type": "client_credentials",
                "client_id": os.environ["DVSA_CLIENT_ID"],
                "client_secret": os.environ["DVSA_CLIENT_SECRET"],
                "scope": os.environ["DVSA_SCOPE"],
            },
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        raise MotError(502, "Could not reach the DVSA sign-in service — check your connection")

    if response.status_code != 200:
        # Deliberately no response body: it can echo the client id back.
        raise MotError(502, "DVSA rejected the credentials — check the DVSA_* values in .env")

    payload = response.json()
    _token["value"] = payload["access_token"]
    _token["expires_at"] = now + float(payload.get("expires_in", 3600))
    return _token["value"]


# ---------------------------------------------------------------- fetch

def clean_reg(reg) -> str:
    """The plate as the API wants it in a path segment, or MotError(400)."""
    cleaned = str(reg or "").replace(" ", "").upper()
    if not cleaned:
        raise MotError(400, "enter a number plate")
    if not REG_CHARS.match(cleaned):
        raise MotError(400, f"'{cleaned}' is not a number plate — letters and digits only")
    return cleaned


def extract_reg(*texts: str | None) -> str | None:
    """The single distinct UK plate found across the given texts, else None.

    Two different plates in one listing means the seller quoted someone else's van
    (or a part number that looks like a plate), so ambiguity stores nothing.
    """
    found = set()
    for text in texts:
        if not text:
            continue
        for match in REG_RE.findall(text):
            found.add(match.replace(" ", "").upper())
    return found.pop() if len(found) == 1 else None


def fetch_history(reg: str) -> dict:
    """The vehicle's full MOT history, verbatim. Raises MotError on anything else."""
    reg = clean_reg(reg)

    def call(fresh_token: bool):
        headers = {
            "Authorization": f"Bearer {_access_token(force=fresh_token)}",
            "X-API-Key": os.environ["DVSA_API_KEY"],
            "Accept": "application/json",
        }
        try:
            return httpx.get(HISTORY_URL.format(reg=reg), headers=headers, timeout=TIMEOUT)
        except httpx.HTTPError:
            raise MotError(502, "Could not reach the DVSA MOT History API — check your connection")

    response = call(fresh_token=False)
    if response.status_code in (401, 403):
        # The cached token was refused. The gateway answers 403 for a token it
        # cannot use and 401 for one it can read but won't accept, so neither
        # status on its own means the credentials are wrong — retry once with a
        # brand-new token, and only report a problem if that is refused too.
        response = call(fresh_token=True)

    if response.status_code == 200:
        return response.json()
    if response.status_code == 404:
        raise MotError(404, f"No MOT record found for {reg}")
    if response.status_code == 400:
        raise MotError(400, f"'{reg}' is not a registration the DVSA API accepts")
    # Reaching here means the token call already succeeded, so the client id and
    # secret are good and only the two remaining credentials are suspects. Naming
    # the likely one beats sending you back to re-check all five.
    if response.status_code == 401:
        raise MotError(502, "DVSA rejected the access token — check DVSA_SCOPE in .env")
    if response.status_code == 403:
        raise MotError(502, "DVSA rejected the API key — check DVSA_API_KEY in .env, or you may be over your daily quota")
    if response.status_code == 429:
        raise MotError(429, "DVSA rate limit reached — try again in a minute")
    raise MotError(502, f"The DVSA MOT History API returned {response.status_code}")


def fetch_ves(reg: str) -> dict:
    """DVLA Vehicle Enquiry Service. Only called when DVLA_VES_API_KEY is set."""
    try:
        response = httpx.post(
            VES_URL,
            headers={"x-api-key": os.environ["DVLA_VES_API_KEY"], "Accept": "application/json"},
            json={"registrationNumber": reg},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        raise MotError(502, "Could not reach the DVLA Vehicle Enquiry Service")

    if response.status_code == 200:
        return response.json()
    if response.status_code == 404:
        raise MotError(404, f"DVLA has no vehicle record for {reg}")
    if response.status_code == 400:
        raise MotError(400, f"'{reg}' is not a registration the DVLA API accepts")
    if response.status_code in (401, 403):
        raise MotError(502, "DVLA refused the request — check DVLA_VES_API_KEY in .env")
    raise MotError(502, f"The DVLA Vehicle Enquiry Service returned {response.status_code}")


# ---------------------------------------------------------------- cache

def _parse_iso(value) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _is_fresh(fetched_at) -> bool:
    stamp = _parse_iso(fetched_at)
    return stamp is not None and datetime.now(timezone.utc) - stamp < CACHE_MAX_AGE


def get_cached_or_fetch(conn, reg: str, force: bool = False) -> tuple[dict, str, bool]:
    """(raw, fetched_at, from_cache). Serves a cache row under 7 days old unless forced.

    Errors are never cached — a failed fetch leaves any existing row alone.
    """
    row = conn.execute(
        "SELECT fetched_at, raw_json FROM mot_cache WHERE reg = ?", (reg,)
    ).fetchone()
    if row is not None and not force and _is_fresh(row["fetched_at"]):
        return json.loads(row["raw_json"]), row["fetched_at"], True

    raw = fetch_history(reg)
    fetched_at = db.now_iso()
    conn.execute(
        "INSERT OR REPLACE INTO mot_cache (reg, fetched_at, raw_json) VALUES (?, ?, ?)",
        (reg, fetched_at, json.dumps(raw)),
    )
    return raw, fetched_at, False


# ---------------------------------------------------------------- derived (spec §6.3)

def _odometer_miles(test: dict) -> int | None:
    """odometerValue is a string, and the unit may be KM."""
    raw = test.get("odometerValue")
    if raw in (None, ""):
        return None
    try:
        value = float(str(raw).replace(",", ""))
    except ValueError:
        return None
    if str(test.get("odometerUnit") or "MI").upper().startswith("K"):
        value *= KM_TO_MILES
    return round(value)


def _defect_level(defect: dict) -> str:
    """Normalise a defect to one of DEFECT_LEVELS.

    Unknown types (older tests use FAIL / PRS / USER ENTERED) count as advisories
    unless the defect is flagged dangerous.
    """
    if defect.get("dangerous") is True:
        return "DANGEROUS"
    level = str(defect.get("type") or "").upper()
    return level if level in DEFECT_LEVELS else "ADVISORY"


def _completed(test: dict) -> str:
    """Full completedDate, e.g. 2026-01-28T17:21:54.000Z ('' when absent, so it
    sorts oldest). Sorting on this and not the date alone is what puts a same-day
    retest after the fail it followed."""
    return str(test.get("completedDate") or "")


def _normalise_test(test: dict) -> dict:
    return {
        "date": _completed(test)[:10],
        "result": test.get("testResult"),
        "expiry": test.get("expiryDate"),
        "odometer_miles": _odometer_miles(test),
        "defects": [
            {"level": _defect_level(d), "text": d.get("text") or "", "dangerous": d.get("dangerous") is True}
            for d in (test.get("defects") or [])
        ],
    }


def derive(raw: dict) -> dict:
    """The computed view of an MOT history. Every key is always present."""
    raw = raw or {}
    tests = sorted(raw.get("motTests") or [], key=_completed, reverse=True)
    normalised = [_normalise_test(t) for t in tests]
    latest = normalised[0] if normalised else None

    # An expiry only comes with a pass, so fall back through the history for it.
    latest_expiry = next((t["expiry"] for t in normalised if t["expiry"]), None)

    series = [
        {"date": t["date"], "miles": t["odometer_miles"]}
        for t in reversed(normalised) if t["odometer_miles"] is not None and t["date"]
    ]
    miles = [point["miles"] for point in series]
    mileage_warning = any(b < a for a, b in zip(miles, miles[1:]))

    cutoff = (datetime.now(timezone.utc) - timedelta(days=365 * RECENT_YEARS)).strftime("%Y-%m-%d")
    recent = [t for t in normalised if t["date"] >= cutoff]

    keyword_flags = [
        defect["text"] for test in recent for defect in test["defects"]
        if any(word in defect["text"].lower() for word in KEYWORDS)
    ]

    # A fail that was fixed on a retest still says something about the van, so
    # recent history is counted whole rather than latest-test-only.
    serious = {
        "dangerous": sum(1 for t in recent for d in t["defects"] if d["level"] == "DANGEROUS"),
        "major": sum(1 for t in recent for d in t["defects"] if d["level"] == "MAJOR"),
        "fails": sum(1 for t in recent if t["result"] == "FAILED"),
    }

    return {
        "make": raw.get("make"),
        "model": raw.get("model"),
        "fuel_type": raw.get("fuelType"),
        "first_used_date": raw.get("firstUsedDate"),
        "colour": raw.get("primaryColour"),
        "engine_size": raw.get("engineSize"),
        "latest_result": latest["result"] if latest else None,
        "latest_expiry": latest_expiry,
        "latest_test_date": latest["date"] if latest else None,
        "latest_odometer_miles": latest["odometer_miles"] if latest else None,
        "latest_advisory_count": (
            sum(1 for d in latest["defects"] if d["level"] in ("ADVISORY", "MINOR")) if latest else 0
        ),
        "mileage_series": series,
        "mileage_warning": mileage_warning,
        "keyword_flags": keyword_flags,
        "serious": serious,
        "test_count": len(normalised),
        # Normalised newest-first tests, so the drawer's breakdown doesn't have to
        # re-parse odometer strings and defect types in the browser.
        "tests": normalised,
    }


def summary(raw: dict, fetched_at: str) -> dict:
    """The compact blob the listings payload carries, for the table's MOT column."""
    d = derive(raw)
    return {
        "expiry": d["latest_expiry"],
        "result": d["latest_result"],
        "test_date": d["latest_test_date"],
        "odometer_miles": d["latest_odometer_miles"],
        "advisories": d["latest_advisory_count"],
        "dangerous": d["serious"]["dangerous"],
        "major": d["serious"]["major"],
        "fails": d["serious"]["fails"],
        "mileage_warning": d["mileage_warning"],
        "flagged": bool(d["keyword_flags"]),
        "fetched_at": fetched_at,
    }
