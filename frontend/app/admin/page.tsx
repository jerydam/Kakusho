'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Shield, CheckCircle2, XCircle, Clock, Search, Filter,
  ChevronDown, AlertCircle, Loader2, User, FileText, Camera,
  LogIn, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminSession, KycStatus } from '@/lib/types';

const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'under_review', label: 'Under Review' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
];

function StatusPill({ status }: { status: KycStatus }) {
  const map: Record<KycStatus, string> = {
    pending: 'status-pending',
    documents_uploaded: 'status-uploaded',
    face_verified: 'status-review',
    under_review: 'status-review',
    verified: 'status-verified',
    rejected: 'status-rejected',
  };
  const labels: Record<KycStatus, string> = {
    pending: 'Pending',
    documents_uploaded: 'Docs Uploaded',
    face_verified: 'Face Verified',
    under_review: 'Under Review',
    verified: 'Verified',
    rejected: 'Rejected',
  };
  return <span className={map[status]}>{labels[status]}</span>;
}

function truncate(str: string) {
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

interface ReviewModalProps {
  session: AdminSession;
  token: string;
  onClose: () => void;
  onAction: () => void;
}

function ReviewModal({ session, token, onClose, onAction }: ReviewModalProps) {
  const [notes, setNotes] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  async function act(action: 'approve' | 'reject') {
    setActing(true);
    setError('');
    try {
      const res = await fetch('/api/admin/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: session.id, action, notes }),
      });
      if (!res.ok) throw new Error('Action failed');
      onAction();
    } catch {
      setError('Action failed. Please try again.');
      setActing(false);
    }
  }

  async function mintSbt() {
    setActing(true);
    setError('');
    try {
      const res = await fetch('/api/admin/mint-sbt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: session.user_id, chain: 'ethereum' }),
      });
      if (!res.ok) throw new Error('Minting failed');
      onAction();
    } catch {
      setError('Minting failed. Please try again.');
      setActing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg animate-fade-up"
        style={{ border: '0.5px solid rgba(83,74,183,0.15)' }}
      >
        <div className="p-6 border-b" style={{ borderColor: 'rgba(83,74,183,0.08)', borderWidth: '0.5px' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Review Submission</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Wallet */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
            <div className="w-9 h-9 rounded-full bg-[#EAE8F8] flex items-center justify-center">
              <User className="w-4 h-4 text-[#534AB7]" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Wallet Address</p>
              <p className="text-sm font-semibold font-mono-addr text-gray-800">
                {session.kyc_users?.wallet_address || '—'}
              </p>
            </div>
          </div>

          {/* Doc type + timestamps */}
          <div className="grid grid-cols-2 gap-3">
            <div className="px-4 py-3 rounded-xl bg-gray-50" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
              <p className="text-xs text-gray-400 font-medium mb-1">Document Type</p>
              <p className="text-sm font-semibold text-gray-800 capitalize">
                {session.doc_type?.replace(/_/g, ' ') || '—'}
              </p>
            </div>
            <div className="px-4 py-3 rounded-xl bg-gray-50" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
              <p className="text-xs text-gray-400 font-medium mb-1">Submitted</p>
              <p className="text-sm font-semibold text-gray-800">
                {new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>

          {/* File indicators */}
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
              session.doc_file_path ? 'bg-[#E6F7F2] text-[#1D9E75]' : 'bg-gray-100 text-gray-400'
            )} style={{ border: '0.5px solid transparent' }}>
              <FileText className="w-3.5 h-3.5" />
              ID Document {session.doc_file_path ? 'Uploaded' : 'Missing'}
            </div>
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
              session.selfie_file_path ? 'bg-[#E6F7F2] text-[#1D9E75]' : 'bg-gray-100 text-gray-400'
            )}>
              <Camera className="w-3.5 h-3.5" />
              Selfie {session.selfie_file_path ? 'Uploaded' : 'Missing'}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Review Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add optional notes..."
              className="kyc-input resize-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-[#E24B4A] bg-[#FDEAEA] px-4 py-3 rounded-lg" style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="p-6 pt-0 flex items-center gap-3">
          {session.status === 'under_review' && (
            <>
              <button
                onClick={() => act('reject')}
                disabled={acting}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-[#E24B4A] bg-[#FDEAEA] hover:bg-[#FAD9D9] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}
              >
                {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Reject
              </button>
              <button
                onClick={() => act('approve')}
                disabled={acting}
                className="flex-1 kyc-btn-primary py-2.5 flex items-center justify-center gap-2"
              >
                {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Approve
              </button>
            </>
          )}
          {session.status === 'verified' && (
            <button
              onClick={mintSbt}
              disabled={acting}
              className="flex-1 kyc-btn-primary py-2.5 flex items-center justify-center gap-2"
            >
              {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
              Mint SBT
            </button>
          )}
          {session.status === 'rejected' && (
            <p className="text-sm text-gray-400 mx-auto">This submission was rejected.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState('under_review');
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null);


const loginInProgress = useRef(false);  // ← add this ref

async function adminLogin() {
  if (loginInProgress.current) return;  // ← hard lock
  loginInProgress.current = true;
  setLoggingIn(true);
  setLoginError('');

  try {
    if (!(window as any).ethereum) throw new Error('No wallet found');

    // Step 1: get accounts first
    const accounts: string[] = await (window as any).ethereum.request({
      method: 'eth_requestAccounts',
    });
    const wallet = accounts[0].toLowerCase();

    // Step 2: ONLY NOW fetch nonce — after accounts resolved, no more re-renders
    const nonceRes = await fetch(`/api/web3/nonce/${wallet}`, {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' },
});
if (!nonceRes.ok) throw new Error('Failed to get nonce');

const nonceData = await nonceRes.json();
if (!nonceData || !nonceData.message) throw new Error('Invalid nonce response');

const { message } = nonceData;
    if (!nonceRes.ok) throw new Error('Failed to get nonce');

    // Step 3: sign immediately
    const sig = await (window as any).ethereum.request({
      method: 'personal_sign',
      params: [message, wallet],
    });

    // Step 4: login
    const loginRes = await fetch('/api/web3/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature: sig }),
    });

    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}));
      throw new Error(err.error || err.detail || 'Login failed');
    }

    const { token: t, user } = await loginRes.json();
    if (!user.is_admin) throw new Error('Not an admin account');

    setToken(t);
    setLoggedIn(true);

  } catch (err: any) {
    setLoginError(err.message || 'Login failed');
  } finally {
    loginInProgress.current = false;  // ← release lock
    setLoggingIn(false);
  }
}

  async function loadSessions() {
    if (!token) return;
    setLoadingList(true);
    try {
      const res = await fetch(`/api/admin/sessions?status=${activeTab}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSessions(data.sessions || []);
      setTotal(data.total || 0);
    } catch {
      setSessions([]);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (loggedIn) loadSessions();
  }, [loggedIn, activeTab]);

  const filtered = sessions.filter((s) =>
    search
      ? s.kyc_users?.wallet_address?.toLowerCase().includes(search.toLowerCase())
      : true
  );

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-[#F7F7FA] flex items-center justify-center px-4">
        <div
          className="bg-white rounded-2xl p-8 shadow-sm w-full max-w-md"
          style={{ border: '0.5px solid rgba(83,74,183,0.1)' }}
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#EAE8F8] mb-4">
              <Shield className="w-7 h-7 text-[#534AB7]" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">Admin Panel</h1>
            <p className="text-sm text-gray-500">Connect your admin wallet to continue</p>
          </div>

          {loginError && (
            <div
              className="flex items-start gap-2 px-4 py-3 rounded-lg bg-[#FDEAEA] text-sm text-[#E24B4A] mb-4"
              style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {loginError}
            </div>
          )}

          <button
  onClick={adminLogin}
  disabled={loggingIn}
  className="kyc-btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
>
  {loggingIn ? (
    <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
  ) : (
    <><LogIn className="w-4 h-4" /> Connect Admin Wallet</>
  )}
</button>

          <p className="text-xs text-center text-gray-400 mt-4">
            Your wallet must be marked as admin in the database
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7FA]">
      {/* Header */}
      <header
        className="bg-white sticky top-0 z-30"
        style={{ borderBottom: '0.5px solid rgba(83,74,183,0.1)' }}
      >
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#534AB7] flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">TrustID Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full bg-[#EAE8F8] text-[#534AB7] font-medium">
              Admin
            </span>
            <button
              onClick={() => { setLoggedIn(false); setToken(''); }}
              className="kyc-btn-ghost text-xs py-1.5 px-3"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Under Review', color: '#2E8FD9', bg: '#E6F3FC', count: activeTab === 'under_review' ? total : '—' },
            { label: 'Verified', color: '#1D9E75', bg: '#E6F7F2', count: activeTab === 'verified' ? total : '—' },
            { label: 'Rejected', color: '#E24B4A', bg: '#FDEAEA', count: activeTab === 'rejected' ? total : '—' },
          ].map(({ label, color, bg, count }) => (
            <div
              key={label}
              className="bg-white rounded-xl px-5 py-4"
              style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}
            >
              <p className="text-xs font-medium text-gray-400 mb-1">{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>{count}</p>
            </div>
          ))}
        </div>

        {/* Tabs + search */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1 bg-white rounded-xl p-1" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab.value
                    ? 'bg-[#534AB7] text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wallet..."
              className="pl-9 pr-4 py-2 text-sm rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#534AB7]/20 w-56"
              style={{ border: '0.5px solid rgba(0,0,0,0.1)' }}
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
          <div className="grid grid-cols-[1fr_140px_120px_120px_100px] gap-4 px-6 py-3 bg-gray-50 border-b text-xs font-semibold text-gray-400 uppercase tracking-wide" style={{ borderColor: 'rgba(0,0,0,0.06)', borderWidth: '0.5px' }}>
            <span>Wallet</span>
            <span>Document Type</span>
            <span>Submitted</span>
            <span>Status</span>
            <span></span>
          </div>

          {loadingList ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <FileText className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">No submissions found</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(0,0,0,0.04)' }}>
              {filtered.map((session) => (
                <div
                  key={session.id}
                  className="grid grid-cols-[1fr_140px_120px_120px_100px] gap-4 px-6 py-4 hover:bg-gray-50/70 transition-colors items-center"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#EAE8F8] flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-[#534AB7]" />
                    </div>
                    <span className="text-sm font-mono-addr text-gray-700 truncate">
                      {session.kyc_users?.wallet_address
                        ? truncate(session.kyc_users.wallet_address)
                        : '—'}
                    </span>
                  </div>
                  <span className="text-sm text-gray-600 capitalize">
                    {session.doc_type?.replace(/_/g, ' ') || '—'}
                  </span>
                  <span className="text-sm text-gray-500">
                    {new Date(session.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: '2-digit',
                    })}
                  </span>
                  <span><StatusPill status={session.status as KycStatus} /></span>
                  <button
                    onClick={() => setSelectedSession(session)}
                    className="kyc-btn-secondary text-xs py-1.5 px-3 ml-auto"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedSession && (
        <ReviewModal
          session={selectedSession}
          token={token}
          onClose={() => setSelectedSession(null)}
          onAction={() => { setSelectedSession(null); loadSessions(); }}
        />
      )}
    </div>
  );
}
