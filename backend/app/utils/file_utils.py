import hashlib
import aiofiles
import magic  # python-magic for MIME sniffing
from pathlib import Path
from uuid import uuid4
from fastapi import UploadFile, HTTPException
from app.core.config import settings
from loguru import logger

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "application/pdf"
}


async def validate_and_save(
    file: UploadFile,
    subfolder: str = "",
) -> dict:
    """
    Validate file type + size, save to disk, return metadata.

    Returns:
        {
            "file_path": str,
            "file_hash": str,
            "mime_type": str,
            "file_size": int,
            "original_name": str,
        }
    """
    contents = await file.read()
    file_size = len(contents)

    # Size check
    if file_size > settings.max_file_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # MIME sniff (don't trust the Content-Type header)
    try:
        mime = magic.from_buffer(contents, mime=True)
    except Exception:
        mime = file.content_type or "application/octet-stream"

    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {mime}. Allowed: JPEG, PNG, PDF",
        )

    # Extension check
    ext = Path(file.filename or "").suffix.lower().lstrip(".")
    if ext not in settings.allowed_extensions_list:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file extension: .{ext}",
        )

    # SHA-256 hash for deduplication / tamper detection
    file_hash = hashlib.sha256(contents).hexdigest()

    # Save to disk
    save_dir = Path(settings.UPLOAD_DIR) / subfolder
    save_dir.mkdir(parents=True, exist_ok=True)

    unique_name = f"{uuid4().hex}.{ext}"
    file_path = save_dir / unique_name

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(contents)

    logger.info(f"File saved: {file_path} | size={file_size} mime={mime}")

    return {
        "file_path": str(file_path),
        "file_hash": file_hash,
        "mime_type": mime,
        "file_size": file_size,
        "original_name": file.filename,
    }


def ensure_upload_dirs():
    for subdir in ["ids", "selfies", "temp"]:
        Path(settings.UPLOAD_DIR, subdir).mkdir(parents=True, exist_ok=True)