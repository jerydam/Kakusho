/**
 * app/api/web3/nonce/[wallet]/route.ts
 *
 * Proxies GET /api/web3/nonce/{wallet} → FastAPI GET /api/v1/web3/nonce/{wallet}
 *
 * FastAPI generates the nonce, stores it in Redis, and returns:
 *   { nonce: string, message: string }
 * We pass that straight through.
 */

import { NextRequest, NextResponse } from 'next/server';
import { proxyGET, forwardResponse } from '@/lib/proxy';

export async function GET(
  _req: NextRequest,
  { params }: { params: { wallet: string } }
) {
  const wallet = params.wallet.toLowerCase();

  let res: Response;
  try {
    res = await proxyGET(`/api/v1/web3/nonce/${wallet}`);
  } catch (err) {
    console.error('[nonce] backend unreachable:', err);
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
  }

  const data = await res.json();
  
  return NextResponse.json(data, {
    status: res.status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}