-- KYC Passport — full schema
-- Run this in your Supabase SQL editor

-- ─── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE kyc_status AS ENUM ('pending', 'email_verified', 'id_submitted', 'processing', 'verified', 'rejected', 'suspended');
CREATE TYPE doc_type   AS ENUM ('passport', 'national_id', 'drivers_license', 'residence_permit');
CREATE TYPE id_side    AS ENUM ('front', 'back', 'selfie');

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               TEXT UNIQUE,
    password_hash       TEXT,                        -- NULL for wallet-only users
    wallet_address      TEXT UNIQUE,                 -- NULL for email-only users
    full_name           TEXT,
    date_of_birth       DATE,
    nationality         TEXT,
    phone               TEXT,

    -- Status
    kyc_status          kyc_status NOT NULL DEFAULT 'pending',
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_admin            BOOLEAN NOT NULL DEFAULT FALSE,

    -- On-chain
    onchain_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    sbt_token_id        TEXT,                        -- soulbound token ID if minted
    onchain_tx_hash     TEXT,                        -- tx that set verification

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at         TIMESTAMPTZ,
    rejected_at         TIMESTAMPTZ,
    rejection_reason    TEXT
);

-- ─── KYC Documents ───────────────────────────────────────────────────────────
CREATE TABLE kyc_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type        doc_type NOT NULL,
    side            id_side NOT NULL,
    file_path       TEXT NOT NULL,          -- local path or S3 key
    file_hash       TEXT NOT NULL,          -- SHA-256 of file bytes
    mime_type       TEXT NOT NULL,
    file_size       INTEGER NOT NULL,

    -- OCR results
    ocr_raw         JSONB,
    ocr_name        TEXT,
    ocr_dob         TEXT,
    ocr_doc_number  TEXT,
    ocr_expiry      TEXT,
    ocr_nationality TEXT,
    ocr_confidence  FLOAT,

    -- AI verification flags
    is_blurry       BOOLEAN DEFAULT FALSE,
    is_tampered     BOOLEAN DEFAULT FALSE,
    quality_score   FLOAT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Face Verifications ──────────────────────────────────────────────────────
CREATE TABLE face_verifications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    selfie_doc_id       UUID REFERENCES kyc_documents(id),
    id_doc_id           UUID REFERENCES kyc_documents(id),

    match_result        BOOLEAN,
    match_distance      FLOAT,             -- lower = more similar
    match_confidence    FLOAT,             -- 1 - distance (our calc)
    liveness_score      FLOAT,             -- simple blur/motion check
    liveness_passed     BOOLEAN,

    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── KYC Sessions (audit trail) ──────────────────────────────────────────────
CREATE TABLE kyc_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    step            TEXT NOT NULL,         -- 'email_otp', 'id_upload', 'face_check', 'approved', 'rejected'
    status          TEXT NOT NULL,         -- 'started', 'completed', 'failed'
    metadata        JSONB,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Wallet Links ────────────────────────────────────────────────────────────
CREATE TABLE wallet_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_address  TEXT NOT NULL,
    chain_id        INTEGER NOT NULL,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, wallet_address)
);

-- ─── On-chain Events ─────────────────────────────────────────────────────────
CREATE TABLE onchain_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    wallet_address  TEXT NOT NULL,
    event_type      TEXT NOT NULL,         -- 'verified', 'revoked', 'sbt_minted'
    tx_hash         TEXT NOT NULL,
    chain_id        INTEGER NOT NULL,
    block_number    BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Refresh Tokens ──────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_users_email          ON users(email);
CREATE INDEX idx_users_wallet         ON users(wallet_address);
CREATE INDEX idx_users_kyc_status     ON users(kyc_status);
CREATE INDEX idx_kyc_docs_user        ON kyc_documents(user_id);
CREATE INDEX idx_face_verif_user      ON face_verifications(user_id);
CREATE INDEX idx_wallet_links_user    ON wallet_links(user_id);
CREATE INDEX idx_wallet_links_address ON wallet_links(wallet_address);
CREATE INDEX idx_onchain_wallet       ON onchain_events(wallet_address);
CREATE INDEX idx_kyc_sessions_user    ON kyc_sessions(user_id);

-- ─── Updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();