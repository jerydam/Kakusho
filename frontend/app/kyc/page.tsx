'use client';

import { useState, useEffect } from 'react';
import { StepBar } from '@/components/kyc/StepBar';
import { WalletConnect } from '@/components/kyc/WalletConnect';
import { DocumentUpload } from '@/components/kyc/DocumentUpload';
import { SelfieUpload } from '@/components/kyc/SelfieUpload';
import { VerifiedStatus } from '@/components/kyc/VerifiedStatus';
import { Shield } from 'lucide-react';
import { KycStatus } from '@/lib/types';

type Step = 1 | 2 | 3 | 4;

export default function KycPage() {
  const [step, setStep] = useState<Step>(1);
  const [wallet, setWallet] = useState('');
  const [token, setToken] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [finalStatus, setFinalStatus] = useState<KycStatus>('under_review');
  const [resuming, setResuming] = useState(true);
  const [docAlreadyUploaded, setDocAlreadyUploaded] = useState(false);

  useEffect(() => {
    async function resume() {
      const storedToken = localStorage.getItem('lumina_access_token');
      const storedWallet = localStorage.getItem('lumina_wallet');

      if (!storedToken || !storedWallet) {
        setResuming(false);
        return;
      }

      try {
        const res = await fetch('/api/kyc/status', {
          headers: { Authorization: `Bearer ${storedToken}` },
        });

        if (!res.ok) {
          // Token expired — clear storage and let them reconnect wallet
          localStorage.removeItem('lumina_access_token');
          localStorage.removeItem('lumina_wallet');
          setResuming(false);
          return;
        }

        const data = await res.json();
        // data.session.kyc_status_raw is the original FastAPI status string
        // data.session.id is the user_id from FastAPI
        const raw: string = data.session?.kyc_status_raw ?? '';

        setToken(storedToken);
        setWallet(storedWallet);
        setSessionId(data.session?.id || storedWallet);

        switch (raw) {
          case 'pending':
          case 'email_verified':
            setStep(2);
            break;
          case 'id_submitted':
            setDocAlreadyUploaded(true);
            setStep(3);
            break;
          case 'processing':
            setFinalStatus('under_review');
            setStep(4);
            break;
          case 'verified':
            setFinalStatus('verified');
            setStep(4);
            break;
          case 'rejected':
            setFinalStatus('rejected');
            setStep(4);
            break;
          default:
            // Unknown status — has a token, so skip wallet connect
            setStep(2);
        }
      } catch {
        // Network error — don't wipe storage, user can retry
      } finally {
        setResuming(false);
      }
    }

    resume();
  }, []);

  async function handleWalletConnected(w: string, t: string) {
    // Persist immediately so refresh works after this point
    localStorage.setItem('lumina_wallet', w);
    localStorage.setItem('lumina_access_token', t);

    setWallet(w);
    setToken(t);

    try {
      const res = await fetch('/api/kyc/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = await res.json();

      if (data.session) {
        setSessionId(data.session.id || w);
        const s: KycStatus = data.session.status;
        if (s === 'verified' || s === 'rejected') {
          setFinalStatus(s);
          setStep(4);
        } else if (s === 'under_review') {
          setFinalStatus('under_review');
          setStep(4);
        } else if (s === 'documents_uploaded') {
          setStep(3);
        } else {
          setStep(2);
        }
      } else {
        setSessionId(w);
        setStep(2);
      }
    } catch {
      setSessionId(w);
      setStep(2);
    }
  }

  function handleDocComplete(sid: string) {
    setSessionId(sid);
    setStep(3);
  }

  function handleSelfieComplete() {
    setFinalStatus('under_review');
    setStep(4);
    // Keep storage — VerifiedStatus polls status and needs the token
  }

  if (resuming) {
    return (
      <div className="min-h-screen bg-[#F7F7FA] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Resuming your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7FA] flex flex-col">
      <header className="bg-white border-b" style={{ borderColor: 'rgba(83,74,183,0.1)', borderWidth: '0.5px' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#534AB7] flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">TrustID</span>
          </div>
          {wallet && (
            <span
              className="text-xs font-mono text-gray-500 px-3 py-1.5 rounded-lg bg-gray-50"
              style={{ border: '0.5px solid rgba(0,0,0,0.08)' }}
            >
              {wallet.slice(0, 6)}...{wallet.slice(-4)}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <StepBar currentStep={step} />
          </div>
          <div
            className="bg-white rounded-2xl p-8 shadow-sm"
            style={{ border: '0.5px solid rgba(83,74,183,0.1)' }}
          >
            {step === 1 && <WalletConnect onConnected={handleWalletConnected} />}
            {step === 2 && <DocumentUpload sessionId={sessionId} token={token} onComplete={handleDocComplete} />}
            {step === 3 && <SelfieUpload sessionId={sessionId} token={token} onComplete={handleSelfieComplete} />}
            {step === 4 && <VerifiedStatus status={finalStatus} wallet={wallet} sbt={null} sessionId={sessionId} />}
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">
            Secured by zero-knowledge proofs &middot; Data encrypted at rest
          </p>
        </div>
      </div>
    </div>
  );
}