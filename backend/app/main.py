from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager
from loguru import logger
import sys

from app.core.config import settings
from app.db.database import get_pool, close_pool
from app.db.redis_client import get_redis, close_redis
from app.utils.file_utils import ensure_upload_dirs

# ─── Routers ─────────────────────────────────────────────────────────────────
from app.auth.router import router as auth_router
from app.kyc.router import router as kyc_router
from app.web3.router import router as web3_router


# ─── Logging setup ───────────────────────────────────────────────────────────
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="DEBUG" if settings.APP_ENV == "development" else "INFO",
)


# ─── Lifespan ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} [{settings.APP_ENV}]")
    ensure_upload_dirs()
    await get_pool()
    await get_redis()
    logger.info("All services connected")
    yield
    await close_pool()
    await close_redis()
    logger.info("Shutdown complete")


# ─── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="KYC Passport API",
    description="Hybrid KYC + Web3 identity verification system",
    version="1.0.0",
    docs_url="/docs" if settings.APP_ENV == "development" else None,
    redoc_url="/redoc" if settings.APP_ENV == "development" else None,
    lifespan=lifespan,
)


ALLOWED_ORIGINS = (
    ["*"]
    if settings.APP_ENV == "development"
    else [
        settings.FRONTEND_URL,               # e.g. https://yourdomain.com
        "https://yourdomain.com",
    ]
)
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

if settings.APP_ENV == "production":
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["yourdomain.com", "*.yourdomain.com"])


# ─── Rate limiting ────────────────────────────────────────────────────────────
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ─── Routers ──────────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api/v1")
app.include_router(kyc_router,  prefix="/api/v1")
app.include_router(web3_router, prefix="/api/v1")


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}


@app.get("/", tags=["System"])
async def root():
    return {"message": f"{settings.APP_NAME} is running"}