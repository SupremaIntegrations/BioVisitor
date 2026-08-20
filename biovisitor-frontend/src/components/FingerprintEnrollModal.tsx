'use client';

import React, { useEffect, useCallback, useState, useRef } from 'react';
import Link from 'next/link';
import {
  X, Fingerprint, Wifi, WifiOff, Loader2, CheckCircle2, AlertCircle,
  Trash2, Send, Cpu, Play, Clock, RotateCcw,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  useBioMiniScanner,
  type ConnectionStatus,
  type CaptureStatus,
} from '@/hooks/useBioMiniScanner';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FingerprintEnrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId: string | null;
  visitorName?: string;
}

type EnrollMode = 'biomini' | 'suprema';

interface EnrollerDevice {
  deviceId: string;
  deviceName: string;
  typeName: string;
  type: 'face' | 'fingerprint' | 'card';
  addedAt: string;
}

interface SupremaEnrolledFinger {
  fingerIndex: number;
  template: string;
  quality: number;
  source: 'suprema';
}

// BioStar finger index definitions (follows Suprema SDK standard)
const FINGER_DEFS = [
  { index: 0, label: 'Pulgar',  abbr: 'Pl', hand: 'right' as const },
  { index: 1, label: 'Índice',  abbr: 'Id', hand: 'right' as const },
  { index: 2, label: 'Medio',   abbr: 'Md', hand: 'right' as const },
  { index: 3, label: 'Anular',  abbr: 'An', hand: 'right' as const },
  { index: 4, label: 'Meñique', abbr: 'Mñ', hand: 'right' as const },
  { index: 5, label: 'Pulgar',  abbr: 'Pl', hand: 'left'  as const },
  { index: 6, label: 'Índice',  abbr: 'Id', hand: 'left'  as const },
  { index: 7, label: 'Medio',   abbr: 'Md', hand: 'left'  as const },
  { index: 8, label: 'Anular',  abbr: 'An', hand: 'left'  as const },
  { index: 9, label: 'Meñique', abbr: 'Mñ', hand: 'left'  as const },
];

const FINGER_HEIGHTS: Record<string, string> = {
  Pulgar:  'h-14',
  Índice:  'h-18',
  Medio:   'h-20',
  Anular:  'h-17',
  Meñique: 'h-12',
};

const CAPTURE_TIMEOUT_SEC = 30;

function qualityLabel(q: number): { text: string; color: string } {
  if (q >= 80) return { text: 'Excelente', color: 'text-emerald-600' };
  if (q >= 60) return { text: 'Buena',     color: 'text-blue-600' };
  if (q >= 40) return { text: 'Regular',   color: 'text-amber-600' };
  return { text: 'Baja',      color: 'text-red-600' };
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const cfg: Record<ConnectionStatus, { icon: React.ReactNode; label: string; cls: string }> = {
    disconnected: { icon: <WifiOff size={12} />, label: 'Desconectado', cls: 'bg-gray-100 text-gray-500' },
    connecting:   { icon: <Loader2 size={12} className="animate-spin" />, label: 'Conectando…', cls: 'bg-amber-50 text-amber-600' },
    connected:    { icon: <Wifi size={12} />, label: 'Conectado', cls: 'bg-emerald-50 text-emerald-700' },
    error:        { icon: <AlertCircle size={12} />, label: 'Error', cls: 'bg-red-50 text-red-600' },
  };
  const { icon, label, cls } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      {icon} {label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FingerprintEnrollModal({
  isOpen, onClose, visitId, visitorName,
}: FingerprintEnrollModalProps) {
  const scanner = useBioMiniScanner();

  const [mode, setMode] = useState<EnrollMode>('biomini');

  // BioMini submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Suprema device state
  const [fpEnrollers, setFpEnrollers] = useState<EnrollerDevice[]>([]);
  const [enrollersLoading, setEnrollersLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [selectedFinger, setSelectedFinger] = useState<number | null>(null);
  const [deviceCaptureState, setDeviceCaptureState] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(CAPTURE_TIMEOUT_SEC);
  const [supremaEnrolledFingers, setSupremaEnrolledFingers] = useState<Map<number, SupremaEnrolledFinger>>(new Map());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset everything when modal closes
  useEffect(() => {
    if (!isOpen) {
      scanner.disconnect();
      scanner.clearAll();
      setSubmitting(false);
      setSubmitError(null);
      setSubmitSuccess(false);
      setMode('biomini');
      setSupremaEnrolledFingers(new Map());
      setSelectedDevice('');
      setSelectedFinger(null);
      setDeviceCaptureState('idle');
      setDeviceError(null);
      clearCountdown();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Load fingerprint enrollers when switching to suprema tab
  useEffect(() => {
    if (isOpen && mode === 'suprema') {
      setEnrollersLoading(true);
      api.get('/settings/enrollers?type=fingerprint')
        .then((res) => {
          const data: EnrollerDevice[] = res.data || [];
          setFpEnrollers(data);
          if (data.length > 0 && !selectedDevice) {
            setSelectedDevice(data[0].deviceId);
          }
        })
        .catch(() => setFpEnrollers([]))
        .finally(() => setEnrollersLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  const clearCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const startCountdown = (onTimeout: () => void) => {
    setCountdown(CAPTURE_TIMEOUT_SEC);
    clearCountdown();
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearCountdown();
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // BioMini finger click handler
  const handleFingerClick = useCallback((fingerIndex: number) => {
    if (scanner.connectionStatus !== 'connected') return;
    if (scanner.captureStatus === 'waiting_finger' || scanner.captureStatus === 'sample_ok') {
      scanner.cancelCapture();
      setTimeout(() => scanner.startCapture(fingerIndex), 100);
    } else {
      scanner.startCapture(fingerIndex);
    }
  }, [scanner]);

  // Suprema device capture handler
  const handleDeviceCapture = useCallback(async () => {
    if (!selectedDevice || selectedFinger === null) return;
    setDeviceCaptureState('waiting');
    setDeviceError(null);

    startCountdown(() => {
      setDeviceCaptureState('error');
      setDeviceError('Tiempo de captura agotado. Intente de nuevo.');
    });

    try {
      const response = await api.post(
        `/devices/${selectedDevice}/scan-fingerprint-credential`,
        { fingerIndex: selectedFinger },
        { timeout: 35000 },
      );
      clearCountdown();

      const templateBase64: string = response.data?.template || response.data?.templateBase64;
      const quality: number = response.data?.quality ?? 0;

      if (!templateBase64) throw new Error('Respuesta sin datos de plantilla');

      setSupremaEnrolledFingers((prev) => {
        const next = new Map(prev);
        next.set(selectedFinger, {
          fingerIndex: selectedFinger,
          template: templateBase64,
          quality,
          source: 'suprema',
        });
        return next;
      });
      setDeviceCaptureState('success');
    } catch (err: any) {
      clearCountdown();
      const msg = err.response?.data?.message || err.message || 'Error al capturar desde el dispositivo';
      setDeviceCaptureState('error');
      setDeviceError(msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, selectedFinger]);

  const handleRetryDevice = () => {
    setDeviceCaptureState('idle');
    setDeviceError(null);
    clearCountdown();
  };

  const removeSupramaFinger = (fingerIndex: number) => {
    setSupremaEnrolledFingers((prev) => {
      const next = new Map(prev);
      next.delete(fingerIndex);
      return next;
    });
  };

  // Submit: merges BioMini + Suprema fingers
  const handleSubmit = useCallback(async () => {
    if (!visitId) return;

    const bioMiniFingers = Array.from(scanner.enrolledFingers.values()).map(f => ({
      fingerIndex: f.fingerIndex,
      template: f.template,
      samples: f.samples,
      quality: f.quality,
    }));

    const supremaFingers = Array.from(supremaEnrolledFingers.values()).map(f => ({
      fingerIndex: f.fingerIndex,
      template: f.template,
      samples: [],
      quality: f.quality,
    }));

    const fingerprints = [...bioMiniFingers, ...supremaFingers];
    if (fingerprints.length === 0) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      await api.post(`/visitors/visit/${visitId}/fingerprints`, { fingerprints });
      setSubmitSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setSubmitError(
        err?.response?.data?.message ?? 'Error al enviar huellas a BioStar. Intenta de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [visitId, scanner.enrolledFingers, supremaEnrolledFingers, onClose]);

  if (!isOpen) return null;

  const bioMiniCount = scanner.enrolledFingers.size;
  const supremaCount = supremaEnrolledFingers.size;
  const totalEnrolled = bioMiniCount + supremaCount;
  const isCapturing = scanner.captureStatus === 'waiting_finger' || scanner.captureStatus === 'sample_ok';

  const leftFingers  = FINGER_DEFS.filter(f => f.hand === 'left').reverse();
  const rightFingers = FINGER_DEFS.filter(f => f.hand === 'right');

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[95vh]">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#a12944]/10 flex items-center justify-center">
              <Fingerprint size={18} className="text-[#a12944]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Enrolamiento de Huellas Dactilares</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {mode === 'biomini' ? 'Suprema BioMini Slim 2' : 'Dispositivo Suprema BioStar'}
                {visitorName && <> · <span className="font-semibold text-gray-500">{visitorName}</span></>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* ── Mode tabs ──────────────────────────────────────────────────── */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          <button
            onClick={() => { setMode('biomini'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
              mode === 'biomini'
                ? 'border-[#a12944] text-[#a12944] bg-[#a12944]/5'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            <Wifi size={14} />
            Escáner BioMini
          </button>
          <button
            onClick={() => { setMode('suprema'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
              mode === 'suprema'
                ? 'border-[#a12944] text-[#a12944] bg-[#a12944]/5'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            <Cpu size={14} />
            Dispositivo Suprema
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 p-6 flex flex-col gap-5">

          {/* ═══════════════════ BIOMINI TAB ═══════════════════ */}
          {mode === 'biomini' && (
            <>
              {/* Connection panel */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-gray-50">
                <div className="flex items-center gap-3">
                  <ConnectionBadge status={scanner.connectionStatus} />
                  {scanner.deviceInfo && (
                    <span className="text-xs text-gray-500">
                      {scanner.deviceInfo.deviceModel}
                      {scanner.deviceInfo.serialNumber && ` · S/N: ${scanner.deviceInfo.serialNumber}`}
                    </span>
                  )}
                  {scanner.connectionStatus === 'error' && scanner.lastError && (
                    <span className="text-xs text-red-500 max-w-xs truncate">{scanner.lastError}</span>
                  )}
                </div>
                {scanner.connectionStatus === 'disconnected' || scanner.connectionStatus === 'error' ? (
                  <button
                    onClick={scanner.connect}
                    className="px-4 py-1.5 rounded-lg bg-[#a12944] text-white text-xs font-bold hover:bg-[#8b1f35] transition-colors"
                  >
                    Conectar escáner
                  </button>
                ) : scanner.connectionStatus === 'connected' ? (
                  <button
                    onClick={scanner.disconnect}
                    className="px-4 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-100 transition-colors"
                  >
                    Desconectar
                  </button>
                ) : null}
              </div>

              <p className="text-xs text-gray-500 text-center -mb-1">
                Conecta el escáner, luego haz clic en el dedo que deseas enrolar. Se requerirán <strong>3 capturas</strong> del mismo dedo.
              </p>

              {/* Hand diagram */}
              <HandDiagram
                leftFingers={leftFingers}
                rightFingers={rightFingers}
                getEnrolled={(i) => scanner.enrolledFingers.get(i)}
                currentFinger={scanner.currentFinger}
                captureStatus={scanner.captureStatus}
                disabled={scanner.connectionStatus !== 'connected'}
                isCapturing={isCapturing}
                onFingerClick={handleFingerClick}
                onClearFinger={(i) => scanner.clearFinger(i)}
                selectedFinger={null}
                onSelectFinger={() => {}}
                selectMode={false}
                supremaEnrolledFingers={new Map()}
              />

              {/* Live capture feedback */}
              {isCapturing && scanner.currentFinger !== null && (
                <CaptureFeedback
                  finger={FINGER_DEFS.find(f => f.index === scanner.currentFinger)!}
                  sampleCount={scanner.sampleCount}
                  quality={scanner.quality}
                  captureStatus={scanner.captureStatus}
                  onCancel={scanner.cancelCapture}
                />
              )}

              {scanner.captureStatus === 'complete' && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">
                  <CheckCircle2 size={16} />
                  Huella enrolada correctamente. Selecciona otro dedo o envía las huellas.
                </div>
              )}

              {scanner.captureStatus === 'error' && scanner.lastError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <span>{scanner.lastError}</span>
                  <button
                    onClick={() => scanner.currentFinger !== null && scanner.startCapture(scanner.currentFinger)}
                    className="ml-auto text-xs font-bold underline"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {/* BioMini enrolled summary */}
              {bioMiniCount > 0 && (
                <EnrolledSummary
                  title="Huellas (BioMini)"
                  fingers={Array.from(scanner.enrolledFingers.values()).map(f => ({
                    fingerIndex: f.fingerIndex,
                    quality: f.quality,
                    source: 'biomini' as const,
                  }))}
                  onClear={(i) => scanner.clearFinger(i)}
                  onClearAll={scanner.clearAll}
                />
              )}
            </>
          )}

          {/* ═══════════════════ SUPREMA DEVICE TAB ═══════════════════ */}
          {mode === 'suprema' && (
            <>
              {enrollersLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
                  <p className="text-sm text-gray-400">Cargando dispositivos enroladores…</p>
                </div>
              ) : fpEnrollers.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                  <Cpu className="w-12 h-12 text-gray-200" />
                  <p className="text-sm font-semibold text-gray-500">Sin dispositivos enroladores de huella configurados</p>
                  <p className="text-xs text-gray-400">Configure enroladores en Ajustes → Dispositivos Enroladores</p>
                  <Link href="/dashboard/settings/enrollers" className="mt-1 text-xs text-[#a12944] hover:underline font-semibold">
                    Configurar dispositivos
                  </Link>
                </div>
              ) : (
                <>
                  {/* Hint */}
                  <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Cpu size={15} className="text-violet-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-violet-800 leading-relaxed">
                        Selecciona el dispositivo, elige el dedo a enrolar y pulsa <strong>Activar dispositivo</strong>. El visitante deberá colocar el dedo en el lector dentro de los próximos {CAPTURE_TIMEOUT_SEC} segundos.
                      </p>
                    </div>
                  </div>

                  {/* Device selector */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Dispositivo enrolador:</label>
                    <div className="space-y-2">
                      {fpEnrollers.map((enroller) => (
                        <button
                          key={enroller.deviceId}
                          onClick={() => setSelectedDevice(enroller.deviceId)}
                          disabled={deviceCaptureState === 'waiting'}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                            selectedDevice === enroller.deviceId
                              ? 'border-[#a12944] bg-[#a12944]/5'
                              : 'border-gray-200 hover:border-gray-300 bg-white'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            selectedDevice === enroller.deviceId ? 'bg-[#a12944]/10' : 'bg-gray-100'
                          }`}>
                            <Cpu className={`w-4 h-4 ${selectedDevice === enroller.deviceId ? 'text-[#a12944]' : 'text-gray-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold truncate ${selectedDevice === enroller.deviceId ? 'text-[#a12944]' : 'text-gray-900'}`}>
                              {enroller.deviceName}
                            </p>
                            <p className="text-[11px] text-gray-400">
                              {enroller.typeName} · ID {enroller.deviceId}
                            </p>
                          </div>
                          {selectedDevice === enroller.deviceId && (
                            <CheckCircle2 className="w-4 h-4 text-[#a12944] flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Finger selector — simple click to select */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-3">
                      Selecciona el dedo a enrolar:
                      {selectedFinger !== null && (
                        <span className="ml-2 font-normal text-[#a12944]">
                          {FINGER_DEFS[selectedFinger].hand === 'right' ? 'Derecho' : 'Izquierdo'} — {FINGER_DEFS[selectedFinger].label}
                        </span>
                      )}
                    </label>

                    <HandDiagram
                      leftFingers={leftFingers}
                      rightFingers={rightFingers}
                      getEnrolled={() => undefined}
                      currentFinger={null}
                      captureStatus="idle"
                      disabled={deviceCaptureState === 'waiting'}
                      isCapturing={false}
                      onFingerClick={() => {}}
                      onClearFinger={() => {}}
                      selectedFinger={selectedFinger}
                      onSelectFinger={(i) => {
                        if (deviceCaptureState !== 'waiting') setSelectedFinger(i);
                      }}
                      selectMode={true}
                      supremaEnrolledFingers={supremaEnrolledFingers}
                    />
                  </div>

                  {/* Capture state feedback */}
                  {deviceCaptureState === 'waiting' && (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <div className="absolute inset-0 rounded-full border-4 border-[#a12944]/20" />
                        <div className="absolute inset-0 rounded-full border-4 border-[#a12944] border-t-transparent animate-spin" style={{ animationDuration: '1.5s' }} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Fingerprint className="w-7 h-7 text-[#a12944]" />
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">Esperando huella…</p>
                        <p className="text-xs text-gray-500 mt-1">El visitante debe colocar el dedo en el lector del dispositivo</p>
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full">
                        <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        <span className="text-sm font-bold text-amber-700">Tiempo restante: {countdown}s</span>
                      </div>
                    </div>
                  )}

                  {deviceCaptureState === 'success' && (
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">
                      <CheckCircle2 size={16} />
                      Huella capturada desde el dispositivo. Selecciona otro dedo o envía las huellas.
                    </div>
                  )}

                  {deviceCaptureState === 'error' && (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                      <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-red-500" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">Error al capturar</p>
                        <p className="text-xs text-gray-500 mt-1 max-w-xs">{deviceError}</p>
                      </div>
                      <button
                        onClick={handleRetryDevice}
                        className="flex items-center gap-2 px-5 py-2 bg-[#a12944] text-white text-sm font-bold rounded-xl hover:bg-[#8b1f35] transition-colors"
                      >
                        <RotateCcw size={14} /> Intentar de nuevo
                      </button>
                    </div>
                  )}

                  {/* Activate button */}
                  {deviceCaptureState === 'idle' || deviceCaptureState === 'success' ? (
                    <button
                      onClick={() => { setDeviceCaptureState('idle'); handleDeviceCapture(); }}
                      disabled={!selectedDevice || selectedFinger === null}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-[#a12944] text-white font-bold rounded-xl hover:bg-[#8b1f35] disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-[#a12944]/20 transition-all"
                    >
                      <Play className="w-4 h-4" />
                      Activar dispositivo
                    </button>
                  ) : null}

                  {/* Suprema enrolled summary */}
                  {supremaCount > 0 && (
                    <EnrolledSummary
                      title="Huellas (Dispositivo Suprema)"
                      fingers={Array.from(supremaEnrolledFingers.values()).map(f => ({
                        fingerIndex: f.fingerIndex,
                        quality: f.quality,
                        source: 'suprema' as const,
                      }))}
                      onClear={removeSupramaFinger}
                      onClearAll={() => setSupremaEnrolledFingers(new Map())}
                    />
                  )}
                </>
              )}
            </>
          )}

          {/* ── Shared enrolled totals & compliance ───────────────────── */}
          {totalEnrolled > 0 && mode === 'suprema' && supremaCount === 0 && (
            <div className="text-xs text-gray-400 text-center">
              {bioMiniCount} huella{bioMiniCount !== 1 ? 's' : ''} enrolada{bioMiniCount !== 1 ? 's' : ''} en pestaña BioMini
            </div>
          )}

          {/* Compliance notice */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-50 border border-blue-100">
            <AlertCircle size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              <strong>LGPD / GDPR:</strong> Solo se almacena la plantilla matemática de la huella en BioStar.
              Ninguna imagen biométrica es guardada en BioVisitor X.
            </p>
          </div>

          {/* Submit feedback */}
          {submitError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              <AlertCircle size={15} className="flex-shrink-0" />
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold">
              <CheckCircle2 size={15} />
              Huellas enviadas a BioStar exitosamente. Cerrando…
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-white flex-shrink-0">
          <span className="text-xs text-gray-400">
            {totalEnrolled === 0
              ? 'No hay huellas enroladas'
              : `${totalEnrolled} huella${totalEnrolled > 1 ? 's' : ''} lista${totalEnrolled > 1 ? 's' : ''} para enviar`}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={totalEnrolled === 0 || submitting || submitSuccess}
              className="flex items-center gap-2 px-5 py-2 bg-[#a12944] text-white text-sm font-bold rounded-xl hover:bg-[#8b1f35] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> Enviando…</>
                : <><Send size={15} /> Enviar a BioStar ({totalEnrolled})</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface HandDiagramProps {
  leftFingers: typeof FINGER_DEFS;
  rightFingers: typeof FINGER_DEFS;
  getEnrolled: (i: number) => { quality: number } | undefined;
  currentFinger: number | null;
  captureStatus: CaptureStatus | 'idle';
  disabled: boolean;
  isCapturing: boolean;
  onFingerClick: (i: number) => void;
  onClearFinger: (i: number) => void;
  selectedFinger: number | null;
  onSelectFinger: (i: number) => void;
  selectMode: boolean;
  supremaEnrolledFingers: Map<number, SupremaEnrolledFinger>;
}

function HandDiagram({
  leftFingers, rightFingers, getEnrolled, currentFinger, captureStatus,
  disabled, isCapturing, onFingerClick, onClearFinger,
  selectedFinger, onSelectFinger, selectMode, supremaEnrolledFingers,
}: HandDiagramProps) {
  const allFingers = [...leftFingers, ...rightFingers];
  return (
    <div className="flex items-end justify-center gap-1 select-none">
      <div className="flex flex-col items-center gap-2 mr-4">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest rotate-90 sm:rotate-0 whitespace-nowrap">
          Mano Izquierda
        </span>
      </div>
      <div className="flex items-end gap-1.5">
        {leftFingers.map(finger => {
          const enrolled = getEnrolled(finger.index);
          const supremaEnrolled = supremaEnrolledFingers.get(finger.index);
          const isActive = currentFinger === finger.index;
          const isSampleOk = isActive && captureStatus === 'sample_ok';
          const isSelected = selectMode && selectedFinger === finger.index;
          return (
            <FingerButton
              key={finger.index}
              finger={finger}
              enrolled={!!enrolled || !!supremaEnrolled}
              quality={enrolled?.quality ?? supremaEnrolled?.quality}
              isActive={isActive}
              isSampleOk={isSampleOk}
              isCapturing={isCapturing}
              disabled={disabled}
              onClick={selectMode ? () => onSelectFinger(finger.index) : () => onFingerClick(finger.index)}
              onClear={selectMode ? () => {} : () => onClearFinger(finger.index)}
              isSelected={isSelected}
              selectMode={selectMode}
              showClear={!selectMode && !!enrolled}
            />
          );
        })}
      </div>
      <div className="w-6 flex-shrink-0 self-stretch flex items-end pb-1">
        <div className="w-full h-8 border-l-2 border-r-2 border-b-2 border-gray-200 rounded-b-lg" />
      </div>
      <div className="flex items-end gap-1.5">
        {rightFingers.map(finger => {
          const enrolled = getEnrolled(finger.index);
          const supremaEnrolled = supremaEnrolledFingers.get(finger.index);
          const isActive = currentFinger === finger.index;
          const isSampleOk = isActive && captureStatus === 'sample_ok';
          const isSelected = selectMode && selectedFinger === finger.index;
          return (
            <FingerButton
              key={finger.index}
              finger={finger}
              enrolled={!!enrolled || !!supremaEnrolled}
              quality={enrolled?.quality ?? supremaEnrolled?.quality}
              isActive={isActive}
              isSampleOk={isSampleOk}
              isCapturing={isCapturing}
              disabled={disabled}
              onClick={selectMode ? () => onSelectFinger(finger.index) : () => onFingerClick(finger.index)}
              onClear={selectMode ? () => {} : () => onClearFinger(finger.index)}
              isSelected={isSelected}
              selectMode={selectMode}
              showClear={!selectMode && !!enrolled}
            />
          );
        })}
      </div>
      <div className="flex flex-col items-center gap-2 ml-4">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest rotate-90 sm:rotate-0 whitespace-nowrap">
          Mano Derecha
        </span>
      </div>
    </div>
  );
}

interface FingerButtonProps {
  finger: typeof FINGER_DEFS[0];
  enrolled: boolean;
  quality?: number;
  isActive: boolean;
  isSampleOk: boolean;
  isCapturing: boolean;
  disabled: boolean;
  onClick: () => void;
  onClear: () => void;
  isSelected: boolean;
  selectMode: boolean;
  showClear: boolean;
}

function FingerButton({
  finger, enrolled, quality, isActive, isSampleOk,
  isCapturing, disabled, onClick, onClear,
  isSelected, selectMode, showClear,
}: FingerButtonProps) {
  const heightCls = FINGER_HEIGHTS[finger.label] ?? 'h-14';

  let bg = 'bg-gray-100 border-gray-200';
  let text = 'text-gray-500';

  if (enrolled) {
    bg = 'bg-emerald-50 border-emerald-300';
    text = 'text-emerald-700';
  }
  if (isActive && !isSampleOk) {
    bg = 'bg-amber-100 border-amber-400 animate-pulse';
    text = 'text-amber-700';
  }
  if (isSampleOk) {
    bg = 'bg-emerald-100 border-emerald-500';
    text = 'text-emerald-700';
  }
  if (selectMode && isSelected) {
    bg = 'bg-[#a12944]/10 border-[#a12944]';
    text = 'text-[#a12944]';
  }
  if (disabled && !enrolled && !isActive && !isSelected) {
    bg = 'bg-gray-50 border-gray-150';
    text = 'text-gray-300';
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        disabled={disabled && !isCapturing && !selectMode}
        title={`${finger.hand === 'right' ? 'Derecho' : 'Izquierdo'} — ${finger.label}`}
        className={`w-10 ${heightCls} rounded-t-full rounded-b-sm border-2 transition-all relative flex flex-col items-center justify-end pb-1 ${bg} ${!disabled || selectMode ? 'hover:border-[#a12944] hover:shadow-md cursor-pointer' : 'cursor-not-allowed'}`}
      >
        {enrolled && !isActive && !isSelected && (
          <CheckCircle2 size={10} className="text-emerald-500 absolute top-1.5" />
        )}
        {isActive && !selectMode && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={12} className={`${text} animate-spin`} />
          </div>
        )}
        {isSelected && (
          <div className="absolute top-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#a12944]" />
          </div>
        )}
        <span className={`text-[9px] font-bold ${text}`}>{finger.abbr}</span>
      </button>
      {enrolled && quality !== undefined && (
        <span className={`text-[9px] font-bold ${qualityLabel(quality).color}`}>{quality}</span>
      )}
      {showClear && (
        <button
          onClick={e => { e.stopPropagation(); onClear(); }}
          className="text-gray-300 hover:text-red-400 transition-colors"
          title="Eliminar huella"
        >
          <Trash2 size={9} />
        </button>
      )}
    </div>
  );
}

interface EnrolledSummaryProps {
  title: string;
  fingers: Array<{ fingerIndex: number; quality: number; source: 'biomini' | 'suprema' }>;
  onClear: (i: number) => void;
  onClearAll: () => void;
}

function EnrolledSummary({ title, fingers, onClear, onClearAll }: EnrolledSummaryProps) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
          {title} — {fingers.length} / 10
        </p>
        <button
          onClick={onClearAll}
          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 font-semibold"
        >
          <Trash2 size={11} /> Borrar todo
        </button>
      </div>
      <div className="divide-y divide-gray-50">
        {fingers.map(f => {
          const def = FINGER_DEFS.find(d => d.index === f.fingerIndex)!;
          const ql = qualityLabel(f.quality);
          return (
            <div key={f.fingerIndex} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-800">
                  {def.hand === 'right' ? 'Derecho' : 'Izquierdo'} — {def.label}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-20 h-1.5 rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{ width: `${f.quality}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold ${ql.color}`}>{f.quality}</span>
                </div>
                <button
                  onClick={() => onClear(f.fingerIndex)}
                  className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded"
                  title="Eliminar esta huella"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface CaptureFeedbackProps {
  finger: typeof FINGER_DEFS[0];
  sampleCount: number;
  quality: number;
  captureStatus: CaptureStatus;
  onCancel: () => void;
}

function CaptureFeedback({ finger, sampleCount, quality, captureStatus, onCancel }: CaptureFeedbackProps) {
  const ql = quality > 0 ? qualityLabel(quality) : null;
  const handLabel = finger.hand === 'right' ? 'Derecho' : 'Izquierdo';
  const REQUIRED_SAMPLES = 3;

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-amber-200 flex items-center justify-center">
            <Fingerprint size={14} className="text-amber-700" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-900">
              Enrolando: {handLabel} — {finger.label}
            </p>
            <p className="text-xs text-amber-600">
              {captureStatus === 'sample_ok'
                ? `Muestra ${sampleCount}/${REQUIRED_SAMPLES} capturada — levanta el dedo y vuelve a colocarlo`
                : `Coloca el dedo en el escáner (${sampleCount}/${REQUIRED_SAMPLES})`}
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-amber-600 hover:text-amber-800 text-xs font-semibold underline"
        >
          Cancelar
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-amber-700 font-semibold w-20">Capturas:</span>
        <div className="flex gap-2">
          {Array.from({ length: REQUIRED_SAMPLES }).map((_, i) => (
            <div
              key={i}
              className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                i < sampleCount
                  ? 'bg-emerald-400 border-emerald-500 text-white'
                  : 'bg-white border-amber-200 text-amber-300'
              }`}
            >
              {i < sampleCount ? (
                <CheckCircle2 size={12} />
              ) : (
                <span className="text-[10px] font-bold">{i + 1}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {quality > 0 && ql && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-700 font-semibold w-20">Calidad:</span>
          <div className="flex-1 h-2 bg-amber-100 rounded-full">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${quality}%`,
                backgroundColor: quality >= 80 ? '#10b981' : quality >= 60 ? '#3b82f6' : quality >= 40 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
          <span className={`text-xs font-bold min-w-[2rem] ${ql.color}`}>{quality}</span>
          <span className={`text-xs font-semibold ${ql.color}`}>{ql.text}</span>
        </div>
      )}
    </div>
  );
}
