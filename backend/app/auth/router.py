from fastapi import APIRouter, Depends, HTTPException, status, Request
from datetime import datetime, timedelta, timezone
import asyncpg

from app.db.database import get_db
from app.auth.jwt import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, hash_token,
    get_current_user,
)
from app.auth.email_service import send_otp_email, verify_otp
from app.models.schemas import (
    RegisterRequest, LoginRequest, OTPVerifyRequest,
    TokenResponse, RefreshRequest, KYCStatus,
)
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["Auth"])


# ─── Register ────────────────────────────────────────────────────────────────

@router.post("/register", status_code=201)
async def register(body: RegisterRequest, db: asyncpg.Connection = Depends(get_db)):
    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    pw_hash = hash_password(body.password)
    user = await db.fetchrow(
        """
        INSERT INTO users (email, password_hash, full_name)
        VALUES ($1, $2, $3)
        RETURNING id, email, kyc_status
        """,
        body.email, pw_hash, body.full_name,
    )

    sent = await send_otp_email(body.email)
    return {
        "user_id": str(user["id"]),
        "message": "Registered. Check your email for the verification code.",
        "otp_sent": sent,
    }


# ─── Verify email OTP ────────────────────────────────────────────────────────

@router.post("/verify-email")
async def verify_email(body: OTPVerifyRequest, db: asyncpg.Connection = Depends(get_db)):
    user = await db.fetchrow("SELECT id, email_verified FROM users WHERE email = $1", body.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["email_verified"]:
        return {"message": "Email already verified"}

    ok = await verify_otp(body.email, body.otp)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    await db.execute(
        """
        UPDATE users
        SET email_verified = TRUE, kyc_status = 'email_verified'
        WHERE email = $1
        """,
        body.email,
    )
    return {"message": "Email verified successfully"}


# ─── Resend OTP ───────────────────────────────────────────────────────────────

@router.post("/resend-otp")
async def resend_otp(email: str, db: asyncpg.Connection = Depends(get_db)):
    user = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    sent = await send_otp_email(email)
    if not sent:
        raise HTTPException(status_code=429, detail="Too many OTP requests. Try again later.")
    return {"message": "OTP resent"}


# ─── Login ───────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: asyncpg.Connection = Depends(get_db)):
    user = await db.fetchrow(
        "SELECT * FROM users WHERE email = $1 AND is_active = TRUE", body.email
    )
    if not user or not verify_password(body.password, user["password_hash"] or ""):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access = create_access_token(
        str(user["id"]),
        extra={
            "wallet_address": user["wallet_address"] or "",
            "is_admin": user["is_admin"],
        },
    )
    refresh = create_refresh_token()
    refresh_hash = hash_token(refresh)

    await db.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        """,
        user["id"],
        refresh_hash,
        datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user_id=str(user["id"]),
        kyc_status=KYCStatus(user["kyc_status"]),
    )


# ─── Refresh token ───────────────────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: asyncpg.Connection = Depends(get_db)):
    token_hash = hash_token(body.refresh_token)
    record = await db.fetchrow(
        """
        SELECT rt.*, u.kyc_status, u.is_active
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1 AND rt.revoked = FALSE AND rt.expires_at > NOW()
        """,
        token_hash,
    )
    if not record or not record["is_active"]:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Rotate token
    await db.execute(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1", token_hash
    )
    new_refresh = create_refresh_token()
    new_hash = hash_token(new_refresh)
    await db.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        """,
        record["user_id"],
        new_hash,
        datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    refreshed_user = await db.fetchrow(
        "SELECT is_admin, wallet_address FROM users WHERE id = $1",
        record["user_id"],
    )
    access = create_access_token(
        str(record["user_id"]),
        extra={
            "wallet_address": refreshed_user["wallet_address"] or "",
            "is_admin": refreshed_user["is_admin"],
        },
    )
    return TokenResponse(
        access_token=access,
        refresh_token=new_refresh,
        user_id=str(record["user_id"]),
        kyc_status=KYCStatus(record["kyc_status"]),
    )


# ─── Logout ──────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(body: RefreshRequest, db: asyncpg.Connection = Depends(get_db)):
    token_hash = hash_token(body.refresh_token)
    await db.execute(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1", token_hash
    )
    return {"message": "Logged out"}


# ─── Me ──────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {
        "id": str(current_user["id"]),
        "email": current_user["email"],
        "wallet_address": current_user["wallet_address"],
        "full_name": current_user["full_name"],
        "kyc_status": current_user["kyc_status"],
        "email_verified": current_user["email_verified"],
        "onchain_verified": current_user["onchain_verified"],
    }