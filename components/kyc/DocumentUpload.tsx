'use client';

import { useState, useRef, useCallback } from 'react';
import { FileText, Upload, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocType, DOC_TYPE_LABELS } from '@/lib/types';

interface DocumentUploadProps {
  sessionId: string;
  token: string;
  onComplete: (sessionId: string) => void;
}

const DOC_TYPES: { value: DocType; label: string; desc: string }[] = [
  { value: 'passport', label: 'Passport', desc: 'International biometric passport' },
  { value: 'national_id', label: 'National ID', desc: 'Government-issued identity card' },
  { value: 'drivers_license', label: "Driver's License", desc: 'Valid driving licence' },
];

export function DocumentUpload({ sessionId, token, onComplete }: DocumentUploadProps) {
  const [docType, setDocType] = useState<DocType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.type.startsWith('image/') && f.type !== 'application/pdf') {
      setError('Please upload an image or PDF file.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB.');
      return;
    }
    setFile(f);
    setError('');
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  async function submit() {
    if (!docType || !file) return;
    setError('');
    setUploading(true);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('doc_type', docType);
      form.append('session_id', sessionId);

      const res = await fetch('/api/kyc/upload-id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      onComplete(sessionId);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="animate-fade-up space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#EAE8F8] mb-4">
          <FileText className="w-8 h-8 text-[#534AB7]" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Upload Identity Document</h2>
        <p className="text-sm text-gray-500">
          Select the type of ID document and upload a clear photo or scan.
        </p>
      </div>

      {/* Doc type selector */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Document Type
        </label>
        <div className="grid grid-cols-3 gap-2">
          {DOC_TYPES.map((dt) => (
            <button
              key={dt.value}
              onClick={() => setDocType(dt.value)}
              className={cn(
                'p-3 rounded-lg text-left transition-all duration-150',
                docType === dt.value
                  ? 'bg-[#EAE8F8] border-[#534AB7]/40 text-[#534AB7]'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-[#534AB7]/25'
              )}
              style={{ border: `0.5px solid ${docType === dt.value ? 'rgba(83,74,183,0.4)' : 'rgba(0,0,0,0.1)'}` }}
            >
              <div className="text-sm font-semibold mb-0.5">{dt.label}</div>
              <div className="text-[11px] opacity-70 leading-tight">{dt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Drop zone */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Document File
        </label>
        <div
          className={cn('drop-zone rounded-xl p-6 text-center cursor-pointer', dragging && 'dragging')}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />

          {file ? (
            <div className="flex items-center gap-3">
              {preview ? (
                <img
                  src={preview}
                  alt="Preview"
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                  style={{ borderWidth: '0.5px' }}
                />
              ) : (
                <div className="w-16 h-16 flex items-center justify-center rounded-lg bg-gray-100">
                  <FileText className="w-7 h-7 text-gray-400" />
                </div>
              )}
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="py-4">
              <Upload className="w-8 h-8 text-[#534AB7]/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600">
                Drop your document here, or{' '}
                <span className="text-[#534AB7] underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, PDF up to 10MB</p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-[#FDEAEA] text-sm text-[#E24B4A]"
          style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!docType || !file || uploading}
        className="kyc-btn-primary w-full py-3 flex items-center justify-center gap-2"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading document...
          </>
        ) : (
          <>
            <Upload className="w-4 h-4" />
            Upload Document
          </>
        )}
      </button>
    </div>
  );
}
