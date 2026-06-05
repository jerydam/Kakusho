/**
 * app/api/web3/login/route.ts
 *
 * Proxies POST /api/web3/login → FastAPI POST /api/v1/web3/login
 *
 * FastAPI:
 *  - Verifies the Ethereum signature (eth_account)
 *  - Issues its own JWT access + refresh token pair
 *  - Upserts the user record
 *
 * We forward the request body as-is and return FastAPI's response.
 * The frontend stores the access_token from FastAPI and sends it
 * as Authorization: Bearer <token> on all subsequent requests.
 *
 * Field mapping:
 *   Frontend sends: { wallet: string, signature: string }
 *   FastAPI expects: { wallet_address: string, signature: string, chain_id?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { proxyJSON, forwardResponse } from '@/lib/proxy';

export async function POST(req: NextRequest) {
  let body: { wallet?: string; wallet_address?: string; signature?: string; chain_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { wallet, wallet_address, signature, chain_id } = body;

  if ((!wallet && !wallet_address) || !signature) {
    return NextResponse.json(
      { error: 'wallet and signature are required' },
      { status: 400 }
    );
  }

  // Normalise: frontend sends `wallet`, FastAPI expects `wallet_address`
  const fastapiBody = {
    wallet_address: (wallet_address ?? wallet ?? '').toLowerCase(),
    signature,
    chain_id: chain_id ?? 1,
  };

  let res: Response;
  try {
    res = await proxyJSON('/api/v1/web3/login', 'POST', fastapiBody);
  } catch (err) {
    console.error('[login] backend unreachable:', err);
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
  }

  if (!res.ok) {
    return forwardResponse(res);
  }

  // FastAPI returns:
  // { access_token, refresh_token, user_id, kyc_status }
  const data = await res.json();
  console.log('[login] FastAPI response data:', JSON.stringify(data));

  // Extract the is_admin flag by decoding the JWT access token payload
  let parsedIsAdmin = false;
  if (data.access_token) {
    try {
      // JWT tokens are separated by dots into 3 sections: Header.Payload.Signature
      const base64Payload = data.access_token.split('.')[1];
      const decodedPayload = Buffer.from(base64Payload, 'base64').toString('utf-8');
      const jwtData = JSON.parse(decodedPayload);
      
      // Map flag from decrypted payload matching Supabase status configurations
      parsedIsAdmin = jwtData.is_admin === true;
    } catch (err) {
      console.error('[login] Error decoding JWT claims for admin evaluation:', err);
    }
  }

  // Reshape to what the frontend's WalletConnect component reads:
  // { token, user: { id, wallet_address, kyc_status, is_admin } }
  return NextResponse.json({
    token: data.access_token,
    refresh_token: data.refresh_token,
    
    user: {
      id: data.user_id,
      wallet_address: fastapiBody.wallet_address,
      kyc_status: data.kyc_status,
      is_admin: parsedIsAdmin,
    },
  });
}