'use client';

import { useEffect, useState } from 'react';
import { Shield, CheckCircle2, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { WidgetCheckResponse } from '@/lib/types';
import { cn } from '@/lib/utils';

interface KYCWidgetProps {
  wallet: string;
  compact?: boolean;
  onVerified?: () => void;
}

export function KYCWidget({ wallet, compact = false, onVerified }: KYCWidgetProps) {
  const [data, setData] = useState<WidgetCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    fetch(`/api/kyc/check/${wallet.toLowerCase()}`)
      .then((r) => r.json())
      .then((d: WidgetCheckResponse) => {
        setData(d);
        if (d.verified) onVerified?.();
      })
      .catch(() => setError('Failed to check KYC status'))
      .finally(() => setLoading(false));
  }, [wallet]);

  if (loading) {
    return (
      <div
        className={cn(
          'kyc-card flex items-center gap-3 text-sm text-gray-500',
          compact ? 'px-3 py-2' : 'px-4 py-3'
        )}
      >
        <Loader2 className="w-4 h-4 animate-spin text-[#534AB7]" />
        Checking verification...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className={cn(
          'kyc-card flex items-center gap-3 text-sm text-[#E24B4A]',
          compact ? 'px-3 py-2' : 'px-4 py-3'
        )}
        style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}
      >
        <AlertCircle className="w-4 h-4" />
        {error || 'Unable to check status'}
      </div>
    );
  }

  if (data.verified) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-lg bg-[#E6F7F2]',
          compact ? 'px-3 py-2' : 'px-4 py-3',
        )}
        style={{ border: '0.5px solid rgba(29,158,117,0.25)' }}
      >
        <div className="w-7 h-7 rounded-full bg-[#1D9E75] flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1D9E75]">KYC Verified</p>
          {!compact && (
            <p className="text-xs text-[#1D9E75]/70 font-mono-addr truncate">{wallet}</p>
          )}
        </div>
        <Shield className="w-4 h-4 text-[#1D9E75] opacity-60 shrink-0" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'kyc-card',
        compact ? 'px-3 py-2' : 'px-4 py-4'
      )}
    >
      <div className={cn('flex items-center gap-3', compact ? '' : 'mb-3')}>
        <div className="w-7 h-7 rounded-full bg-[#FEF3E6] flex items-center justify-center shrink-0">
          <Shield className="w-3.5 h-3.5 text-[#E88C3A]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">Verification Required</p>
          {!compact && (
            <p className="text-xs text-gray-400 mt-0.5">Complete KYC to access this feature</p>
          )}
        </div>
      </div>
      {!compact && (
        <a
          href={data.kycUrl}
          className="kyc-btn-primary w-full flex items-center justify-center gap-2 mt-3 py-2.5"
        >
          Start Verification
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      )}
      {compact && (
        <a href={data.kycUrl} className="text-xs text-[#534AB7] font-medium hover:underline ml-10">
          Verify now
        </a>
      )}
    </div>
  );
}
