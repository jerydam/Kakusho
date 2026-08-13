import re
import cv2
import pytesseract
import numpy as np
from PIL import Image
from typing import Optional
from loguru import logger


# ─── Constants ───────────────────────────────────────────────────────────────

class DocType:
    PASSPORT   = "passport"
    DRIVING    = "driving_license"
    NATIONAL   = "national_id"
    UNKNOWN    = "unknown"


class OCRError(Exception):
    """Raised when OCR cannot extract sufficient information from a document."""
    def __init__(self, message: str, raw: str = ""):
        super().__init__(message)
        self.raw = raw


# Minimum fields required per doc type to consider extraction successful
_MIN_FIELDS: dict[str, int] = {
    DocType.PASSPORT: 3,   # need name + doc_number + at least one date
    DocType.DRIVING:  2,   # name + doc_number
    DocType.NATIONAL: 2,
    DocType.UNKNOWN:  2,
}

_NAME_SKIP = {
    'FEDERAL', 'REPUBLIC', 'NIGERIA', 'NIGERIAN', 'PASSPORT', 'PASSEPORT',
    'PASSAPORTE', 'PASAPORTE', 'ECONOMIC', 'COMMUNITY', 'AFRICAN', 'STATES',
    'NATIONALITY', 'NATIONALE', 'NATIONALITE', 'NATIONAL', 'ECOWAS',
    'DRIVING', 'LICENSE', 'LICENCE', 'DRIVER', 'IDENTITY', 'CARD',
}


# ─── Image pre-processing ────────────────────────────────────────────────────

def _crop_to_data_page(img: np.ndarray) -> np.ndarray:
    """
    For full passport spreads, detect and crop to the data page.
    For single-page docs (driving licence, national ID), returns as-is.
    """
    h, w = img.shape[:2]

    # Only attempt split-page crop for portrait-ish or wide images
    # If aspect ratio is already ~ID card sized, skip
    aspect = w / h
    if aspect < 1.3:
        return img  # already a single page / portrait photo

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

    row_means = np.mean(gray, axis=1)
    row_diff  = np.abs(np.diff(row_means))

    search_start = int(h * 0.30)
    search_end   = int(h * 0.70)
    region_diff  = row_diff[search_start:search_end]
    seam_local   = int(np.argmax(region_diff))
    seam_y       = search_start + seam_local

    if row_diff[seam_y] > 5:
        return img[seam_y:, :]
    return img[int(h * 0.45):, :]


def preprocess_for_ocr(image_path: str) -> tuple[list[np.ndarray], np.ndarray]:
    """
    Returns (versions_list, data_page_bgr).
    """
    img = cv2.imread(image_path)
    if img is None:
        raise OCRError(f"Could not read image file: {image_path}")

    img = _crop_to_data_page(img)
    h, w = img.shape[:2]

    # Deskew
    gray_orig = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    coords = np.column_stack(np.where(gray_orig > 0))
    if len(coords) > 100:
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = 90 + angle
        if abs(angle) > 0.5:
            M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1)
            img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC,
                                  borderMode=cv2.BORDER_REPLICATE)

    # Upscale
    if w < 1400:
        scale = 1400 / w
        img = cv2.resize(img, None, fx=scale, fy=scale,
                         interpolation=cv2.INTER_CUBIC)

    data_page_bgr = img.copy()
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    p2, p98 = np.percentile(gray, 2), np.percentile(gray, 98)
    stretched = (
        np.clip((gray.astype(np.float32) - p2) / (p98 - p2) * 255, 0, 255).astype(np.uint8)
        if p98 > p2 else gray.copy()
    )

    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    v0 = cv2.fastNlMeansDenoising(clahe.apply(stretched), h=8)

    _, v1 = cv2.threshold(v0, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    v2 = cv2.adaptiveThreshold(
        v0, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
    )

    mean_brightness = np.mean(gray)
    gamma = max(0.4, min(2.5, 128.0 / (mean_brightness + 1e-6)))
    table = np.array([min(255, int((i / 255.0) ** (1.0 / gamma) * 255))
                      for i in range(256)], dtype=np.uint8)
    v3 = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(cv2.LUT(gray, table))

    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    v4 = cv2.fastNlMeansDenoising(cv2.filter2D(v0, -1, kernel), h=6)

    v5_pre = cv2.bilateralFilter(stretched, 9, 75, 75)
    _, v5 = cv2.threshold(v5_pre, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return [v0, v1, v2, v3, v4, v5], data_page_bgr


# ─── Document type detection ─────────────────────────────────────────────────

def detect_doc_type(text: str) -> str:
    upper = text.upper()

    passport_signals = [
        'PASSPORT', 'PASSEPORT', 'PASAPORTE', 'PASSAPORTO',
        'P<NGA', 'P<GBR', 'P<USA', 'P<IND', 'P<ZAF', 'P<KEN', 'P<GHA',
        'SURNAME', 'GIVEN NAMES', 'NATIONALITY',
    ]
    driving_signals = [
        'DRIVING', 'DRIVER', 'LICENCE', 'LICENSE',
        'PERMIS DE CONDUIRE', 'CONDUCIR',
        'VEHICLE', 'CLASS', 'ENDORSEMENT',
    ]
    national_signals = [
        'NATIONAL ID', 'IDENTITY CARD', 'CARTE NATIONALE',
        'NATIONAL IDENTITY', 'IDENTIFICATION', 'NIN',
        'VOTER', 'RESIDENT',
    ]

    scores = {
        DocType.PASSPORT: sum(1 for s in passport_signals if s in upper),
        DocType.DRIVING:  sum(1 for s in driving_signals  if s in upper),
        DocType.NATIONAL: sum(1 for s in national_signals if s in upper),
    }

    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return DocType.UNKNOWN

    logger.info(f"Doc type detected: {best} (scores={scores})")
    return best


# ─── Scoring ─────────────────────────────────────────────────────────────────

def _score_text(text: str) -> int:
    score = 0
    for line in text.split('\n'):
        for t in line.strip().split():
            alnum = sum(c.isalnum() for c in t)
            if alnum == 0:
                score -= 2
            elif len(t) == 1:
                score += 0
            elif len(t) <= 3:
                score += alnum
            else:
                score += alnum * 2

    upper = text.upper()
    # Doc type bonuses
    for kw in ['PASSPORT', 'LICENCE', 'LICENSE', 'NATIONAL ID', 'IDENTITY']:
        if kw in upper:
            score += 80
    # MRZ bonuses
    if re.search(r'P<[A-Z]{3}', upper):
        score += 200
    if re.search(r'[A-Z0-9<]{20,}', text.replace(' ', '').upper()):
        score += 100
    if re.search(r'[A-Z]\d{7,9}', upper):
        score += 150
    # Field label bonuses
    for kw in ['SURNAME', 'GIVEN', 'DATE OF BIRTH', 'EXPIRY', 'NATIONALITY',
               'NAME', 'DOB', 'ISSUED', 'ADDRESS']:
        if kw in upper:
            score += 40

    return score


# ─── Raw text extraction ──────────────────────────────────────────────────────

def extract_raw_text(image_path: str) -> tuple[str, np.ndarray]:
    try:
        versions, data_page_bgr = preprocess_for_ocr(image_path)
    except OCRError:
        raise
    except Exception as e:
        raise OCRError(f"Image preprocessing failed: {e}")

    candidates = [
        (0, "--oem 3 --psm 3"),
        (0, "--oem 3 --psm 6"),
        (0, "--oem 3 --psm 11"),
        (1, "--oem 3 --psm 3"),
        (1, "--oem 3 --psm 6"),
        (1, "--oem 3 --psm 11"),
        (2, "--oem 3 --psm 3"),
        (2, "--oem 3 --psm 6"),
        (2, "--oem 3 --psm 11"),
        (3, "--oem 3 --psm 6"),
        (3, "--oem 3 --psm 11"),
        (4, "--oem 3 --psm 6"),
        (4, "--oem 3 --psm 11"),
        (5, "--oem 3 --psm 6"),
        (5, "--oem 3 --psm 11"),
    ]

    best_text  = ""
    best_score = -9999

    for v_idx, config in candidates:
        if v_idx >= len(versions):
            continue
        try:
            text  = pytesseract.image_to_string(Image.fromarray(versions[v_idx]), config=config)
            score = _score_text(text)
            logger.debug(f"OCR v={v_idx} cfg={config!r} score={score}")
            if score > best_score:
                best_score = score
                best_text  = text
        except Exception as e:
            logger.warning(f"OCR attempt failed (v={v_idx}): {e}")

    logger.info(f"OCR final score={best_score} for {image_path}")
    return best_text, data_page_bgr


# ─── MRZ helpers ─────────────────────────────────────────────────────────────

def _fix_numeric(s: str) -> str:
    return s.replace('O', '0').replace('I', '1').replace('S', '5').replace('B', '8')


def _fix_name_ocr(s: str) -> str:
    return s.replace('0', 'O').replace('1', 'I').replace('8', 'B').replace('5', 'S')


def _parse_yymmdd(raw6: str) -> Optional[str]:
    raw6 = _fix_numeric(raw6)
    if not re.match(r'\d{6}', raw6):
        return None
    yy   = int(raw6[0:2])
    yyyy = 1900 + yy if yy > 30 else 2000 + yy
    return f"{raw6[4:6]}/{raw6[2:4]}/{yyyy}"


def _ocr_mrz_strip(data_page_bgr: np.ndarray) -> tuple[str, str]:
    h, w = data_page_bgr.shape[:2]

    # Auto-detect MRZ top boundary via ink density
    gray_full = cv2.cvtColor(data_page_bgr, cv2.COLOR_BGR2GRAY)
    _, bin_full = cv2.threshold(gray_full, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    search_start = int(h * 0.60)
    ink_density  = np.sum(bin_full[search_start:], axis=1) / w
    threshold    = np.max(ink_density) * 0.3
    mrz_rows     = np.where(ink_density > threshold)[0]

    mrz_top = (search_start + mrz_rows[0] - int(h * 0.02)
               if len(mrz_rows) > 10
               else int(h * 0.78))
    mrz_top = max(0, mrz_top)

    mrz_strip = data_page_bgr[mrz_top:, :]
    scale     = max(1.0, 2400 / w)
    mrz_strip = cv2.resize(mrz_strip, None, fx=scale, fy=scale,
                           interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(mrz_strip, cv2.COLOR_BGR2GRAY)
    p2, p98 = np.percentile(gray, 2), np.percentile(gray, 98)
    if p98 > p2:
        gray = np.clip((gray.astype(np.float32) - p2) / (p98 - p2) * 255,
                       0, 255).astype(np.uint8)

    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
    )

    config    = ("--oem 3 --psm 6 "
                 "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")
    best_lines: list[str] = []

    for binary in [otsu, adaptive]:
        raw   = pytesseract.image_to_string(Image.fromarray(binary), config=config)
        lines = [re.sub(r'[^A-Z0-9<]', '', l.upper())
                 for l in raw.split('\n')
                 if len(re.sub(r'[^A-Z0-9<]', '', l.upper())) >= 20]
        if sum(len(l) for l in lines) > sum(len(l) for l in best_lines):
            best_lines = lines

    line1 = next((l for l in best_lines if l.startswith('P') and len(l) >= 20), "")
    line2 = next((l for l in best_lines if not l.startswith('P') and len(l) >= 20), "")
    return line1, line2


def _parse_mrz_lines(line1: str, line2: str) -> dict:
    result = {}
    try:
        if line1.startswith('P') and len(line1) >= 5:
            result['mrz_nationality'] = line1[2:5].replace('<', '')
            parts   = line1[5:].split('<<')
            surname = _fix_name_ocr(parts[0]).replace('<', ' ').strip()
            if surname:
                result['mrz_surname'] = surname
            if len(parts) > 1:
                given = _fix_name_ocr(parts[1]).replace('<', ' ').strip()
                if given:
                    result['mrz_given_names'] = given
    except Exception as e:
        logger.debug(f"MRZ line1 parse error: {e}")

    try:
        if line2 and len(line2) >= 25:
            doc_raw = _fix_numeric(line2[0:9])
            # Leading 8 is almost always a misread B (Nigerian passport)
            if doc_raw[0] == '8':
                doc_raw = 'B' + doc_raw[1:]
            result['mrz_doc_number'] = doc_raw.replace('<', '')

            dob = _parse_yymmdd(line2[13:19])
            if dob:
                result['mrz_dob'] = dob
            exp = _parse_yymmdd(line2[19:25])
            if exp:
                result['mrz_expiry'] = exp
    except Exception as e:
        logger.debug(f"MRZ line2 parse error: {e}")

    return result


def extract_mrz_fields(text: str, data_page_bgr: Optional[np.ndarray] = None) -> dict:
    line1, line2 = "", ""

    # Strategy 1: parse line-by-line from raw text (best when full OCR is clean)
    for raw_line in text.split('\n'):
        cleaned = re.sub(r'[^A-Z0-9<]', '', raw_line.upper())
        if not line1 and cleaned.startswith('P') and len(cleaned) >= 30:
            line1 = cleaned
        elif not line2 and not cleaned.startswith('P') and len(cleaned) >= 30:
            if re.match(r'[A-Z0-9]{9}', cleaned):
                line2 = cleaned
        if line1 and line2:
            break

    # Strategy 2: dedicated strip OCR
    if (not line1 or not line2) and data_page_bgr is not None:
        try:
            s1, s2 = _ocr_mrz_strip(data_page_bgr)
            line1 = line1 or s1
            line2 = line2 or s2
        except Exception as e:
            logger.warning(f"MRZ strip OCR failed: {e}")

    # Strategy 3: collapse + structural regex
    if not line1 or not line2:
        collapsed = re.sub(r'[^A-Z0-9<]', '', text.upper())
        if not line1:
            m = re.search(r'P[<C][A-Z]{3}[A-Z<]{20,43}', collapsed)
            line1 = m.group(0) if m else ""
        if not line2:
            m = re.search(
                r'[A-Z0-9]{9}[0-9][A-Z]{3}[0-9]{6}[0-9][MF<][0-9]{6}[0-9][A-Z0-9<]{14}[0-9]',
                collapsed
            )
            line2 = m.group(0) if m else ""

    result = _parse_mrz_lines(line1, line2)
    logger.info(f"MRZ extracted: {result}")
    return result


# ─── Generic field extractors (all doc types) ────────────────────────────────

def extract_name(text: str) -> Optional[str]:
    patterns = [
        r"(?:Surname|SURNAME|Nom\b|Last\s*Name)[:\s/]+([A-Z][A-Za-z\-\']+)",
        r"(?:Given\s*Names?|GIVEN\s*NAMES?|First\s*Name|Pr[eé]noms?)[:\s/]+([A-Z][A-Za-z\s\-\']+)",
        r"(?:Full\s*Name|FULL\s*NAME)[:\s]+([A-Z][A-Za-z\s\-\']+)",
        r"(?:Name|NAME)[:\s]+([A-Z][A-Za-z\s\-\']{3,})",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            name = re.sub(r'[\d\|\\/]+.*$', '', m.group(1)).strip()
            if name.upper() not in _NAME_SKIP and 2 < len(name) < 80:
                return name

    # Line-by-line: isolated ALL-CAPS surname (5-20 chars) + given names
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    for i, line in enumerate(lines):
        if (re.match(r'^[A-Z]{5,20}$', line)
                and line not in _NAME_SKIP
                and not re.match(r'^[AN]{4,}$', line)):
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                if (re.match(r'^[A-Z]{2,}(?:\s[A-Z]{2,})+$', nxt)
                        and nxt not in _NAME_SKIP):
                    return f"{line} {nxt}"
            return line
    return None


def extract_date_of_birth(text: str) -> Optional[str]:
    patterns = [
        # Bilingual: "31 MAY / MAI 99"
        r"(?:Date\s*of\s*Birth|Date\s*de\s*Naissance|DOB|D\.O\.B)[:\s]*"
        r"(\d{1,2}\s+[A-Z]{3}\s*[/|]\s*[A-Z]{3}\.?\s*\d{2,4})",
        # Labeled date
        r"(?:Date\s*of\s*Birth|DOB|D\.O\.B|Born|Birth\s*Date)[:\s]*"
        r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Date\s*of\s*Birth|DOB)[:\s]*(\d{1,2}\s+\w{3}\s+\d{4})",
        # Bare DD/MM/YYYY (last resort)
        r"\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def extract_document_number(text: str) -> Optional[str]:
    patterns = [
        # Labeled — any doc type
        r"(?:Passport\s*No|Passeport\s*N[o°]|Document\s*No|"
        r"Licence\s*No|License\s*No|ID\s*No|Card\s*No|"
        r"N[o°]\s*Passeport)[:\s\.#]*([A-Z8]\d{7,9})\b",
        # Nigerian passport: letter + 8 digits
        r"\b([A-Z8]\d{8})\b",
        # Generic: letter(s) + 6-9 digits
        r"\b([A-Z]{1,3}\d{6,9})\b",
        # All-digit IDs (national ID, some driving licences)
        r"\b(\d{9,12})\b",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            val = m.group(1).strip().upper()
            if val[0] == '8':
                val = 'B' + val[1:]
            if not re.match(r'^(NGA|NIG|FED|REP)', val):
                return val
    return None


def extract_expiry(text: str) -> Optional[str]:
    patterns = [
        r"(?:Date\s*of\s*Expiry|Date\s*d[\'']?[Ee]xpiration|"
        r"Expiry|Expiration|Valid\s*Until|Expires?|Valid\s*To)[:\s]*"
        r"(\d{1,2}\s+[A-Z]{3}\s*[/|]\s*[A-Z]{3}\.?\s*\d{2,4})",
        r"(?:Date\s*of\s*Expiry|Expiry|Expiration|Valid\s*Until|Expires?)[:\s]*"
        r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Date\s*of\s*Expiry|Expiry|Valid\s*Until)[:\s]*(\d{1,2}\s+\w{3}\s+\d{4})",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def extract_issue_date(text: str) -> Optional[str]:
    patterns = [
        r"(?:Date\s*of\s*Issue|Issue\s*Date|Issued|Date\s*Issued|"
        r"Date\s*de\s*D[eé]livrance|D[eé]livr[eé]\s*le)[:\s]*"
        r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})",
        r"(?:Date\s*of\s*Issue|Issue\s*Date|Issued)[:\s]*(\d{1,2}\s+\w{3}\s+\d{4})",
        r"(?:Date\s*of\s*Issue|Issue\s*Date)[:\s]*"
        r"(\d{1,2}\s+[A-Z]{3}\s*[/|]\s*[A-Z]{3}\.?\s*\d{2,4})",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def extract_nationality(text: str) -> Optional[str]:
    m = re.search(
        r"(?:Nationality|NATIONALITY|Nationalit[eé])[:\s/]+([A-Z][A-Za-z]+)",
        text
    )
    if m:
        val = m.group(1).strip()
        if val.upper() not in {'NATIONALITY', 'NATIONALE', 'NATIONALITE'}:
            return val
    return None


def extract_address(text: str) -> Optional[str]:
    """Extract address — relevant for driving licences and national IDs."""
    m = re.search(
        r"(?:Address|ADDR|Residence|Domicile)[:\s]+([A-Za-z0-9\s\,\.\-\/]+)",
        text, re.IGNORECASE
    )
    if m:
        addr = m.group(1).strip()
        # Cap at 120 chars, stop at next label
        addr = re.split(r'\n|(?=[A-Z][a-z]+:)', addr)[0].strip()
        if 5 < len(addr) < 120:
            return addr
    return None


def extract_sex(text: str) -> Optional[str]:
    m = re.search(r"(?:Sex|Gender|Sexe)[:\s/]+([MF]|Male|Female|M\b|F\b)", text, re.IGNORECASE)
    if m:
        val = m.group(1).strip().upper()
        return 'M' if val.startswith('M') else 'F'
    return None


def extract_issuing_authority(text: str) -> Optional[str]:
    m = re.search(
        r"(?:Authority|Autorit[eé]|Issued\s*By|Issuing\s*Authority)[:\s]+([A-Za-z\s]+)",
        text, re.IGNORECASE
    )
    if m:
        val = m.group(1).strip()
        val = re.split(r'\n', val)[0].strip()
        if 2 < len(val) < 60:
            return val
    return None


# ─── Main OCR function ────────────────────────────────────────────────────────

def run_ocr(image_path: str) -> dict:
    """
    Full OCR pipeline. Raises OCRError if extraction quality is too low.
    """
    try:
        raw, data_page_bgr = extract_raw_text(image_path)
    except OCRError:
        raise
    except Exception as e:
        raise OCRError(f"Failed to process image: {e}")

    if not raw.strip():
        raise OCRError(
            "No text could be extracted from this document. "
            "Please upload a clearer image.",
            raw=""
        )

    doc_type = detect_doc_type(raw)
    logger.info(f"Document type: {doc_type}")

    # ── Extract MRZ (passport only, skip for other docs) ─────────────────
    mrz: dict = {}
    if doc_type in (DocType.PASSPORT, DocType.UNKNOWN):
        mrz = extract_mrz_fields(raw, data_page_bgr=data_page_bgr)

    # ── Name ─────────────────────────────────────────────────────────────
    if mrz.get('mrz_surname'):
        surname = mrz.get('mrz_surname', '')
        given   = mrz.get('mrz_given_names', '')
        name    = f"{surname} {given}".strip()
    else:
        name = extract_name(raw)

    # ── All fields ────────────────────────────────────────────────────────
    dob         = extract_date_of_birth(raw)    or mrz.get('mrz_dob')
    doc_number  = extract_document_number(raw)  or mrz.get('mrz_doc_number')
    expiry      = extract_expiry(raw)           or mrz.get('mrz_expiry')
    issue_date  = extract_issue_date(raw)
    nationality = extract_nationality(raw)      or mrz.get('mrz_nationality')
    address     = extract_address(raw)          if doc_type != DocType.PASSPORT else None
    sex         = extract_sex(raw)
    authority   = extract_issuing_authority(raw)

    # ── Quality gate ──────────────────────────────────────────────────────
    core_fields = [name, dob, doc_number]
    extracted   = sum(1 for f in core_fields if f)
    min_required = _MIN_FIELDS.get(doc_type, 2)

    all_fields = [name, dob, doc_number, expiry, nationality]
    confidence = round(sum(1 for f in all_fields if f) / len(all_fields), 2)

    if extracted < min_required:
        missing = []
        if not name:       missing.append("name")
        if not doc_number: missing.append("document number")
        if not dob:        missing.append("date of birth")
        raise OCRError(
            f"Could not extract sufficient information from this document "
            f"(missing: {', '.join(missing)}). "
            f"Please ensure the image is well-lit, in focus, and the document "
            f"is fully visible.",
            raw=raw
        )

    logger.info(
        f"OCR complete | type={doc_type} name={name} dob={dob} "
        f"docno={doc_number} expiry={expiry} confidence={confidence}"
    )

    return {
        "doc_type":      doc_type,
        "name":          name,
        "date_of_birth": dob,
        "doc_number":    doc_number,
        "expiry":        expiry,
        "issue_date":    issue_date,
        "nationality":   nationality,
        "sex":           sex,
        "address":       address,
        "authority":     authority,
        "confidence":    confidence,
        "mrz":           mrz,
        "raw":           raw,
    }