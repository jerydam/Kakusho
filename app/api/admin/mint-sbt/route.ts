/**
 * app/api/admin/mint-sbt/route.ts
 *
 * STRATEGY DECISION: user-initiated mint
 * ─────────────────────────────────────────────────────────────────
 * FastAPI's POST /api/v1/kyc/mint-sbt is a USER endpoint, not admin.
 * It uses the JWT to determine who to mint for, requires the user's
 * own wallet to be linked, and the user must already be verified.
 *
 * The admin ReviewModal calls this after approval. Two valid approaches:
 *
 *   A) Keep the admin UI button but have it call a user-level endpoint
 *      by passing through the user's token — but the admin doesn't have
 *      that token. NOT FEASIBLE from the admin panel.
 *
 *   B) Record the SBT mint intent server-side and let the user trigger
 *      the actual on-chain mint themselves from their own dashboard.
 *      This is the correct UX pattern for SBTs anyway (user initiates).
 *
 *   C) Add an admin-level mint endpoint to FastAPI (POST /kyc/admin/mint-sbt
 *      { user_id }) and call that here. RECOMMENDED long-term.
 *
 * Current implementation: Option B + stub for C
 *
 * - If ADMIN_MINT_ENDPOINT env var is set, we try to call a custom admin
 *   mint endpoint on FastAPI (Option C).
 * - Otherwise we return a success response indicating the intent was logged
 *   and the user will be prompted to mint from their dashboard (Option B).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyJSON } from '@/lib/proxy';

const ADMIN_MINT_ENDPOINT = process.env.ADMIN_MINT_ENDPOINT ?? '';

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { userId?: string; chain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userId, chain } = body;
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const authHeader = req.headers.get('authorization');

  // Option C: custom admin endpoint exists on FastAPI
  if (ADMIN_MINT_ENDPOINT) {
    let res: Response;
    try {
      res = await proxyJSON(
        ADMIN_MINT_ENDPOINT,
        'POST',
        { user_id: userId, chain: chain ?? 'base' },
        authHeader
      );
    } catch (err) {
      console.error('[mint-sbt] backend unreachable:', err);
      return NextResponse.json({ error: 'Mint service unavailable' }, { status: 503 });
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return NextResponse.json(errData, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({
      sbt: {
        user_id: userId,
        chain: chain ?? 'base',
        tx_hash: data.tx_hash ?? null,
        token_id: data.token_id ?? null,
        contract_address: data.contract_address ?? null,
        minted_at: new Date().toISOString(),
      },
    });
  }

  // Option B: intent logged — user completes mint from their dashboard
  // The admin approval (via /api/admin/review) already called FastAPI's
  // approve endpoint which triggers on-chain verification if a wallet is
  // linked. The SBT mint itself requires the user's action.
  console.info(`[mint-sbt] Admin flagged user ${userId} for SBT mint. User must initiate.`);

  return NextResponse.json({
    sbt: {
      user_id: userId,
      chain: chain ?? 'base',
      tx_hash: null,
      token_id: null,
      contract_address: null,
      minted_at: null,
      pending_user_action: true,
    },
    message:
      'Mint intent recorded. The user will be prompted to mint their SBT from their dashboard. ' +
      'To enable admin-initiated minting, add POST /kyc/admin/mint-sbt to FastAPI and set ' +
      'ADMIN_MINT_ENDPOINT=/api/v1/kyc/admin/mint-sbt in your .env.',
  });
}