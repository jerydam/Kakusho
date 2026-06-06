'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Shield, CheckCircle2, ArrowRight, Code2, Globe, Lock,
  Zap, Wallet, FileText, Camera,
  BarChart2, Copy, Check
} from 'lucide-react';
import { cn } from '@/lib/utils';

const REACT_SNIPPET = `import { KYCWidget } from '@trustid/react';

export function App() {
  return (
    <KYCWidget
      wallet="0xAbCd...1234"
      onVerified={() => console.log('User verified!')}
    />
  );
}`;

const VANILLA_SNIPPET = `<script src="https://cdn.trustid.io/widget.js"></script>
<div id="kyc-widget"></div>
<script>
  TrustID.init('#kyc-widget', {
    wallet: '0xAbCd...1234',
    onVerified: () => console.log('Verified!'),
  });
</script>`;

const PROPS_TABLE = [
  { prop: 'wallet', type: 'string', required: true, desc: 'Ethereum wallet address to check' },
  { prop: 'compact', type: 'boolean', required: false, desc: 'Compact single-line mode (default: false)' },
  { prop: 'onVerified', type: '() => void', required: false, desc: 'Callback fired when wallet is verified' },
];

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(83,74,183,0.15)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-white/5">
        <span className="text-xs text-gray-400 font-medium">{lang}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
        >
          {copied ? <><Check className="w-3.5 h-3.5 text-green-400" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>
      <pre className="px-4 py-4 bg-gray-950 overflow-x-auto text-xs leading-relaxed text-gray-300 font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function WidgetPreview({ verified }: { verified: boolean }) {
  const wallet = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
  if (verified) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[#E6F7F2]" style={{ border: '0.5px solid rgba(29,158,117,0.25)' }}>
        <div className="w-8 h-8 rounded-full bg-[#1D9E75] flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1D9E75]">KYC verified</p>
          <p className="text-xs text-[#1D9E75]/70 font-mono-addr">{wallet.slice(0, 8)}...{wallet.slice(-6)}</p>
        </div>
        <Shield className="w-4 h-4 text-[#1D9E75] opacity-60 ml-auto shrink-0" />
      </div>
    );
  }
  return (
    <div className="px-4 py-4 rounded-xl bg-white" style={{ border: '0.5px solid rgba(83,74,183,0.1)' }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-[#FEF3E6] flex items-center justify-center shrink-0">
          <Shield className="w-3.5 h-3.5 text-[#E88C3A]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Verification Required</p>
          <p className="text-xs text-gray-400">Complete KYC to access this feature</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-[#534AB7] cursor-pointer">
        <span className="text-sm font-medium text-white">Start Verification</span>
        <ArrowRight className="w-3.5 h-3.5 text-white" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const [widgetState, setWidgetState] = useState<'verified' | 'unverified'>('unverified');
  const [activeSnippet, setActiveSnippet] = useState<'react' | 'vanilla'>('react');

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md" style={{ borderBottom: '0.5px solid rgba(83,74,183,0.1)' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#534AB7] flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-900">TrustID</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="#how-it-works" className="text-sm text-gray-500 hover:text-gray-900 transition-colors hidden md:block">How it works</Link>
            <Link href="#widget" className="text-sm text-gray-500 hover:text-gray-900 transition-colors hidden md:block">Widget</Link>
            <Link href="/admin" className="kyc-btn-ghost text-sm py-1.5 px-3">Admin</Link>
            <Link href="/kyc" className="kyc-btn-primary py-1.5 px-4 text-sm flex items-center gap-1.5">
              Get Verified <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-20 pb-16 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-6 bg-[#EAE8F8] text-[#534AB7]" style={{ border: '0.5px solid rgba(83,74,183,0.2)' }}>
            <Zap className="w-3.5 h-3.5" />
            On-chain Identity Verification
          </div>
          <h1 className="text-5xl font-bold text-gray-900 leading-tight tracking-tight mb-5">
            KYC that lives{' '}
            <span className="text-[#534AB7]">on-chain</span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed max-w-xl mx-auto mb-8">
            Wallet-native identity verification with SBT issuance. Embed the verified status
            widget in any dApp in under 5 minutes.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/kyc" className="kyc-btn-primary py-3 px-6 text-base flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Start Verification
            </Link>
            <Link href="#widget" className="kyc-btn-secondary py-3 px-6 text-base flex items-center gap-2">
              <Code2 className="w-4 h-4" />
              Embed Widget
            </Link>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="pb-16 px-6">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-4">
          {[
            { icon: Lock, title: 'Wallet-native auth', desc: 'Sign-in with Ethereum — no passwords, no email, no friction.', color: '#534AB7', bg: '#EAE8F8' },
            { icon: Shield, title: 'SBT Issuance', desc: 'Verified status is minted as a non-transferable Soul-Bound Token.', color: '#1D9E75', bg: '#E6F7F2' },
            { icon: Globe, title: 'Embeddable Widget', desc: 'Drop a React or vanilla JS widget into any dApp with one line.', color: '#2E8FD9', bg: '#E6F3FC' },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className="kyc-card-hover p-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: bg }}>
                <Icon className="w-5 h-5" style={{ color }} />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-16 px-6 bg-[#F7F7FA]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">How it works</h2>
            <p className="text-gray-500">Six steps from wallet connect to on-chain identity</p>
          </div>
          <div className="space-y-3">
            {[
              { step: 1, icon: Wallet, title: 'Connect Wallet', desc: 'GET /web3/nonce/:wallet → sign message → POST /web3/login', tag: 'Auth' },
              { step: 2, icon: FileText, title: 'Start KYC Session', desc: 'POST /kyc/start — creates or resumes a session for the wallet', tag: 'KYC' },
              { step: 3, icon: FileText, title: 'Upload ID Document', desc: "POST /kyc/upload-doc (multipart/form-data) — passport, national ID, or driver's license", tag: 'KYC' },
              { step: 4, icon: Camera, title: 'Submit Selfie', desc: 'POST /kyc/verify-face (multipart/form-data) — fetches ID doc from DB automatically', tag: 'KYC' },
              { step: 5, icon: BarChart2, title: 'Admin Review', desc: 'POST /admin/review — approve or reject the submission', tag: 'Admin' },
              { step: 6, icon: Shield, title: 'Mint SBT', desc: 'POST /admin/mint-sbt — records on-chain token metadata', tag: 'Chain' },
            ].map(({ step, title, desc, tag }) => (
              <div key={step} className="flex items-start gap-5 bg-white px-6 py-5 rounded-xl" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
                <div className="w-9 h-9 rounded-lg bg-[#EAE8F8] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-bold text-[#534AB7]">{step}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{title}</p>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag}</span>
                  </div>
                  <p className="text-[12px] text-gray-500 font-mono leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Widget section */}
      <section id="widget" className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Embeddable Widget</h2>
            <p className="text-gray-500">Drop verified status into any dApp</p>
          </div>
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Live preview */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Live Preview</h3>
              <div className="bg-white rounded-2xl p-6" style={{ border: '0.5px solid rgba(83,74,183,0.1)' }}>
                <div className="flex items-center gap-2 mb-6">
                  <button
                    onClick={() => setWidgetState('unverified')}
                    className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', widgetState === 'unverified' ? 'bg-[#534AB7] text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
                  >
                    Unverified
                  </button>
                  <button
                    onClick={() => setWidgetState('verified')}
                    className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', widgetState === 'verified' ? 'bg-[#534AB7] text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
                  >
                    Verified
                  </button>
                </div>
                <WidgetPreview verified={widgetState === 'verified'} />
                <div className="mt-4 pt-4" style={{ borderTop: '0.5px solid rgba(0,0,0,0.07)' }}>
                  <p className="text-xs text-gray-400">
                    The widget calls{' '}
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-600">
                      GET /api/kyc/check/:wallet
                    </code>{' '}
                    on load to determine which state to render.
                  </p>
                </div>
              </div>

              {/* Props table */}
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Props</h3>
                <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
                  <div className="grid grid-cols-[1fr_100px_50px] gap-3 px-4 py-2.5 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b" style={{ borderColor: 'rgba(0,0,0,0.06)', borderWidth: '0.5px' }}>
                    <span>Prop</span><span>Type</span><span>Req</span>
                  </div>
                  {PROPS_TABLE.map((p) => (
                    <div key={p.prop} className="grid grid-cols-[1fr_100px_50px] gap-3 px-4 py-3 border-b last:border-0 text-sm" style={{ borderColor: 'rgba(0,0,0,0.04)', borderWidth: '0.5px' }}>
                      <div>
                        <code className="font-mono text-[#534AB7] text-xs">{p.prop}</code>
                        <p className="text-xs text-gray-400 mt-0.5">{p.desc}</p>
                      </div>
                      <code className="font-mono text-gray-500 text-xs self-start mt-0.5">{p.type}</code>
                      <span className={cn('text-xs font-medium self-start mt-0.5', p.required ? 'text-[#E24B4A]' : 'text-gray-300')}>
                        {p.required ? 'Yes' : 'No'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Code snippets */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mr-2">Integration</h3>
                <button onClick={() => setActiveSnippet('react')} className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-all', activeSnippet === 'react' ? 'bg-[#534AB7] text-white' : 'bg-gray-100 text-gray-500')}>React</button>
                <button onClick={() => setActiveSnippet('vanilla')} className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-all', activeSnippet === 'vanilla' ? 'bg-[#534AB7] text-white' : 'bg-gray-100 text-gray-500')}>Vanilla JS</button>
              </div>
              <CodeBlock code={activeSnippet === 'react' ? REACT_SNIPPET : VANILLA_SNIPPET} lang={activeSnippet === 'react' ? 'React / TypeScript' : 'HTML / JavaScript'} />

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Implementation Notes</h3>
                {[
                  { title: 'Face upload is multipart/form-data', body: 'POST /kyc/verify-face only accepts the selfie file. The ID document is fetched from the database automatically.' },
                  { title: 'Nonce expires in 5 minutes', body: 'GET /web3/nonce/:wallet → sign message → POST /web3/login. Do not cache the nonce.' },
                  { title: 'Admin panel requires is_admin on JWT', body: 'Gate /kyc/admin/* routes behind an is_admin check. Set the flag directly in the database for admin accounts.' },
                ].map(({ title, body }) => (
                  <div key={title} className="px-4 py-3.5 rounded-xl bg-gray-50" style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
                    <p className="text-sm font-semibold text-gray-800 mb-1">{title}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 bg-[#534AB7]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to get verified?</h2>
          <p className="text-white/70 mb-8">Connect your wallet and complete KYC in under 5 minutes.</p>
          <Link href="/kyc" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-white text-[#534AB7] font-semibold text-base hover:bg-gray-50 transition-colors shadow-md">
            <Wallet className="w-5 h-5" />
            Start Verification
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t" style={{ borderColor: 'rgba(0,0,0,0.07)', borderWidth: '0.5px' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-gray-400 flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-[#534AB7] flex items-center justify-center">
              <Shield className="w-3 h-3 text-white" />
            </div>
            <span>TrustID — On-chain KYC</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/kyc" className="hover:text-gray-600 transition-colors">KYC Flow</Link>
            <Link href="/admin" className="hover:text-gray-600 transition-colors">Admin</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
