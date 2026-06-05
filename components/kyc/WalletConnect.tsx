'use client';

import { useState } from 'react';
import { Wallet, Shield, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WalletConnectProps {
  onConnected: (wallet: string, token: string) => void;
}

export function WalletConnect({ onConnected }: WalletConnectProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'idle' | 'connecting' | 'signing'>('idle');

  
  async function connect() {
    setError('');
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setError('No Web3 wallet detected. Please install MetaMask or a compatible wallet.');
      return;
    }

    try {
      setLoading(true);
      setStep('connecting');

      const accounts: string[] = await (window as any).ethereum.request({
        method: 'eth_requestAccounts',
      });

      const wallet = accounts[0].toLowerCase();
      setStep('signing');

      const nonceRes = await fetch(`/api/web3/nonce/${wallet}`, {
  cache: 'no-store', // ← never cache nonce requests
});
console.log('[nonce] status:', nonceRes.status);
const nonceData = await nonceRes.json();
console.log('[nonce] data:', nonceData);
const { message } = nonceData;

      const signature: string = await (window as any).ethereum.request({
        method: 'personal_sign',
        params: [message, wallet],
      });

     const loginRes = await fetch('/api/web3/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    wallet_address: wallet, 
    signature,
    chain_id: 8453,
  }),
});

console.log('[login] status:', loginRes.status);
const raw = await loginRes.json();
console.log('[login] response:', raw);

if (!loginRes.ok) {
  throw new Error(raw.error || raw.detail || 'Login failed');
}

const { token } = raw;
console.log('[login] token:', token);
onConnected(wallet, token);
      onConnected(wallet, token);
    } catch (err: any) {
      if (err.code === 4001) {
        setError('Signature rejected. Please approve the signing request in your wallet.');
      } else {
        setError(err.message || 'Failed to connect wallet');
      }
    } finally {
      setLoading(false);
      setStep('idle');
    }
  }

  return (
    <div className="animate-fade-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#EAE8F8] mb-4">
          <Wallet className="w-8 h-8 text-[#534AB7]" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Connect Your Wallet</h2>
        <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed">
          Connect your Web3 wallet to begin the KYC verification process. You'll be asked to sign
          a message to prove ownership.
        </p>
      </div>

      <div className="space-y-3 mb-6">
        {[
          { icon: Shield, text: 'Non-custodial — your keys, your identity' },
          { icon: Wallet, text: 'Supports MetaMask and all EIP-1193 wallets' },
        ].map(({ icon: Icon, text }) => (
          <div
            key={text}
            className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-50"
            style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}
          >
            <Icon className="w-4 h-4 text-[#534AB7] shrink-0" />
            <span className="text-sm text-gray-600">{text}</span>
          </div>
        ))}
      </div>

      {error && (
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-[#FDEAEA] mb-4 text-sm text-[#E24B4A]"
          style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={connect}
        disabled={loading}
        className={cn(
          'kyc-btn-primary w-full py-3 flex items-center justify-center gap-2 text-base',
          loading && 'opacity-75 cursor-not-allowed'
        )}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {step === 'connecting' ? 'Connecting wallet...' : 'Waiting for signature...'}
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </>
        )}
      </button>

      <p className="text-center text-xs text-gray-400 mt-4">
        Signing is free and does not require any gas fees
      </p>
    </div>
  );
}
