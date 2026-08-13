/**
 * app/api/kyc/start/route.ts
 *
 * The frontend calls POST /api/kyc/start after wallet login to resume
 * or initialise a KYC flow. FastAPI has no direct equivalent — instead
 * it exposes GET /api/v1/kyc/status which gives us everything we need.
 *
 * This shim:
 *  1. Calls FastAPI's status endpoint with the user's token
 *  2. Maps the kyc_status into the session shape the frontend uses
 *  3. Returns { session } so KycPage can determine which step to show
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyGET } from '@/lib/proxy';
import { statusResponseToSession } from '@/lib/statusMap';

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authHeader = req.headers.get('authorization');

  let res: Response;
  try {
    res = await proxyGET('/api/v1/kyc/status', authHeader);
  } catch (err) {
    console.error('[kyc/start] backend unreachable:', err);
    return NextResponse.json({ error: 'KYC service unavailable' }, { status: 503 });
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return NextResponse.json(errData, { status: res.status });
  }

  const data: {
    user_id: string;
    kyc_status: string;
    email_verified: boolean;
    onchain_verified: boolean;
    steps_completed: string[];
    next_step: string | null;
    rejection_reason: string | null;
  } = await res.json();

  const session = statusResponseToSession(data);

  return NextResponse.json({ session });
}