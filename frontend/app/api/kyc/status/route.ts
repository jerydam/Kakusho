/**
 * app/api/kyc/status/route.ts
 *
 * Proxies GET /api/kyc/status → FastAPI GET /api/v1/kyc/status
 * and maps the response into the shape the frontend expects.
 *
 * Used by the VerifiedStatus component to poll for updates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyGET } from '@/lib/proxy';
import { statusResponseToSession } from '@/lib/statusMap';

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authHeader = req.headers.get('authorization');

  let res: Response;
  try {
    res = await proxyGET('/api/v1/kyc/status', authHeader);
  } catch (err) {
    console.error('[kyc/status] backend unreachable:', err);
    return NextResponse.json({ error: 'KYC service unavailable' }, { status: 503 });
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return NextResponse.json(errData, { status: res.status });
  }

  const data = await res.json();
  const session = statusResponseToSession(data);

  // Also fetch SBT data if user is verified
  let sbt = null;
  if (data.kyc_status === 'verified') {
    try {
      const sbtRes = await proxyGET(`/api/v1/kyc/check/${auth.walletAddress}`, authHeader);
      if (sbtRes.ok) {
        const sbtData = await sbtRes.json();
        if (sbtData.has_sbt) {
          sbt = {
            chain: 'base',          // FastAPI targets chain_id 8453 (Base)
            token_id: null,          // not returned by check endpoint
            tx_hash: null,
            contract_address: null,
            minted_at: new Date().toISOString(),
          };
        }
      }
    } catch {
      // SBT lookup failure is non-fatal
    }
  }

  return NextResponse.json({
    status: session.status,
    session,
    sbt,
  });
}