/**
 * app/api/admin/review/route.ts
 *
 * The frontend ReviewModal sends:
 *   POST /api/admin/review { sessionId, action: 'approve'|'reject', notes }
 *
 * FastAPI has two separate endpoints:
 *   POST /api/v1/kyc/admin/approve  { user_id }
 *   POST /api/v1/kyc/admin/reject   { user_id, reason }
 *
 * This shim routes to the correct one based on `action`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyJSON } from '@/lib/proxy';

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { sessionId?: string; action?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, action, notes } = body;

  if (!sessionId || !action) {
    return NextResponse.json(
      { error: 'sessionId and action are required' },
      { status: 400 }
    );
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
      { status: 400 }
    );
  }

  const authHeader = req.headers.get('authorization');

  let res: Response;
  try {
    if (action === 'approve') {
      res = await proxyJSON(
        '/api/v1/kyc/admin/approve',
        'POST',
        { user_id: sessionId },
        authHeader
      );
    } else {
      res = await proxyJSON(
        '/api/v1/kyc/admin/reject',
        'POST',
        {
          user_id: sessionId,
          reason: notes?.trim() || 'Application rejected by admin',
        },
        authHeader
      );
    }
  } catch (err) { 
    console.error('[admin/review] backend unreachable:', err);
    return NextResponse.json({ error: 'Admin service unavailable' }, { status: 503 });
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return NextResponse.json(errData, { status: res.status });
  }

  const data = await res.json();

  // Normalise response shape
  return NextResponse.json({
    success: true,
    status: action === 'approve' ? 'verified' : 'rejected',
    message: data.message ?? `Application ${action}d`,
    tx_hash: data.tx_hash ?? null,        // present on approve if wallet linked
    onchain: data.verified ?? false,
  });
} 