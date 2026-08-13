"""
witness_builder.py — Converts app.ocr's extraction output into the private
witness for circuits/kyc.circom, and looks up the correct non-membership
Merkle bracket for the prover's nationality code.

Replaces the ad-hoc `inputs` dict that used to live inline in kyc.py.
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4
from loguru import logger

# ── Country name -> ISO 3166-1 numeric code ──────────────────────────────────
# OCR returns free-text nationality (e.g. "NIGERIAN", "USA"); the circuit
# needs numeric codes to compare against the restricted bracket tree.
# Extend this map as needed — keep it in sync with build_restricted_tree.js.
COUNTRY_CODE_MAP = {
    "NIGERIA": 566, "NIGERIAN": 566,
    "USA": 840, "UNITED STATES": 840, "AMERICAN": 840,
    "UK": 826, "UNITED KINGDOM": 826, "BRITISH": 826,
    "NORTH KOREA": 408, "DPRK": 408,
    "IRAN": 364, "IRANIAN": 364,
    "SYRIA": 760, "SYRIAN": 760,
    "CUBA": 192, "CUBAN": 192,
    # ... extend for your hackathon demo's expected test documents
}

RESTRICTED_TREE_PATH = Path(__file__).parent / "restricted_tree.json"

DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"]


class WitnessBuildError(Exception):
    pass


def _parse_date_to_unix(date_str: str) -> int:
    if not date_str:
        raise WitnessBuildError("Missing date field from OCR")
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(date_str.strip(), fmt).replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except ValueError:
            continue
    raise WitnessBuildError(f"Could not parse date: {date_str!r}")


def _nationality_to_code(nationality_text: Optional[str]) -> int:
    if not nationality_text:
        raise WitnessBuildError("Missing nationality field from OCR")
    key = nationality_text.strip().upper()
    if key not in COUNTRY_CODE_MAP:
        raise WitnessBuildError(
            f"Unrecognized nationality text from OCR: {nationality_text!r}. "
            f"Add it to COUNTRY_CODE_MAP in witness_builder.py."
        )
    return COUNTRY_CODE_MAP[key]


def _doc_number_to_numeric(doc_number: str) -> int:
    """Hashes the alphanumeric doc number down to a field-sized int.
    We never need the literal doc number in-circuit, just a stable numeric
    handle for the nullifier — so a simple stable hash is fine here."""
    import hashlib
    digest = hashlib.sha256(doc_number.encode()).hexdigest()
    # Truncate to stay well under the BN254 scalar field size.
    return int(digest[:32], 16)


def _load_bracket_for_code(nationality_code: int) -> dict:
    if not RESTRICTED_TREE_PATH.exists():
        raise WitnessBuildError(
            f"{RESTRICTED_TREE_PATH} not found — run "
            f"`node scripts/build_restricted_tree.js` first."
        )
    tree = json.loads(RESTRICTED_TREE_PATH.read_text())
    for pair in tree["pairs"]:
        if pair["low"] < nationality_code < pair["high"]:
            return {
                "bracket_low": pair["low"],
                "bracket_high": pair["high"],
                "path_elements": pair["pathElements"],
                "path_indices": pair["pathIndices"],
                "restricted_root": tree["root"],
            }
    # nationality_code matched a restricted code exactly (no open bracket
    # contains it) -> the person is on the restricted list.
    raise WitnessBuildError(
        f"Nationality code {nationality_code} is on the restricted list; "
        f"cannot generate a passing KYC proof."
    )


def build_witness_from_ocr(
    ocr_result: dict,
    doc_max_age_seconds: int = 10 * 365 * 24 * 3600,  # default: 10yr document validity window
    min_age_seconds: int = 568025136,  # ~18 years
) -> dict:
    """
    Takes the dict returned by app.ocr.extract_document_fields(...) and
    produces the full circuit input JSON for kyc.circom, including the
    Merkle bracket for the country-exclusion predicate.

    Raises WitnessBuildError with a user-facing reason if any predicate
    cannot be satisfied or required OCR fields are missing — callers
    should surface this as a KYC rejection, not a 500 error.
    """
    dob_timestamp = _parse_date_to_unix(ocr_result.get("date_of_birth"))
    issue_timestamp = _parse_date_to_unix(ocr_result.get("issue_date"))
    nationality_code = _nationality_to_code(ocr_result.get("nationality"))
    doc_id_numeric = _doc_number_to_numeric(ocr_result.get("doc_number", ""))

    bracket = _load_bracket_for_code(nationality_code)

    current_timestamp = int(time.time())
    user_secret = int(uuid4().int >> 128)  # random 128-bit blinding factor

    witness = {
        # public
        "current_timestamp": current_timestamp,
        "min_age_seconds": min_age_seconds,
        "restricted_root": bracket["restricted_root"],
        "doc_max_age_seconds": doc_max_age_seconds,
        # private
        "dob_timestamp": dob_timestamp,
        "nationality_code": nationality_code,
        "doc_id": doc_id_numeric,
        "doc_issue_timestamp": issue_timestamp,
        "user_secret": user_secret,
        "bracket_low": bracket["bracket_low"],
        "bracket_high": bracket["bracket_high"],
        "path_elements": bracket["path_elements"],
        "path_indices": bracket["path_indices"],
    }

    logger.info(
        f"Witness built | age_ok_check_input={current_timestamp - dob_timestamp}s "
        f"doc_age={current_timestamp - issue_timestamp}s "
        f"nationality_code={nationality_code} bracket=({bracket['bracket_low']},{bracket['bracket_high']})"
    )
    return witness
