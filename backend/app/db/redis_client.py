import redis.asyncio as aioredis
from app.core.config import settings
from loguru import logger
from typing import Optional

_redis: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
        logger.info("Redis connected")
    return _redis


async def close_redis():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None


# ─── OTP helpers ────────────────────────────────────────────────────────────

async def set_otp(key: str, otp: str, expire: int = None) -> None:
    redis = await get_redis()
    ttl = expire or settings.OTP_EXPIRE_SECONDS
    await redis.setex(f"otp:{key}", ttl, otp)


async def get_otp(key: str) -> Optional[str]:
    redis = await get_redis()
    return await redis.get(f"otp:{key}")


async def delete_otp(key: str) -> None:
    redis = await get_redis()
    await redis.delete(f"otp:{key}")


# ─── Rate limiting helpers ───────────────────────────────────────────────────

async def increment_attempts(key: str, window: int = 3600) -> int:
    redis = await get_redis()
    pipe = redis.pipeline()
    pipe.incr(f"attempts:{key}")
    pipe.expire(f"attempts:{key}", window)
    results = await pipe.execute()
    return results[0]


async def get_attempts(key: str) -> int:
    redis = await get_redis()
    val = await redis.get(f"attempts:{key}")
    return int(val) if val else 0


async def reset_attempts(key: str) -> None:
    redis = await get_redis()
    await redis.delete(f"attempts:{key}")


# ─── Nonce store (Web3 signature replay protection) ─────────────────────────

async def set_nonce(wallet: str, nonce: str, expire: int = 300) -> None:
    redis = await get_redis()
    await redis.setex(f"nonce:{wallet.lower()}", expire, nonce)


async def get_nonce(wallet: str) -> Optional[str]:
    redis = await get_redis()
    return await redis.get(f"nonce:{wallet.lower()}")


async def delete_nonce(wallet: str) -> None:
    redis = await get_redis()
    await redis.delete(f"nonce:{wallet.lower()}")