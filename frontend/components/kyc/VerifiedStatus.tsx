'use client';

import { KycStatus, SbtToken } from '@/lib/types';
import { CheckCircle2, Clock, XCircle, Shield, ExternalLink, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface VerifiedStatusProps {
  status: KycStatus;
  wallet: string;
  sbt: SbtToken | null;
  sessionId: string | null;
}

function truncate(str: string, start = 6, end = 4) {
  if (str.length <= start + end) return str;
  return `${str.slice(0, start)}...${str.slice(-end)}`;
}

export function VerifiedStatus({ status, wallet, sbt, sessionId }: VerifiedStatusProps) {
  const [copied, setCopied] = useState('');

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  if (status === 'verified') {
    return (
      <div className="animate-fade-up text-center">
        {/* Animated check */}
        <div className="flex items-center justify-center mb-6">
          <div className="relative w-20 h-20">
            <div className="w-20 h-20 rounded-full bg-[#E6F7F2] flex items-center justify-center">
              <svg className="w-10 h-10" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="#1D9E75" strokeWidth="1.5" />
                <path
                  d="M12 20.5l5.5 5.5L28 14"
                  stroke="#1D9E75"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="check-draw"
                />
              </svg>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#534AB7] rounded-full flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-1">Identity Verified</h2>
        <p className="text-sm text-gray-500 mb-6">
          Your wallet has been successfully verified on-chain.
        </p>

        {/* Wallet + SBT details */}
        <div
          className="kyc-card p-4 text-left space-y-3 mb-6"
          style={{ border: '0.5px solid rgba(29,158,117,0.2)' }}
        >
          <InfoRow
            label="Wallet"
            value={truncate(wallet, 8, 6)}
            full={wallet}
            onCopy={() => copy(wallet, 'wallet')}
            copied={copied === 'wallet'}
          />
          {sbt && (
            <>
              <div className="h-px bg-gray-100" />
              <InfoRow
                label="Chain"
                value={sbt.chain.charAt(0).toUpperCase() + sbt.chain.slice(1)}
              />
              {sbt.token_id && (
                <InfoRow
                  label="Token ID"
                  value={sbt.token_id}
                  onCopy={() => copy(sbt.token_id!, 'tokenId')}
                  copied={copied === 'tokenId'}
                />
              )}
              {sbt.tx_hash && (
                <InfoRow
                  label="Tx Hash"
                  value={truncate(sbt.tx_hash, 8, 6)}
                  full={sbt.tx_hash}
                  onCopy={() => copy(sbt.tx_hash!, 'tx')}
                  copied={copied === 'tx'}
                />
              )}
              {sbt.contract_address && (
                <InfoRow
                  label="Contract"
                  value={truncate(sbt.contract_address, 8, 6)}
                  full={sbt.contract_address}
                  onCopy={() => copy(sbt.contract_address!, 'contract')}
                  copied={copied === 'contract'}
                />
              )}
              <InfoRow
                label="Minted"
                value={new Date(sbt.minted_at).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              />
            </>
          )}
        </div>

        <div className="status-verified mx-auto w-fit text-sm px-4 py-1.5">
          <CheckCircle2 className="w-4 h-4" />
          KYC Verified
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="animate-fade-up text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#FDEAEA] mb-6">
          <XCircle className="w-10 h-10 text-[#E24B4A]" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Rejected</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto leading-relaxed">
          Your identity verification was not successful. Please ensure your documents are clear and
          valid, then try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="kyc-btn-primary mx-auto flex items-center gap-2"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#FEF3E6] mb-6">
        <Clock className="w-10 h-10 text-[#E88C3A] kyc-pulse" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Under Review</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto leading-relaxed">
        Your submission is being reviewed by our compliance team. This typically takes 1–2 business
        days.
      </p>
      <div className="space-y-2">
        {[
          { label: 'Submitted', done: true },
          { label: 'Document Check', done: status !== 'pending' },
          { label: 'Face Verification', done: ['face_verified', 'under_review'].includes(status) },
          { label: 'Manual Review', done: status === 'under_review', active: true },
          { label: 'SBT Issuance', done: false },
        ].map(({ label, done, active }) => (
          <div
            key={label}
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm',
              done ? 'bg-[#E6F7F2]' : active ? 'bg-[#FEF3E6]' : 'bg-gray-50'
            )}
            style={{ border: `0.5px solid ${done ? 'rgba(29,158,117,0.15)' : 'rgba(0,0,0,0.06)'}` }}
          >
            <div className={cn(
              'w-2 h-2 rounded-full',
              done ? 'bg-[#1D9E75]' : active ? 'bg-[#E88C3A] kyc-pulse' : 'bg-gray-300'
            )} />
            <span className={cn(done ? 'text-[#1D9E75]' : active ? 'text-[#E88C3A]' : 'text-gray-400')}>
              {label}
            </span>
            {done && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-[#1D9E75]" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  full,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  full?: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-gray-400 font-medium shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm text-gray-800 font-mono-addr truncate">{value}</span>
        {onCopy && (
          <button
            onClick={onCopy}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            title={copied ? 'Copied!' : 'Copy'}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
