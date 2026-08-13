from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from typing import Optional
from uuid import UUID
import asyncpg
import asyncio
from loguru import logger
import json
from app.kyc.ocr import run_ocr, OCRError
from app import db
from app.db.database import get_db
from app.auth.jwt import get_current_user, get_current_verified_user, get_admin_user
from app.kyc.face import compare_faces, check_document_quality, liveness_check_multi
from app.utils.file_utils import validate_and_save
from app.web3.contract import mark_verified_onchain, mint_sbt
from app.auth.email_service import send_kyc_approved_email, send_kyc_rejected_email
from app.models.schemas import (
    DocType,
    KYCStatus,
    KYCStatusResponse,
    DocumentUploadResponse,
    FaceVerificationResponse,
    KYCApproveRequest,
    KYCRejectRequest,
    OnchainVerifyResponse,
    SBTMintResponse,
)

router = APIRouter(prefix="/kyc", tags=["KYC"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def build_steps_completed(user: dict) -> list[str]:
    steps = []
    # Email step removed completely
    if user["kyc_status"] in ("id_submitted", "processing", "verified"):
        steps.append("id_submitted")
    if user["kyc_status"] in ("processing", "verified"):
        steps.append("face_verified")
    if user["kyc_status"] == "verified":
        steps.append("approved")
    return steps

# In next_step_for — skip email step:
def next_step_for(user: dict) -> Optional[str]:
    status = user["kyc_status"]
    if status in ("pending", "email_verified"):  # treat both as same
        return "upload_id"
    if status == "id_submitted":
        return "upload_selfie_for_face_check"
    if status == "processing":
        return "awaiting_review"
    if status == "verified":
        return None
    if status == "rejected":
        return "resubmit_documents"
    return None


# ─── KYC Status ──────────────────────────────────────────────────────────────

@router.get("/status", response_model=KYCStatusResponse)
async def get_kyc_status(
    current_user: dict = Depends(get_current_user),
):
    return KYCStatusResponse(
        user_id=current_user["id"],
        kyc_status=KYCStatus(current_user["kyc_status"]),
        email_verified=current_user["email_verified"],
        onchain_verified=current_user["onchain_verified"],
        steps_completed=build_steps_completed(current_user),
        next_step=next_step_for(current_user),
        rejection_reason=current_user.get("rejection_reason"),
    )


# ─── Upload ID document ───────────────────────────────────────────────────────


@router.post("/upload-id", response_model=DocumentUploadResponse)
async def upload_id_document(
    file: UploadFile = File(...),
    doc_type: DocType = Form(...),
    side: str = Form(..., pattern="^(front|back)$"),
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
):
    if current_user["kyc_status"] == "verified":
        raise HTTPException(status_code=409, detail="Already verified")

    meta = await validate_and_save(file, subfolder="ids")

    loop = asyncio.get_event_loop()
    quality = await loop.run_in_executor(None, check_document_quality, meta["file_path"])

    # ── OCR with typed error handling ─────────────────────────────────────
    try:
        ocr_result = await loop.run_in_executor(None, run_ocr, meta["file_path"])
    except OCRError as e:
        logger.warning(f"OCR failed for user={current_user['id']} file={meta['file_path']}: {e}")
        raise HTTPException(
            status_code=422,
            detail={
                "error": "document_unreadable",
                "message": str(e),
                "hint": (
                    "Please ensure your document is:\n"
                    "• Fully visible and not cut off\n"
                    "• Well-lit with no glare or shadows\n"
                    "• In focus and not blurry\n"
                    "• The correct side (front/back as required)"
                ),
            },
        )
    except Exception as e:
        logger.error(f"Unexpected OCR error: {e}")
        raise HTTPException(status_code=500, detail="Document processing failed. Please try again.")

    # ── Persist document ──────────────────────────────────────────────────
    doc = await db.fetchrow(
        """
        INSERT INTO kyc_documents (
            user_id, doc_type, side, file_path, file_hash, mime_type, file_size,
            ocr_raw, ocr_name, ocr_dob, ocr_doc_number, ocr_expiry, ocr_nationality,
            ocr_confidence, ocr_doc_type, ocr_issue_date, ocr_sex, ocr_address, ocr_authority,
            is_blurry, quality_score
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING id
        """,
        current_user["id"],
        doc_type.value,
        side,
        meta["file_path"],
        meta["file_hash"],
        meta["mime_type"],
        meta["file_size"],
        json.dumps(ocr_result),
        ocr_result.get("name"),
        ocr_result.get("date_of_birth"),
        ocr_result.get("doc_number"),
        ocr_result.get("expiry"),
        ocr_result.get("nationality"),
        ocr_result.get("confidence"),
        ocr_result.get("doc_type"),          # detected doc type
        ocr_result.get("issue_date"),        # new
        ocr_result.get("sex"),               # new
        ocr_result.get("address"),           # new
        ocr_result.get("authority"),         # new
        quality["is_blurry"],
        quality["quality_score"],
    )

    # ── Auto-fill user profile from OCR ───────────────────────────────────
    profile_updates = {}
    if ocr_result.get("name") and not current_user.get("full_name"):
        profile_updates["full_name"] = ocr_result["name"]
    if ocr_result.get("nationality") and not current_user.get("nationality"):
        profile_updates["nationality"] = ocr_result["nationality"]
    if ocr_result.get("date_of_birth") and not current_user.get("date_of_birth"):
        profile_updates["date_of_birth"] = ocr_result["date_of_birth"]

    if profile_updates:
        set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(profile_updates))
        await db.execute(
            f"UPDATE users SET {set_clause} WHERE id = $1",
            current_user["id"],
            *profile_updates.values(),
        )

    # ── Advance KYC status ────────────────────────────────────────────────
    if current_user["kyc_status"] in ("email_verified", "pending", "rejected"):
        await db.execute(
            "UPDATE users SET kyc_status = 'id_submitted' WHERE id = $1",
            current_user["id"],
        )

    # ── Session log ───────────────────────────────────────────────────────
    await db.execute(
        """
        INSERT INTO kyc_sessions (user_id, step, status, metadata)
        VALUES ($1, 'id_upload', 'completed', $2)
        """,
        current_user["id"],
        json.dumps({
            "doc_type":      doc_type.value,
            "ocr_doc_type":  ocr_result.get("doc_type"),
            "side":          side,
            "quality":       quality["quality_score"],
            "ocr_confidence": ocr_result.get("confidence"),
        }),
    )

    message = "Document uploaded and verified successfully."
    if quality["is_blurry"]:
        message += " Warning: image appears blurry — consider re-uploading a clearer photo."

    return DocumentUploadResponse(
        document_id=doc["id"],
        doc_type=doc_type,
        side=side,
        quality_score=quality["quality_score"],
        is_blurry=quality["is_blurry"],
        ocr_name=ocr_result.get("name"),
        ocr_dob=ocr_result.get("date_of_birth"),
        ocr_doc_number=ocr_result.get("doc_number"),
        message=message,
    )

# ─── Upload selfie + run face verification ────────────────────────────────────

@router.post("/verify-face", response_model=FaceVerificationResponse)
async def verify_face(
    selfies: list[UploadFile] = File(...),   # ← 4 files now
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
):
    if current_user["kyc_status"] not in (
        "id_submitted", "rejected", "pending", "processing"
    ):
        raise HTTPException(
            status_code=400,
            detail="Upload your ID document before submitting a selfie",
        )

    if len(selfies) < 4:
        raise HTTPException(
            status_code=400,
            detail="4 selfie images required: left, right, up, down",
        )

    id_doc = await db.fetchrow(
        """
        SELECT file_path, id FROM kyc_documents
        WHERE user_id = $1 AND side = 'front'
        ORDER BY created_at DESC LIMIT 1
        """,
        current_user["id"],
    )
    if not id_doc:
        raise HTTPException(status_code=400, detail="No ID front document found")

    # Save all 4 selfies
    saved_paths = []
    selfie_doc_id = None
    for i, selfie_file in enumerate(selfies):
        meta = await validate_and_save(selfie_file, subfolder="selfies")
        saved_paths.append(meta["file_path"])
        # Store each as a selfie document; keep the first id for FK ref
        doc = await db.fetchrow(
            """
            INSERT INTO kyc_documents (
                user_id, doc_type, side, file_path, file_hash, mime_type, file_size
            ) VALUES ($1, 'national_id', 'selfie', $2, $3, $4, $5)
            RETURNING id
            """,
            current_user["id"],
            meta["file_path"],
            meta["file_hash"],
            meta["mime_type"],
            meta["file_size"],
        )
        if i == 0:
            selfie_doc_id = doc["id"]

    # Run liveness check across all 4 poses
    loop = asyncio.get_event_loop()
    liveness_passed, liveness_score, detected_poses = await loop.run_in_executor(
        None, liveness_check_multi, saved_paths
    )

    # Run face match against ID (uses first/forward selfie)
    result = await loop.run_in_executor(
        None, compare_faces, id_doc["file_path"], saved_paths[0]
    )

    # Override liveness fields with real results
    result["liveness_passed"] = liveness_passed
    result["liveness_score"] = liveness_score

    verif = await db.fetchrow(
        """
        INSERT INTO face_verifications (
            user_id, selfie_doc_id, id_doc_id,
            match_result, match_distance, match_confidence,
            liveness_score, liveness_passed, error_message
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
        """,
        current_user["id"],
        selfie_doc_id,
        id_doc["id"],
        result["match"],
        result["distance"],
        result["confidence"],
        liveness_score,
        liveness_passed,
        result.get("error"),
    )

    if result["match"] and liveness_passed:
        await db.execute(
            "UPDATE users SET kyc_status = 'processing' WHERE id = $1",
            current_user["id"],
        )
        step_status = "completed"
        message = "Face verified. Your application is under review."
    else:
        step_status = "failed"
        missing = sorted({"left", "right", "up", "down"} - set(detected_poses))
        message = (
            result.get("error")
            or f"Liveness failed. Missing poses: {', '.join(missing)}. Please retake."
        )

    # verify_face session log — fix this too
    await db.execute(
        """
        INSERT INTO kyc_sessions (user_id, step, status, metadata)
        VALUES ($1, 'face_check', $2, $3)
        """,
        current_user["id"],
        step_status,
        {**result, "detected_poses": detected_poses},  # ← was json.dumps(...)
    )

    return FaceVerificationResponse(
        verification_id=verif["id"],
        match_result=result["match"],
        match_confidence=result["confidence"],
        liveness_passed=liveness_passed,
        message=message,
    )

# ─── Admin: list pending applications ────────────────────────────────────────

@router.get("/admin/pending")
async def list_pending(
    limit: int = 20,
    offset: int = 0,
    status: str = "processing",
    admin: dict = Depends(get_admin_user),
    db: asyncpg.Connection = Depends(get_db),
):
    allowed = ("processing", "verified", "rejected", "id_submitted")
    if status not in allowed:
        status = "processing"

    rows = await db.fetch(
        """
        SELECT 
            u.id, u.email, u.wallet_address, u.full_name, 
            u.kyc_status, u.created_at, u.updated_at,
            -- most recent ID doc
            d_id.file_path   AS doc_file_path,
            d_id.doc_type    AS doc_type,
            -- most recent selfie
            d_s.file_path    AS selfie_file_path
        FROM users u
        LEFT JOIN LATERAL (
            SELECT file_path, doc_type FROM kyc_documents
            WHERE user_id = u.id AND side = 'front'
            ORDER BY created_at DESC LIMIT 1
        ) d_id ON TRUE
        LEFT JOIN LATERAL (
            SELECT file_path FROM kyc_documents
            WHERE user_id = u.id AND side = 'selfie'
            ORDER BY created_at DESC LIMIT 1
        ) d_s ON TRUE
        WHERE u.kyc_status = $1
        ORDER BY u.updated_at ASC
        LIMIT $2 OFFSET $3
        """,
        status, limit, offset,
    )

    total = await db.fetchval(
        "SELECT COUNT(*) FROM users WHERE kyc_status = $1", status
    )

    return {
    "rows": [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "wallet_address": r["wallet_address"],
            "full_name": r["full_name"],
            "kyc_status": r["kyc_status"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
            "doc_file_path": r["doc_file_path"],      # ← explicit
            "doc_type": r["doc_type"],                 # ← explicit
            "selfie_file_path": r["selfie_file_path"], # ← explicit
        }
        for r in rows
    ],
    "total": total,
}
# ─── Admin: view applicant detail ────────────────────────────────────────────

@router.get("/admin/applicant/{user_id}")
async def get_applicant_detail(
    user_id: UUID,
    admin: dict = Depends(get_admin_user),
    db: asyncpg.Connection = Depends(get_db),
):
    user = await db.fetchrow("SELECT * FROM users WHERE id = $1", str(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    docs = await db.fetch(
        "SELECT id, doc_type, side, ocr_name, ocr_dob, ocr_doc_number, quality_score, is_blurry, created_at FROM kyc_documents WHERE user_id = $1 ORDER BY created_at",
        str(user_id),
    )
    verifs = await db.fetch(
        "SELECT match_result, match_confidence, liveness_passed, liveness_score, error_message, created_at FROM face_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5",
        str(user_id),
    )

    return {
        "user": dict(user),
        "documents": [dict(d) for d in docs],
        "face_verifications": [dict(v) for v in verifs],
    }


# ─── Admin: approve ──────────────────────────────────────────────────────────

@router.post("/admin/approve", response_model=OnchainVerifyResponse)
async def approve_kyc(
    body: KYCApproveRequest,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(get_admin_user),
    db: asyncpg.Connection = Depends(get_db),
):
    user = await db.fetchrow(
        "SELECT * FROM users WHERE id = $1 AND kyc_status = 'processing'",
        str(body.user_id),
    )
    if not user:
        raise HTTPException(status_code=404, detail="Applicant not found or not in processing state")

    wallet = user["wallet_address"]

    # Mark verified in DB immediately
    await db.execute(
        """
        UPDATE users
        SET kyc_status = 'verified', verified_at = NOW()
        WHERE id = $1
        """,
        str(body.user_id),
    )

    await db.execute(
        "INSERT INTO kyc_sessions (user_id, step, status) VALUES ($1, 'approved', 'completed')",
        str(body.user_id),
    )

    tx_hash = None
    onchain_verified = False

    # On-chain verification (if wallet linked)
    if wallet:
        tx_hash = await mark_verified_onchain(wallet)
        if tx_hash:
            onchain_verified = True
            await db.execute(
                """
                UPDATE users
                SET onchain_verified = TRUE, onchain_tx_hash = $1
                WHERE id = $2
                """,
                tx_hash, str(body.user_id),
            )
            await db.execute(
                """
                INSERT INTO onchain_events (user_id, wallet_address, event_type, tx_hash, chain_id)
                VALUES ($1, $2, 'verified', $3, $4)
                """,
                str(body.user_id), wallet, tx_hash, 8453,
            )

    # Send approval email in background
    if user["email"]:
        background_tasks.add_task(
            send_kyc_approved_email,
            user["email"],
            user["full_name"] or "there",
        )

    return OnchainVerifyResponse(
        tx_hash=tx_hash or "0x0",
        wallet_address=wallet or "",
        chain_id=8453,
        verified=True,
        message="KYC approved." + (" On-chain verification recorded." if onchain_verified else " No wallet linked — skipped on-chain step."),
    )


# ─── Admin: reject ───────────────────────────────────────────────────────────

@router.post("/admin/reject")
async def reject_kyc(
    body: KYCRejectRequest,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(get_admin_user),
    db: asyncpg.Connection = Depends(get_db),
):
    user = await db.fetchrow(
        "SELECT * FROM users WHERE id = $1 AND kyc_status IN ('processing', 'id_submitted')",
        str(body.user_id),
    )
    if not user:
        raise HTTPException(status_code=404, detail="Applicant not found or not rejectable")

    await db.execute(
        """
        UPDATE users
        SET kyc_status = 'rejected', rejected_at = NOW(), rejection_reason = $1
        WHERE id = $2
        """,
        body.reason, str(body.user_id),
    )

    await db.execute(
        """
        INSERT INTO kyc_sessions (user_id, step, status, metadata)
        VALUES ($1, 'rejected', 'completed', $2)
        """,
        str(body.user_id),
        json.dumps({"reason": body.reason}),
    )

    if user["email"]:
        background_tasks.add_task(
            send_kyc_rejected_email,
            user["email"],
            user["full_name"] or "there",
            body.reason,
        )

    return {"message": "Application rejected", "user_id": str(body.user_id), "reason": body.reason}


# ─── Mint SBT (after approval) ───────────────────────────────────────────────

@router.post("/mint-sbt", response_model=SBTMintResponse)
async def mint_soulbound_token(
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
):
    if current_user["kyc_status"] != "verified":
        raise HTTPException(status_code=403, detail="KYC must be verified before minting SBT")

    if current_user["sbt_token_id"]:
        raise HTTPException(status_code=409, detail="SBT already minted")

    wallet = current_user["wallet_address"]
    if not wallet:
        raise HTTPException(status_code=400, detail="No wallet address linked to this account")

    result = await mint_sbt(wallet)
    if not result:
        raise HTTPException(status_code=500, detail="SBT mint failed — check contract configuration")

    await db.execute(
        """
        UPDATE users SET sbt_token_id = $1 WHERE id = $2
        """,
        result["token_id"], current_user["id"],
    )

    await db.execute(
        """
        INSERT INTO onchain_events (user_id, wallet_address, event_type, tx_hash, chain_id)
        VALUES ($1, $2, 'sbt_minted', $3, $4)
        """,
        current_user["id"], wallet, result["tx_hash"], 8453,
    )

    return SBTMintResponse(
        tx_hash=result["tx_hash"],
        token_id=result["token_id"],
        wallet_address=wallet,
        message="Soulbound token minted successfully",
    )


# ─── Public: check any wallet's verification status ──────────────────────────

@router.get("/check/{wallet_address}")
async def public_check(wallet_address: str, db: asyncpg.Connection = Depends(get_db)):
    """Public endpoint — no auth required. Used by dApps to gate access."""
    wallet = wallet_address.lower()
    user = await db.fetchrow(
        """
        SELECT kyc_status, onchain_verified, sbt_token_id
        FROM users WHERE wallet_address = $1
        """,
        wallet,
    )
    if not user:
        return {"wallet": wallet, "verified": False, "onchain_verified": False}

    return {
        "wallet": wallet,
        "verified": user["kyc_status"] == "verified",
        "onchain_verified": user["onchain_verified"],
        "has_sbt": bool(user["sbt_token_id"]),
    }