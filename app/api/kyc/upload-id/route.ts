/**
 * app/api/kyc/upload-doc/route.ts
 *
 * Proxies POST /api/kyc/upload-doc → FastAPI POST /api/v1/kyc/upload-id
 *
 * Field differences:
 *   Frontend sends:   file, doc_type, session_id
 *   FastAPI expects:  file, doc_type, side
 *
 * The frontend doesn't ask the user which side of the document they're
 * uploading, so we default to "front". A second call with side="back"
 * can be added later if back-of-ID is needed.
 *
 * FastAPI returns DocumentUploadResponse:
 *   { document_id, doc_type, side, quality_score, is_blurry,
 *     ocr_name, ocr_dob, ocr_doc_number, message }
 *
 * We reshape this into what the frontend expects:
 *   { session: { id, status, doc_file_path } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { proxyFormData } from '@/lib/proxy';

export async function POST(req: NextRequest) {
  console.log('[upload-doc] hit');

  const auth = await getAuthFromRequest(req);
  console.log('[upload-doc] auth:', auth);

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
    console.log('[upload-doc] formData keys:', [...incoming.keys()]);
  } catch (e) {
    console.error('[upload-doc] formData parse failed:', e);
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }
  const file = incoming.get('file') as File | null;
  const docType = incoming.get('doc_type') as string | null;
  const side = (incoming.get('side') as string | null) ?? 'front'; // default to front

  if (!file || !docType) {
    return NextResponse.json(
      { error: 'file and doc_type are required' },
      { status: 400 }
    );
  }

  // Build the FormData that FastAPI expects
  const outgoing = new FormData();
  outgoing.append('file', file);
  outgoing.append('doc_type', docType);
  outgoing.append('side', side);

  const authHeader = req.headers.get('authorization');

  let res: Response;
  try {
    res = await proxyFormData('/api/v1/kyc/upload-id', outgoing, authHeader);
  } catch (err) {
    console.error('[upload-doc] backend unreachable:', err);
    return NextResponse.json({ error: 'KYC service unavailable' }, { status: 503 });
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return NextResponse.json(errData, { status: res.status });
  }

  const data: {
    document_id: string;
    doc_type: string;
    side: string;
    quality_score: number;
    is_blurry: boolean;
    ocr_name?: string;
    ocr_dob?: string;
    ocr_doc_number?: string;
    message: string;
  } = await res.json();

  // Reshape into the session object the frontend's DocumentUpload component expects
  return NextResponse.json({
    session: {
      id: data.document_id,     // frontend uses this as the session_id going forward
      status: 'documents_uploaded',
      doc_file_path: '__uploaded__',
      selfie_file_path: null,
      doc_type: data.doc_type,
      quality_score: data.quality_score,
      is_blurry: data.is_blurry,
      ocr_name: data.ocr_name ?? null,
      message: data.message,
    },
  });
}