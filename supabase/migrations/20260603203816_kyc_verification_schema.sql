/*
  # KYC Verification Schema

  ## Overview
  Full on-chain KYC verification system with wallet-based authentication,
  document/selfie uploads, admin review queue, and SBT minting.

  ## New Tables

  ### kyc_users
  - `id` (uuid, pk) - internal user id
  - `wallet_address` (text, unique) - Ethereum wallet address (checksummed)
  - `is_admin` (bool) - admin flag, set manually in DB
  - `kyc_status` (text) - state machine: pending | documents_uploaded | face_verified | under_review | verified | rejected
  - `created_at`, `updated_at` (timestamptz)

  ### kyc_nonces
  - `id` (uuid, pk)
  - `wallet_address` (text) - wallet requesting auth
  - `nonce` (text) - random nonce string
  - `expires_at` (timestamptz) - 5-minute TTL
  - `used` (bool) - consumed flag

  ### kyc_sessions
  - `id` (uuid, pk)
  - `user_id` (uuid, fk kyc_users)
  - `status` (text) - mirrors kyc_status
  - `doc_type` (text) - passport | national_id | drivers_license
  - `doc_file_path` (text) - storage path for document
  - `selfie_file_path` (text) - storage path for selfie
  - `admin_notes` (text) - reviewer notes
  - `reviewed_by` (uuid) - admin user id
  - `reviewed_at` (timestamptz)
  - `created_at`, `updated_at` (timestamptz)

  ### sbt_tokens
  - `id` (uuid, pk)
  - `user_id` (uuid, fk kyc_users)
  - `token_id` (text) - on-chain token id
  - `chain` (text) - e.g. ethereum, polygon
  - `tx_hash` (text) - minting transaction hash
  - `contract_address` (text)
  - `minted_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Users can only read/write their own data
  - Admin routes gate behind is_admin check via service role
*/

-- kyc_users table
CREATE TABLE IF NOT EXISTS kyc_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text UNIQUE NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  kyc_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kyc_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own record"
  ON kyc_users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own record"
  ON kyc_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role full access to kyc_users"
  ON kyc_users FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role insert kyc_users"
  ON kyc_users FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role update kyc_users"
  ON kyc_users FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- kyc_nonces table
CREATE TABLE IF NOT EXISTS kyc_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kyc_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to kyc_nonces select"
  ON kyc_nonces FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role full access to kyc_nonces insert"
  ON kyc_nonces FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role full access to kyc_nonces update"
  ON kyc_nonces FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- kyc_sessions table
CREATE TABLE IF NOT EXISTS kyc_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES kyc_users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  doc_type text,
  doc_file_path text,
  selfie_file_path text,
  admin_notes text DEFAULT '',
  reviewed_by uuid REFERENCES kyc_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kyc_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sessions"
  ON kyc_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access sessions select"
  ON kyc_sessions FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role full access sessions insert"
  ON kyc_sessions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role full access sessions update"
  ON kyc_sessions FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- sbt_tokens table
CREATE TABLE IF NOT EXISTS sbt_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES kyc_users(id) ON DELETE CASCADE,
  token_id text,
  chain text NOT NULL DEFAULT 'ethereum',
  tx_hash text,
  contract_address text,
  minted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sbt_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own sbt tokens"
  ON sbt_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access sbt select"
  ON sbt_tokens FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role full access sbt insert"
  ON sbt_tokens FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_kyc_users_wallet ON kyc_users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_kyc_nonces_wallet ON kyc_nonces(wallet_address);
CREATE INDEX IF NOT EXISTS idx_kyc_nonces_expires ON kyc_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_kyc_sessions_user ON kyc_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_sessions_status ON kyc_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sbt_tokens_user ON sbt_tokens(user_id);
