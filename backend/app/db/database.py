from supabase import create_client, Client
from app.core.config import settings
from loguru import logger
import asyncpg
import json
from typing import Optional

# Supabase client (for auth helpers + storage)
supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_KEY
)

_pool: Optional[asyncpg.Pool] = None


async def _init_connection(conn: asyncpg.Connection):
    """Register codecs so Python dicts pass to JSONB columns directly."""
    await conn.set_type_codec(
        'jsonb',
        encoder=json.dumps,
        decoder=json.loads,
        schema='pg_catalog',
    )
    await conn.set_type_codec(
        'json',
        encoder=json.dumps,
        decoder=json.loads,
        schema='pg_catalog',
    )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.DATABASE_URL,
            min_size=2,
            max_size=10,
            command_timeout=60,
            statement_cache_size=0,
            max_inactive_connection_lifetime=300,
            init=_init_connection,       # ← registers JSONB codec on every connection
        )
        logger.info("Database pool created")
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Database pool closed")


async def get_db():
    pool = await get_pool()
    conn = await pool.acquire()
    try:
        await conn.execute("SELECT 1")
        yield conn
    except (asyncpg.ConnectionDoesNotExistError, asyncpg.TooManyConnectionsError):
        await pool.release(conn, discard=True)
        conn = await pool.acquire()
        await _init_connection(conn)     # ← re-register on fresh connection
        yield conn
    finally:
        await pool.release(conn)