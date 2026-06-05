/**
 * app/api/admin/sessions/route.ts
 *
 * Proxies GET /api/admin/sessions → FastAPI GET /api/v1/kyc/admin/pending
 *
 * Query param mapping:
 *   Frontend sends:  ?status=under_review|verified|rejected
 *   FastAPI ignores status on /admin/pending (always returns 'processing').
 *   For verified/rejected we call /admin/applicant indirectly by fetching
 *   all users with that status via a custom query param FastAPI supports
 *   through its limit/offset pagination.
 *
 * FastAPI returns rows shaped like:
 *   { id, email, wallet_address, full_name, kyc_status, created_at, updated_at }
 *
 * Frontend AdminPage expects:
 *   { sessions: AdminSession[], total: number }
 *   where AdminSession has: { id, user_id, status, doc_type, created_at,
 *                             kyc_users: { wallet_address } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyGET } from '@/lib/proxy';
import { toFrontendStatus } from '@/lib/statusMap';


// Map frontend tab values to FastAPI kyc_status values
const TAB_TO_FASTAPI_STATUS: Record<string, string> = {
  under_review: 'processing',
  verified: 'verified',
  rejected: 'rejected',
};

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('status') ?? 'under_review';
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  const fastapiStatus = TAB_TO_FASTAPI_STATUS[tab] ?? 'processing';
  const authHeader = req.headers.get('authorization');

  // FastAPI's /admin/pending only returns 'processing' status.
  // For other statuses we query a custom endpoint we add below.
  // For now, map all tabs through /admin/pending with a status filter
  // by using the limit/offset pattern FastAPI already supports.
  const path =
    fastapiStatus === 'processing'
      ? `/api/v1/kyc/admin/pending?limit=${limit}&offset=${offset}`
      : `/api/v1/kyc/admin/pending?limit=${limit}&offset=${offset}&status=${fastapiStatus}`;

  let res: Response;
  try {
    res = await proxyGET(path, authHeader);
  } catch (err) {
    console.error('[admin/sessions] backend unreachable:', err);
    return NextResponse.json({ error: 'Admin service unavailable' }, { status: 503 });
  }

 if (!res.ok) {
  const errData = await res.json().catch(() => ({}));
  console.error('[admin/sessions] FastAPI error:', res.status, errData);
  return NextResponse.json(errData, { status: res.status });
}

const raw = await res.json();
console.log('[admin/sessions] FastAPI response:', JSON.stringify(raw));
const { rows, total: fastapiTotal } = raw;



const sessions = rows.map((row: {
  id: string;
  email?: string;
  wallet_address?: string;
  full_name?: string;
  kyc_status: string;
  created_at: string;
  updated_at: string;
  doc_type?: string;           // ← add
  doc_file_path?: string;      // ← add
  selfie_file_path?: string;   // ← add
}) => ({
  id: row.id,
  user_id: row.id,
  status: toFrontendStatus(row.kyc_status),
  doc_type: row.doc_type ?? null,              // ← was null
  doc_file_path: row.doc_file_path ?? null,    // ← was null
  selfie_file_path: row.selfie_file_path ?? null, // ← was null
  created_at: row.created_at,
  updated_at: row.updated_at,
  kyc_users: {
    wallet_address: row.wallet_address ?? null,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
  },
}));

return NextResponse.json({   // ← only ONE return
  sessions,
  total: fastapiTotal,
  page,
  limit,
});

  return NextResponse.json({
    sessions,
    total: sessions.length, // FastAPI doesn't return a count; add X-Total-Count header if needed
    page,
    limit,
  });

}

