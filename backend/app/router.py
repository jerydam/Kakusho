"""
router.py (Stellar version)

Replaces eth_account signature recovery with Stellar's native scheme:
Stellar wallets (Freighter, xBull, etc.) sign arbitrary messages with the
account's ed25519 keypair. We verify with Keypair.verify(), which is a
direct signature check against the known public key — there's no
"recover the signer" step like EVM's ecrecover, because Stellar
addresses ARE ed25519 public keys (encoded as G... strkeys), so the
client must tell us which address it's signing with up front.
"""
from fastapi import APIRouter, Depends, HTTPException
from stellar_sdk import Keypair
from stellar_sdk.exceptions import Ed25519PublicKeyInvalidError, BadSignatureError
import secrets
import asyncpg
import base64

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

router = APIRouter(prefix="/stellar", tags=["Stellar"])


def generate_nonce() -> str:
    return secrets.token_hex(16)


def build_sign_message(address: str, nonce: str) -> str:
    return (
        f"Welcome to KYC Passport!\n\n"
        f"Sign this message to verify your Stellar address.\n\n"
        f"Address: {address}\n"
        f"Nonce: {nonce}\n\n"
        f"This request will not trigger a blockchain transaction or cost any fees."
    )


def verify_stellar_signature(address: str, message: str, signature_b64: str) -> bool:
    """
    `address` is the claimed Stellar G... public key. `signature_b64` is
    the base64-encoded ed25519 signature produced by the wallet over the
    raw message bytes. Unlike EVM, there's no signer recovery — we verify
    the signature directly against the claimed address.
    """
    try:
        kp = Keypair.from_public_key(address)
        signature = base64.b64decode(signature_b64)
        kp.verify(message.encode("utf-8"), signature)
        return True
    except (Ed25519PublicKeyInvalidError, BadSignatureError, ValueError) as e:
        logger.warning(f"Stellar signature verification failed: {e}")
        return False


# ─── Get nonce ───────────────────────────────────────────────────────────────

@router.get("/nonce/{stellar_address}", response_model=NonceResponse)
async def get_wallet_nonce(stellar_address: str):
    # Stellar addresses are case-sensitive (base32 strkey) — do NOT lowercase.
    nonce = generate_nonce()
    await set_nonce(stellar_address, nonce, expire=300)  # 5 min window

    message = build_sign_message(stellar_address, nonce)
    return NonceResponse(nonce=nonce, message=message)


# ─── Wallet login (wallet-only user, creates account if new) ─────────────────

@router.post("/login", response_model=TokenResponse)
async def wallet_login(
    body: WalletLoginRequest,  # now expects `stellar_address` + `signature` (base64) instead of wallet_address/chain_id
    db: asyncpg.Connection = Depends(get_db),
):
    address = body.stellar_address

    stored_nonce = await get_nonce(address)
    if not stored_nonce:
        raise HTTPException(status_code=400, detail="Nonce expired or not requested")

    expected_message = build_sign_message(address, stored_nonce)
    if not verify_stellar_signature(address, expected_message, body.signature):
        raise HTTPException(status_code=401, detail="Signature does not match Stellar address")

    await delete_nonce(address)

    # Upsert user
    user = await db.fetchrow("SELECT * FROM users WHERE stellar_address = $1", address)
    if not user:
        user = await db.fetchrow(
            """
            INSERT INTO users (stellar_address, kyc_status, email_verified)
            VALUES ($1, 'pending', FALSE)
            RETURNING *
            """,
            address,
        )
        logger.info(f"New Stellar wallet user created: {address}")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account suspended")

    access = create_access_token(
        str(user["id"]),
        extra={
            "stellar_address": address,
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

    # Log wallet link — no chain_id concept on Stellar; network is implicit
    # in which Horizon/RPC endpoint the backend is configured against.
    await db.execute(
        """
        INSERT INTO wallet_links (user_id, stellar_address, is_primary)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (user_id, stellar_address) DO NOTHING
        """,
        user["id"], address,
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
    address = body.stellar_address

    existing = await db.fetchrow(
        "SELECT user_id FROM wallet_links WHERE stellar_address = $1", address
    )
    if existing and str(existing["user_id"]) != str(current_user["id"]):
        raise HTTPException(status_code=409, detail="Wallet linked to another account")

    stored_nonce = await get_nonce(address)
    if not stored_nonce:
        raise HTTPException(status_code=400, detail="Nonce expired or not requested")

    expected_message = build_sign_message(address, stored_nonce)
    if not verify_stellar_signature(address, expected_message, body.signature):
        raise HTTPException(status_code=401, detail="Signature mismatch")

    await delete_nonce(address)

    await db.execute(
        """
        INSERT INTO wallet_links (user_id, stellar_address, is_primary)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, stellar_address) DO NOTHING
        """,
        current_user["id"], address,
        not bool(current_user.get("stellar_address")),
    )

    if not current_user.get("stellar_address"):
        await db.execute(
            "UPDATE users SET stellar_address = $1 WHERE id = $2",
            address, current_user["id"],
        )

    return {"message": "Wallet linked successfully", "address": address}


# ─── Get linked wallets ──────────────────────────────────────────────────────

@router.get("/wallets")
async def get_wallets(
    current_user: dict = Depends(get_current_user),
    db: asyncpg.Connection = Depends(get_db),
):
    rows = await db.fetch(
        "SELECT stellar_address, is_primary, linked_at FROM wallet_links WHERE user_id = $1",
        current_user["id"],
    )
    return [dict(r) for r in rows]


# ─── Verify on-chain status ──────────────────────────────────────────────────

@router.get("/onchain-status/{stellar_address}")
async def check_onchain_status(stellar_address: str, db: asyncpg.Connection = Depends(get_db)):
    user = await db.fetchrow(
        "SELECT onchain_verified, sbt_token_id, onchain_tx_hash FROM users WHERE stellar_address = $1",
        stellar_address,
    )
    if not user:
        return {"address": stellar_address, "verified": False}
    return {
        "address": stellar_address,
        "verified": user["onchain_verified"],
        "sbt_token_id": user["sbt_token_id"],
        "tx_hash": user["onchain_tx_hash"],
    }
