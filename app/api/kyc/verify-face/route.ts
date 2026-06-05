/**
 * app/api/kyc/verify-face/route.ts
 *
 * Proxies POST /api/kyc/verify-face → FastAPI POST /api/v1/kyc/verify-face
 *
 * Field names match on both sides (selfie + session_id on the way in).
 * FastAPI doesn't use session_id — it looks up the latest ID doc for the
 * authenticated user automatically — so we just drop that field.
 *
 * FastAPI returns FaceVerificationResponse:
 *   { verification_id, match_result, match_confidence,
 *     liveness_passed, message }
 *
 * We reshape into what the SelfieUpload component expects:
 *   { session: { status } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyFormData } from '@/lib/proxy';

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }


const selfieFiles = incoming.getAll('selfies') as File[];

if (selfieFiles.length < 4) {
  return NextResponse.json(
    { error: '4 selfie images required: left, right, up, down' },
    { status: 400 }
  );
}

const outgoing = new FormData();
selfieFiles.forEach((f) => outgoing.append('selfies', f));

  const authHeader = req.headers.get('authorization');

  let res: Response;
  try {
    res = await proxyFormData('/api/v1/kyc/verify-face', outgoing, authHeader);
  } catch (err) {
    console.error('[verify-face] backend unreachable:', err);
    return NextResponse.json({ error: 'KYC service unavailable' }, { status: 503 });
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));

    // Surface a user-readable error for common failure cases
    const message =
      errData.detail ??
      errData.error ??
      'Face verification failed. Please retake the selfie.';

    return NextResponse.json({ error: message }, { status: res.status });
  }

  const data: {
    verification_id: string;
    match_result: boolean;
    match_confidence: number;
    liveness_passed: boolean;
    message: string;
  } = await res.json();

  if (!data.match_result || !data.liveness_passed) {
    return NextResponse.json(
      { error: data.message || 'Face verification failed. Please retake the selfie.' },
      { status: 422 }
    );
  }

  return NextResponse.json({
    session: {
      status: 'under_review',
      verification_id: data.verification_id,
      match_confidence: data.match_confidence,
      message: data.message,
    },
  });
}