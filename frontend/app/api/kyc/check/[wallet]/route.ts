import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: { wallet: string } }
) {
  const wallet = params.wallet.toLowerCase();
  const db = getServiceClient();

  const { data: user } = await db
    .from('kyc_users')
    .select('*')
    .eq('wallet_address', wallet)
    .maybeSingle();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const kycUrl = `${baseUrl}/kyc?wallet=${wallet}`;

  if (!user) {
    return NextResponse.json({
      wallet,
      verified: false,
      status: 'pending',
      kycUrl,
      sbt: null,
    });
  }

  const { data: sbt } = await db
    .from('sbt_tokens')
    .select('*')
    .eq('user_id', user.id)
    .order('minted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    wallet,
    verified: user.kyc_status === 'verified',
    status: user.kyc_status,
    kycUrl,
    sbt,
  });
}
