'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, RotateCcw, Check, AlertCircle, Loader2, ShieldCheck, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelfieUploadProps {
  sessionId: string;
  token: string;
  onComplete: () => void;
}

const POSES = [
  { key: 'left',  label: 'Turn Left',  instruction: 'Slowly turn your head to the LEFT',  Icon: ArrowLeft },
  { key: 'right', label: 'Turn Right', instruction: 'Slowly turn your head to the RIGHT', Icon: ArrowRight },
  { key: 'up',    label: 'Look Up',    instruction: 'Tilt your head UP',                  Icon: ArrowUp },
  { key: 'down',  label: 'Look Down',  instruction: 'Tilt your head DOWN',                Icon: ArrowDown },
] as const;

type PoseKey = typeof POSES[number]['key'];
type CapturedMap = Record<PoseKey, Blob | null>;

export function SelfieUpload({ sessionId, token, onComplete }: SelfieUploadProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const animRef     = useRef<number>(0);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectedRef = useRef(0);

  const [phase, setPhase]         = useState<'init' | 'camera' | 'preview' | 'uploading'>('init');
  const [poseIndex, setPoseIndex] = useState(0);
  const [liveness, setLiveness]   = useState<'position' | 'hold' | 'captured'>('position');
  const [countdown, setCountdown] = useState(3);
  const [faceIn, setFaceIn]       = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [captured, setCaptured]   = useState<CapturedMap>({ left: null, right: null, up: null, down: null });
  const [previewing, setPreviewing] = useState<PoseKey | null>(null);
  const [error, setError]         = useState('');

  const currentPose = POSES[poseIndex];
  const allCaptured = POSES.every(p => captured[p.key] !== null);

  // ─── Overlay ────────────────────────────────────────────────────────────────
  const drawOverlay = useCallback((detected: boolean, instruction: string) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width  || 640;
    const h = rect.height || 480;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 - h * 0.03;
    const rx = w * 0.30, ry = h * 0.40;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = detected ? '#1D9E75' : '#534AB7';
    ctx.lineWidth   = detected ? 3 : 2.5;
    ctx.stroke();

    if (detected) {
      ctx.strokeStyle = '#1D9E75';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
        const px = cx + rx * Math.cos(angle), py = cy + ry * Math.sin(angle);
        const nx = Math.cos(angle),           ny = Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(px - ny * 18, py + nx * 18);
        ctx.lineTo(px, py);
        ctx.lineTo(px + ny * 18, py - nx * 18);
        ctx.stroke();
      });
    }

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(cx - 150, h - 64, 300, 40, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '500 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(instruction, cx, h - 44);
  }, []);

  // ─── Face detection ──────────────────────────────────────────────────────────
  const checkFace = useCallback((): boolean => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const sampleR = canvas.width * 0.15;
    let matched = 0, total = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      for (let r = 0; r < sampleR; r += 8) {
        const px = Math.floor(cx + r * Math.cos(a));
        const py = Math.floor(cy + r * Math.sin(a));
        if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) continue;
        const [R, G, B] = ctx.getImageData(px, py, 1, 1).data;
        const brightness = (R + G + B) / 3;
        if (brightness > 25 && brightness < 250) matched++;
        total++;
      }
    }
    return total > 0 && matched / total > 0.40;
  }, []);

  // ─── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'camera') return;
    let frame = 0;
    const loop = () => {
      frame++;
      if (frame % 4 === 0) {
        const det = checkFace();
        detectedRef.current = det
          ? Math.min(detectedRef.current + 1, 12)
          : Math.max(detectedRef.current - 1, 0);
        const isFaceIn = detectedRef.current >= 6;
        setFaceIn(isFaceIn);
        drawOverlay(isFaceIn, currentPose.instruction);
      }
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, checkFace, drawOverlay, currentPose]);

  // ─── Start countdown when face detected ──────────────────────────────────────
  useEffect(() => {
    if (!faceIn || liveness !== 'position' || phase !== 'camera') return;
    setLiveness('hold');
    setCountdown(3);
    let count = 3;
    timerRef.current = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(timerRef.current!);
        captureCurrentPose();
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [faceIn]);

  // ─── Cancel countdown if face leaves ─────────────────────────────────────────
  useEffect(() => {
    if (!faceIn && liveness === 'hold') {
      if (timerRef.current) clearInterval(timerRef.current);
      setLiveness('position');
      setCountdown(3);
    }
  }, [faceIn, liveness]);

  // ─── Attach stream to video ───────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (phase === 'camera' && streamRef.current && video) {
      video.srcObject = streamRef.current;
      video.onloadedmetadata = () => {
        video.play()
          .then(() => setCameraReady(true))
          .catch(() => setError('Failed to start video playback.'));
      };
    }
  }, [phase]);

  // ─── Camera start/stop ────────────────────────────────────────────────────────
  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      detectedRef.current = 0;
      setFaceIn(false);
      setLiveness('position');
      setCountdown(3);
      setPhase('camera');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('Permission denied') || msg.includes('NotAllowed')) {
        setError('Camera access denied. Please allow camera access and try again.');
      } else if (msg.includes('NotFound')) {
        setError('No camera detected. Please connect a camera and try again.');
      } else {
        setError('Could not access camera. Please try again.');
      }
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setCameraReady(false);
  };

  // ─── Capture current pose ─────────────────────────────────────────────────────
  const captureCurrentPose = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) return;
      const key = POSES[poseIndex].key;
      setCaptured(prev => ({ ...prev, [key]: blob }));

      const nextIndex = poseIndex + 1;
      if (nextIndex < POSES.length) {
        // Advance to next pose — reset detection state
        detectedRef.current = 0;
        setFaceIn(false);
        setLiveness('position');
        setCountdown(3);
        setPoseIndex(nextIndex);
      } else {
        // All done
        stopCamera();
        setPhase('preview');
      }
    }, 'image/jpeg', 0.92);
  }, [poseIndex]);

  const manualCapture = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    captureCurrentPose();
  };

  const retakePose = (key: PoseKey) => {
    const idx = POSES.findIndex(p => p.key === key);
    setCaptured(prev => ({ ...prev, [key]: null }));
    setPoseIndex(idx);
    setPreviewing(null);
    detectedRef.current = 0;
    setFaceIn(false);
    setLiveness('position');
    setCountdown(3);
    setPhase('camera');
    // Re-open camera
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream;
    });
  };

  // ─── Submit all 4 poses ───────────────────────────────────────────────────────
  const submit = async () => {
    setError('');
    setPhase('uploading');
    try {
      const form = new FormData();
      for (const pose of POSES) {
        const blob = captured[pose.key];
        if (!blob) throw new Error(`Missing pose: ${pose.label}`);
        form.append('selfies', new File([blob], `${pose.key}.jpg`, { type: 'image/jpeg' }));
      }

      const res = await fetch('/api/kyc/verify-face', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Verification failed');
      }
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
      setPhase('preview');
    }
  };

  useEffect(() => () => stopCamera(), []);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-up space-y-5">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#EAE8F8] mb-3">
          <Camera className="w-7 h-7 text-[#534AB7]" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Liveness Check</h2>
        <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed">
          We'll capture 4 head poses to verify you're present in real time.
        </p>
      </div>

      {/* Pose progress pills */}
      <div className="flex gap-1.5">
        {POSES.map((pose, i) => {
          const done = captured[pose.key] !== null;
          const active = i === poseIndex && phase === 'camera';
          return (
            <button
              key={pose.key}
              onClick={() => done ? setPreviewing(previewing === pose.key ? null : pose.key) : undefined}
              disabled={!done}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-xs font-medium text-center transition-all',
                done  ? 'bg-[#E6F7F2] text-[#1D9E75] cursor-pointer' :
                active ? 'bg-[#EAE8F8] text-[#534AB7]' :
                         'bg-gray-100 text-gray-400 cursor-default'
              )}
            >
              {done ? `✓ ${pose.label}` : pose.label}
            </button>
          );
        })}
      </div>

      {/* Camera area */}
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-[#111]"
        style={{ aspectRatio: '4/3', border: '0.5px solid rgba(83,74,183,0.15)' }}
      >
        <canvas ref={canvasRef} className="hidden" />

        {/* Init state */}
        {phase === 'init' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <svg width="180" height="220" viewBox="0 0 180 220">
              <ellipse cx="90" cy="110" rx="72" ry="96"
                fill="none" stroke="#534AB7" strokeWidth="1.5"
                strokeDasharray="8 5" opacity="0.5" />
            </svg>
            <button onClick={startCamera} className="kyc-btn-primary px-6 py-2.5 flex items-center gap-2 text-sm">
              <Camera className="w-4 h-4" /> Open Camera
            </button>
          </div>
        )}

        {/* Live camera */}
        {phase === 'camera' && (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ zIndex: 1 }}
            />
            <canvas ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ zIndex: 2, background: 'transparent' }}
            />

            {/* Pose direction arrow */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
              <div className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
                faceIn ? 'bg-[#1D9E75] text-white' : 'bg-black/50 text-white'
              )}>
                {(() => { const Icon = currentPose.Icon; return <Icon className="w-3.5 h-3.5" />; })()}
                {currentPose.label}
                {faceIn && <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse ml-1" />}
              </div>
            </div>

            {/* Countdown bubble */}
            {liveness === 'hold' && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10">
                <div className="w-12 h-12 rounded-full bg-[#1D9E75] flex items-center justify-center text-white font-bold text-xl shadow-lg"
                  style={{ border: '2px solid rgba(255,255,255,0.4)' }}>
                  {countdown}
                </div>
              </div>
            )}

            {/* Manual capture button */}
            <button onClick={manualCapture}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-14 h-14 rounded-full bg-white shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
              style={{ border: '3px solid rgba(83,74,183,0.3)' }}
              title="Capture manually"
            >
              <div className="w-10 h-10 rounded-full bg-[#534AB7] flex items-center justify-center">
                <Camera className="w-5 h-5 text-white" />
              </div>
            </button>
          </>
        )}

        {/* Preview grid — show after all captured */}
        {phase === 'preview' && (
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-1 p-1">
            {POSES.map(pose => {
              const blob = captured[pose.key];
              return (
                <div key={pose.key} className="relative rounded-lg overflow-hidden bg-gray-900">
                  {blob && (
                    <img src={URL.createObjectURL(blob)} alt={pose.label}
                      className="w-full h-full object-cover" />
                  )}
                  <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-2 py-1 bg-black/50">
                    <span className="text-white text-[10px] font-medium">{pose.label}</span>
                    <button onClick={() => retakePose(pose.key)}
                      className="text-white/70 hover:text-white">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Uploading overlay */}
        {phase === 'uploading' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
              <p className="text-white text-sm font-medium">Verifying liveness...</p>
            </div>
          </div>
        )}
      </div>

      {/* Tips */}
      {phase === 'init' && (
        <div className="grid grid-cols-4 gap-2 p-3 rounded-xl bg-gray-50 text-center"
          style={{ border: '0.5px solid rgba(0,0,0,0.07)' }}>
          {[
            { emoji: '💡', label: 'Good lighting' },
            { emoji: '👈', label: 'Turn left' },
            { emoji: '👉', label: 'Turn right' },
            { emoji: '☝️', label: 'Look up/down' },
          ].map(({ emoji, label }) => (
            <div key={label}>
              <div className="text-lg mb-0.5">{emoji}</div>
              <p className="text-[11px] text-gray-500 font-medium">{label}</p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-[#FDEAEA] text-sm text-[#E24B4A]"
          style={{ border: '0.5px solid rgba(226,75,74,0.2)' }}>
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit */}
      {phase === 'preview' && (
        <button onClick={submit}
          className="kyc-btn-primary w-full py-3 flex items-center justify-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Submit for Verification
        </button>
      )}
    </div>
  );
}