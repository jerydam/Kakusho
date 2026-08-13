from fastapi import APIRouter, Depends, HTTPException
from eth_account.messages import encode_defunct
from eth_account import Account
import secrets
import asyncpg

from app.db.database import get_db
from app.db.redis_client import set_nonce, get_nonce, delete_nonce
from app.auth.jwt import create_access_token, create_refresh_token, hash_token, get_current_user
from app.models.schemas import (
    NonceResponse, WalletLoginRequest, LinkWalletRequest,
    TokenResponse, KYCStatus,
)
from app.core.config import settings
from datetime import datetime, timedelta, timezone
from loguru import logger

router = APIRouter(prefix="/web3", tags=["Web3"])


def generate_nonce() -> str:
    return secrets.token_hex(16)


def build_sign_message(wallet: str, nonce: str) -> str:
    return (
        f"Welcome to KYC Passport!\n\n"
        f"Sign this message to verify your wallet.\n\n"
        f"Wallet: {wallet}\n"
        f"Nonce: {nonce}\n\n"
        f"This request will not trigger a blockchain transaction or cost any gas."
    )


def recover_address(message: str, signature: str) -> str:
    msg_hash = encode_defunct(text=message)
    return Account.recover_message(msg_hash, signature=signature).lower()


# ─── Get nonce ───────────────────────────────────────────────────────────────

@router.get("/nonce/{wallet_address}", response_model=NonceResponse)
async def get_wallet_nonce(wallet_address: str):
    wallet = wallet_address.lower()
    nonce = generate_nonce()
    await set_nonce(wallet, nonce, expire=300)  # 5 min window

    message = build_sign_message(wallet, nonce)
    return NonceResponse(nonce=nonce, message=message)


# ─── Wallet login (wallet-only user, creates account if new) ─────────────────

@router.post("/login", response_model=TokenResponse)
async def wallet_login(
    body: WalletLoginRequest,
    db: asyncpg.Connection = Depends(get_db),
):
    wallet = body.wallet_address.lower()

    # Verify nonce exists
    stored_nonce = await get_nonce(wallet)
    if not stored_nonce:
        raise HTTPException(status_code=400, detail="Nonce expired or not requested")

    # Reconstruct message and recover signer
    expected_message = build_sign_message(wallet, stored_nonce)
    try:
        recovered = recover_address(expected_message, body.signature)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")

    if recovered != wallet:
        raise HTTPException(status_code=401, detail="Signature does not match wallet address")

    await delete_nonce(wallet)

    # Upsert user
    user = await db.fetchrow("SELECT * FROM users WHERE wallet_address = $1", wallet)
    if not user:
        user = await db.fetchrow(
            """
            INSERT INTO users (wallet_address, kyc_status, email_verified)
            VALUES ($1, 'pending', FALSE)
            RETURNING *
            """,
            wallet,
        )
        logger.info(f"New wallet user created: {wallet}")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account suspended")

    access = create_access_token(
        str(user["id"]),
        extra={
            "wallet_address": wallet,
            "is_admin": user["is_admin"],
        },
    )
    refresh = create_refresh_token()
    await db.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        """,
        user["id"],
        hash_token(refresh),
        datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    # Log wallet link
    await db.execute(
        """
        INSERT INTO wallet_links (user_id, wallet_address, chain_id, is_primary)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (user_id, wallet_address) DO NOTHING
        """,
        user["id"], wallet, body.chain_id,
    )

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user_id=str(user["id"]),
        kyc_status=KYCStatus(user["kyc_status"]),
        is_admin=bool(user["is_admin"]),
    )


# ─── Link wallet to existing email account ───────────────────────────────────

@router.post("/link-wallet")
async def link_wallet(
    body: LinkWalletRequest,
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
):
    wallet = body.wallet_address.lower()

    # Check wallet not already linked to another account
    existing = await db.fetchrow(
        "SELECT user_id FROM wallet_links WHERE wallet_address = $1", wallet
    )
    if existing and str(existing["user_id"]) != str(current_user["id"]):
        raise HTTPException(status_code=409, detail="Wallet linked to another account")

    stored_nonce = await get_nonce(wallet)
    if not stored_nonce:
        raise HTTPException(status_code=400, detail="Nonce expired or not requested")

    expected_message = build_sign_message(wallet, stored_nonce)
    try:
        recovered = recover_address(expected_message, body.signature)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature")

    if recovered != wallet:
        raise HTTPException(status_code=401, detail="Signature mismatch")

    await delete_nonce(wallet)

    # Link wallet
    await db.execute(
        """
        INSERT INTO wallet_links (user_id, wallet_address, chain_id, is_primary)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, wallet_address) DO NOTHING
        """,
        current_user["id"], wallet, body.chain_id,
        not bool(current_user.get("wallet_address")),  # primary if first
    )

    # Set as primary wallet on user record if none set
    if not current_user.get("wallet_address"):
        await db.execute(
            "UPDATE users SET wallet_address = $1 WHERE id = $2",
            wallet, current_user["id"],
        )

    return {"message": "Wallet linked successfully", "wallet": wallet}


# ─── Get linked wallets ──────────────────────────────────────────────────────

@router.get("/wallets")
async def get_wallets(
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        "SELECT wallet_address, chain_id, is_primary, linked_at FROM wallet_links WHERE user_id = $1",
        current_user["id"],
    )
    return [dict(r) for r in rows]


# ─── Verify on-chain status ──────────────────────────────────────────────────

@router.get("/onchain-status/{wallet_address}")
async def check_onchain_status(wallet_address: str, db: asyncpg.Connection = Depends(get_db)):
    wallet = wallet_address.lower()
    user = await db.fetchrow(
        "SELECT onchain_verified, sbt_token_id, onchain_tx_hash FROM users WHERE wallet_address = $1",
        wallet,
    )
    if not user:
        return {"wallet": wallet, "verified": False}
    return {
        "wallet": wallet,
        "verified": user["onchain_verified"],
        "sbt_token_id": user["sbt_token_id"],
        "tx_hash": user["onchain_tx_hash"],
    }