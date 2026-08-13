from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from enum import Enum


# ─── Enums ───────────────────────────────────────────────────────────────────

class KYCStatus(str, Enum):
    PENDING = "pending"
    EMAIL_VERIFIED = "email_verified"
    ID_SUBMITTED = "id_submitted"
    PROCESSING = "processing"
    VERIFIED = "verified"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class DocType(str, Enum):
    PASSPORT = "passport"
    NATIONAL_ID = "national_id"
    DRIVERS_LICENSE = "drivers_license"
    RESIDENCE_PERMIT = "residence_permit"


# ─── Auth ────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class OTPVerifyRequest(BaseModel):
    email: EmailStr
    otp: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    kyc_status: KYCStatus
    is_admin: bool = False 


class RefreshRequest(BaseModel):
    refresh_token: str


# ─── Web3 Auth ───────────────────────────────────────────────────────────────

class NonceResponse(BaseModel):
    nonce: str
    message: str


class WalletLoginRequest(BaseModel):
    wallet_address: str
    signature: str
    chain_id: int = 8453

    @field_validator("wallet_address")
    @classmethod
    def validate_address(cls, v: str) -> str:
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError("Invalid wallet address")
        return v.lower()


class LinkWalletRequest(BaseModel):
    wallet_address: str
    signature: str
    chain_id: int = 8453


# ─── User ────────────────────────────────────────────────────────────────────

class UserProfile(BaseModel):
    id: UUID
    email: Optional[str]
    wallet_address: Optional[str]
    full_name: Optional[str]
    date_of_birth: Optional[date]
    nationality: Optional[str]
    kyc_status: KYCStatus
    email_verified: bool
    onchain_verified: bool
    sbt_token_id: Optional[str]
    created_at: datetime


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    phone: Optional[str] = None


# ─── KYC ─────────────────────────────────────────────────────────────────────

class KYCStatusResponse(BaseModel):
    user_id: UUID
    kyc_status: KYCStatus
    email_verified: bool
    onchain_verified: bool
    steps_completed: list[str]
    next_step: Optional[str]
    rejection_reason: Optional[str] = None


class DocumentUploadResponse(BaseModel):
    document_id: UUID
    doc_type: DocType
    side: str
    quality_score: float
    is_blurry: bool
    ocr_name: Optional[str]
    ocr_dob: Optional[str]
    ocr_doc_number: Optional[str]
    ocr_detected_doc_type: Optional[str] = None  # what OCR thinks it is
    message: str


class FaceVerificationResponse(BaseModel):
    verification_id: UUID
    match_result: bool
    match_confidence: float
    liveness_passed: bool
    message: str


class KYCApproveRequest(BaseModel):
    user_id: UUID
    notes: Optional[str] = None


class KYCRejectRequest(BaseModel):
    user_id: UUID
    reason: str


# ─── Web3 ────────────────────────────────────────────────────────────────────

class OnchainVerifyResponse(BaseModel):
    tx_hash: str
    wallet_address: str
    chain_id: int
    verified: bool
    message: str


class SBTMintResponse(BaseModel):
    tx_hash: str
    token_id: str
    wallet_address: str
    message: str