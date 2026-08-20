'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import Link from 'next/link';
import {
  Camera,
  X,
  RotateCcw,
  Check,
  Loader2,
  AlertCircle,
  Info,
  XCircle,
  Cpu,
  Play,
  Clock,
  Radio,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';
import { ensureFaceApiLoaded, analyzeFaceQuality, type FaceQualityIssue } from '@/lib/face-quality';

interface FaceCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (imageDataUrl: string) => void;
}

type CaptureMode = 'webcam' | 'device';
type CaptureState = 'idle' | 'analyzing' | 'preview' | 'validating' | 'validated' | 'rejected';
type DeviceState = 'idle' | 'waiting' | 'error';

interface EnrollerDevice {
  deviceId: string;
  deviceName: string;
  typeName: string;
  type: 'face' | 'fingerprint' | 'card';
  addedAt: string;
}

const MAX_IMAGE_SIZE_MB = 10;
const CAPTURE_TIMEOUT_SEC = 30;

export default function FaceCaptureModal({ isOpen, onClose, onCapture }: FaceCaptureModalProps) {
  const webcamRef = useRef<Webcam>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { t } = useI18n();

  const [mode, setMode] = useState<CaptureMode>('webcam');

  const [captureState, setCaptureState] = useState<CaptureState>('idle');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [issues, setIssues] = useState<FaceQualityIssue[]>([]);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);

  const [faceEnrollers, setFaceEnrollers] = useState<EnrollerDevice[]>([]);
  const [enrollersLoading, setEnrollersLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [deviceState, setDeviceState] = useState<DeviceState>('idle');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(CAPTURE_TIMEOUT_SEC);
  const [livePreviewPhoto, setLivePreviewPhoto] = useState<string | null>(null);
  const livePreviewPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [deviceCaptureQuality, setDeviceCaptureQuality] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && !modelsReady) {
      setModelsLoading(true);
      ensureFaceApiLoaded()
        .then(() => { setModelsReady(true); setModelsLoading(false); })
        .catch((err) => { console.error('Failed to load face detection models:', err); setModelsLoading(false); });
    }
  }, [isOpen, modelsReady]);

  useEffect(() => {
    if (!isOpen) {
      setCaptureState('idle');
      setCapturedImage(null);
      setIssues([]);
      setMode('webcam');
      setDeviceState('idle');
      setDeviceError(null);
      setLivePreviewPhoto(null);
      setDeviceCaptureQuality(null);
      clearCountdown();
      stopLivePreviewPoll();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && mode === 'device') {
      setEnrollersLoading(true);
      api.get('/settings/enrollers?type=face')
        .then((res) => {
          const data: EnrollerDevice[] = res.data || [];
          setFaceEnrollers(data);
          if (data.length > 0 && !selectedDevice) {
            setSelectedDevice(data[0].deviceId);
          }
        })
        .catch(() => setFaceEnrollers([]))
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

  const stopLivePreviewPoll = () => {
    if (livePreviewPollRef.current) {
      clearInterval(livePreviewPollRef.current);
      livePreviewPollRef.current = null;
    }
  };

  useEffect(() => {
    if (deviceState === 'waiting' && selectedDevice) {
      setLivePreviewPhoto(null);

      const doPoll = async () => {
        try {
          const res = await api.get(`/devices/${selectedDevice}/latest-event-photo`, { timeout: 6000 });
          const photo: string | null = res.data?.photoBase64 ?? null;
          if (photo) {
            setLivePreviewPhoto(photo);
          }
        } catch {
          // silent — preview is best-effort
        }
      };

      doPoll();
      livePreviewPollRef.current = setInterval(doPoll, 2500);
    } else {
      stopLivePreviewPoll();
      if (deviceState !== 'waiting') {
        setLivePreviewPhoto(null);
      }
    }

    return () => {
      stopLivePreviewPoll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceState, selectedDevice]);

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

  const handleActivateDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setDeviceState('waiting');
    setDeviceError(null);

    startCountdown(() => {
      setDeviceState('error');
      setDeviceError(t('face.deviceTimeout'));
    });

    try {
      // GET /scan-face-credential: misma API que el enrolamiento de credencial facial.
      // Llama a GET /api/devices/:id/credentials/face en BioStar — funciona en remoto
      // (ngrok/internet), no requiere LAN. Devuelve template_ex_normalized_image que
      // es la foto normalizada del rostro, lista para usarse como foto de perfil.
      const response = await api.get(
        `/devices/${selectedDevice}/scan-face-credential`,
        { timeout: 40000 },
      );
      clearCountdown();

      const imageBase64: string =
        response.data?.template_ex_normalized_image ||
        response.data?.imageBase64 ||
        response.data?.image;
      if (!imageBase64) throw new Error('El dispositivo no devolvió imagen del rostro');

      const quality: number | undefined = response.data?.quality;
      setDeviceCaptureQuality(typeof quality === 'number' ? quality : null);

      const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
      setCapturedImage(dataUrl);
      setDeviceState('idle');
      setMode('webcam');
      setIssues([]);
      setCaptureState('preview');
    } catch (err: any) {
      clearCountdown();
      const msg = err.response?.data?.message || err.message || t('face.deviceError');
      setDeviceState('error');
      setDeviceError(msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, t]);

  const capture = useCallback(async () => {
    if (!webcamRef.current) return;
    const imageSrc = webcamRef.current.getScreenshot({ width: 640, height: 480 });
    if (!imageSrc) return;

    const base64 = imageSrc.replace(/^data:image\/\w+;base64,/, '');
    const sizeBytes = Math.ceil(base64.length * 0.75);
    if (sizeBytes / (1024 * 1024) > MAX_IMAGE_SIZE_MB) {
      setIssues([{ code: 'SIZE', message: t('face.errorSize'), severity: 'error' }]);
      setCaptureState('rejected');
      return;
    }

    setCapturedImage(imageSrc);
    setCaptureState('analyzing');
    setIssues([]);

    try {
      const result = await analyzeFaceQuality(imageSrc);
      if (result.passed) {
        setIssues([]);
        setCaptureState('preview');
      } else {
        setIssues(result.issues);
        setCaptureState('rejected');
      }
    } catch (err) {
      console.error('Face analysis error:', err);
      setIssues([{ code: 'ANALYSIS_ERROR', message: t('face.errorAnalysis'), severity: 'error' }]);
      setCaptureState('rejected');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setCaptureState('idle');
    setIssues([]);
    setDeviceState('idle');
    setDeviceError(null);
    setLivePreviewPhoto(null);
    setDeviceCaptureQuality(null);
    stopLivePreviewPoll();
    clearCountdown();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateAndAccept = useCallback(async () => {
    if (!capturedImage) return;
    setCaptureState('validating');
    try {
      const response = await api.post('/visitors/validate-face', { imageBase64: capturedImage });
      if (response.data.valid) {
        setCaptureState('validated');
        setTimeout(() => { onCapture(capturedImage); }, 600);
      }
    } catch (err: any) {
      if (err.response?.status === 400) {
        setIssues([{ code: 'BIOSTAR_REJECTED', message: err.response.data.message || t('face.errorBiostar'), severity: 'error' }]);
        setCaptureState('rejected');
      } else if (err.response?.status === 401) {
        setIssues([{ code: 'SESSION_EXPIRED', message: t('face.errorSession'), severity: 'error' }]);
        setCaptureState('rejected');
      } else {
        setIssues([{ code: 'VALIDATION_ERROR', message: t('face.errorValidation'), severity: 'error' }]);
        setCaptureState('rejected');
      }
    }
  }, [capturedImage, onCapture, t]);

  const toggleCamera = useCallback(() => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  }, []);

  if (!isOpen) return null;

  const videoConstraints = { width: 640, height: 480, facingMode };
  const errorIssues = issues.filter(i => i.severity === 'error');

  const showDevicePanel = mode === 'device' && captureState === 'idle';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-suprema-gray-900/80 backdrop-blur-md">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">

        <div className="flex justify-between items-center p-5 border-b border-suprema-gray-100">
          <div>
            <h3 className="text-lg font-bold text-suprema-gray-900">{t('face.title')}</h3>
            <p className="text-xs text-suprema-gray-800/60 mt-0.5">
              {captureState === 'idle' && mode === 'webcam' && t('face.positionFace')}
              {captureState === 'idle' && mode === 'device' && t('face.deviceSubtitle')}
              {captureState === 'analyzing' && t('face.analyzing')}
              {captureState === 'preview' && t('face.allPassed')}
              {captureState === 'validating' && t('face.validating')}
              {captureState === 'validated' && t('face.validated')}
              {captureState === 'rejected' && t('face.issuesFound', { count: errorIssues.length, plural: errorIssues.length !== 1 ? 's' : '' })}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-suprema-gray-800/40 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        {captureState === 'idle' && (
          <div className="flex border-b border-suprema-gray-100">
            <button
              onClick={() => { setMode('webcam'); setDeviceState('idle'); setDeviceError(null); clearCountdown(); }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                mode === 'webcam'
                  ? 'border-suprema-burgundy text-suprema-burgundy bg-suprema-burgundy/5'
                  : 'border-transparent text-suprema-gray-800/50 hover:text-suprema-gray-800 hover:bg-suprema-gray-50'
              }`}
            >
              <Camera size={15} />
              {t('face.modeWebcam')}
            </button>
            <button
              onClick={() => setMode('device')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                mode === 'device'
                  ? 'border-suprema-burgundy text-suprema-burgundy bg-suprema-burgundy/5'
                  : 'border-transparent text-suprema-gray-800/50 hover:text-suprema-gray-800 hover:bg-suprema-gray-50'
              }`}
            >
              <Cpu size={15} />
              {t('face.modeDevice')}
            </button>
          </div>
        )}

        <div className="p-5 overflow-y-auto flex-1">
          {showDevicePanel ? (
            <DevicePanel
              t={t}
              enrollersLoading={enrollersLoading}
              faceEnrollers={faceEnrollers}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              deviceState={deviceState}
              deviceError={deviceError}
              countdown={countdown}
              livePreviewPhoto={livePreviewPhoto}
              onActivate={handleActivateDevice}
              onRetry={retake}
              onSwitchToWebcam={() => { setMode('webcam'); setDeviceState('idle'); setDeviceError(null); clearCountdown(); }}
            />
          ) : (
            <>
              {captureState === 'idle' && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-blue-800 space-y-1">
                      <p className="font-semibold">{t('face.requirements')}</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>{t('face.reqLookCamera')}</li>
                        <li>{t('face.reqShoulders')}</li>
                        <li>{t('face.reqDistance')}</li>
                        <li>{t('face.reqEyesOpen')}</li>
                        <li>{t('face.reqNeutral')}</li>
                        <li>{t('face.reqForehead')}</li>
                        <li>{t('face.reqNoAccessories')}</li>
                        <li>{t('face.reqAlone')}</li>
                        <li>{t('face.reqLighting')}</li>
                        <li>{t('face.reqGlasses')}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="relative bg-suprema-gray-900 rounded-xl overflow-hidden aspect-[4/3] flex items-center justify-center">
                {captureState === 'idle' && (
                  <>
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      screenshotFormat="image/jpeg"
                      screenshotQuality={0.92}
                      videoConstraints={videoConstraints}
                      mirrored={facingMode === 'user'}
                      className="w-full h-full object-cover"
                      onUserMediaError={() => {
                        setIssues([{ code: 'CAMERA_ERROR', message: t('face.errorCamera'), severity: 'error' }]);
                        setCaptureState('rejected');
                      }}
                    />
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid slice">
                      <defs>
                        <mask id="faceMask">
                          <rect width="640" height="480" fill="white" />
                          <ellipse cx="320" cy="220" rx="120" ry="160" fill="black" />
                        </mask>
                      </defs>
                      <rect width="640" height="480" fill="rgba(0,0,0,0.45)" mask="url(#faceMask)" />
                      <ellipse cx="320" cy="220" rx="120" ry="160" fill="none" stroke="#B42940" strokeWidth="2.5" strokeDasharray="8 4" className="animate-pulse" />
                    </svg>
                    <button onClick={toggleCamera} className="absolute top-3 right-3 p-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full text-white transition-colors" title={t('face.switchCamera')}>
                      <RotateCcw size={16} />
                    </button>
                    {modelsLoading && (
                      <div className="absolute bottom-3 left-3 px-3 py-1 bg-black/60 rounded-full flex items-center gap-2">
                        <Loader2 className="w-3 h-3 text-white animate-spin" />
                        <span className="text-white text-[10px]">{t('face.loadingModels')}</span>
                      </div>
                    )}
                  </>
                )}

                {captureState === 'analyzing' && capturedImage && (
                  <div className="relative w-full h-full">
                    <img src={capturedImage} alt="Analyzing" className="w-full h-full object-cover" style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }} />
                    <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-10 h-10 text-white animate-spin" />
                      <span className="text-white text-sm font-medium">{t('face.analyzingQuality')}</span>
                      <span className="text-white/60 text-xs">{t('face.checkingPose')}</span>
                    </div>
                  </div>
                )}

                {(captureState === 'preview' || captureState === 'validating' || captureState === 'validated') && capturedImage && (
                  <div className="relative w-full h-full">
                    <img src={capturedImage} alt="Captured face" className="w-full h-full object-cover" />
                    {captureState === 'preview' && (
                      <div className="absolute top-3 left-3 px-3 py-1.5 bg-emerald-600/90 rounded-full flex items-center gap-1.5">
                        <Check size={14} className="text-white" />
                        <span className="text-white text-xs font-bold">{t('face.allChecksPassed')}</span>
                      </div>
                    )}
                    {captureState === 'validating' && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-10 h-10 text-white animate-spin" />
                        <span className="text-white text-sm font-medium">{t('face.validatingBiostar')}</span>
                      </div>
                    )}
                    {captureState === 'validated' && (
                      <div className="absolute inset-0 bg-emerald-900/40 flex flex-col items-center justify-center gap-3">
                        <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center animate-bounce">
                          <Check size={32} className="text-white" />
                        </div>
                        <span className="text-white text-sm font-bold">{t('face.faceValidated')}</span>
                      </div>
                    )}
                  </div>
                )}

                {captureState === 'rejected' && capturedImage && (
                  <div className="relative w-full h-full">
                    <img src={capturedImage} alt="Rejected" className="w-full h-full object-cover opacity-50" style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-red-600/90 rounded-full p-3">
                        <XCircle size={36} className="text-white" />
                      </div>
                    </div>
                  </div>
                )}

                {captureState === 'rejected' && !capturedImage && (
                  <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <AlertCircle size={40} className="text-red-400" />
                    <p className="text-white/80 text-sm">{errorIssues[0]?.message}</p>
                  </div>
                )}
              </div>

              {captureState === 'rejected' && errorIssues.length > 0 && (
                <div className="mt-3 space-y-2">
                  {errorIssues.map((issue, idx) => (
                    <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                      <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                      <p className="text-red-800 text-sm font-medium">{issue.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {captureState === 'preview' && deviceCaptureQuality !== null && (
                <div className="mt-3 p-3 bg-white border border-suprema-gray-200 rounded-lg shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-suprema-gray-800/70">{t('face.deviceQualityLabel')}</span>
                    <span className={`text-xs font-bold ${
                      deviceCaptureQuality >= 70 ? 'text-emerald-600' :
                      deviceCaptureQuality >= 40 ? 'text-amber-600' :
                      'text-red-600'
                    }`}>
                      {deviceCaptureQuality}/100 &mdash; {
                        deviceCaptureQuality >= 70 ? t('face.deviceQualityHigh') :
                        deviceCaptureQuality >= 40 ? t('face.deviceQualityMedium') :
                        t('face.deviceQualityLow')
                      }
                    </span>
                  </div>
                  <div className="w-full bg-suprema-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-700 ${
                        deviceCaptureQuality >= 70 ? 'bg-emerald-500' :
                        deviceCaptureQuality >= 40 ? 'bg-amber-500' :
                        'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(deviceCaptureQuality, 100)}%` }}
                    />
                  </div>
                  {deviceCaptureQuality < 40 && (
                    <p className="mt-1.5 text-[11px] text-red-600">{t('face.deviceQualityLowHint')}</p>
                  )}
                </div>
              )}
              {captureState === 'preview' && (
                <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Check size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-emerald-800">
                      <p className="font-semibold">{t('face.qualityPassed')}</p>
                      <p className="mt-0.5">{t('face.qualityPassedDesc')}</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-5 pt-0 flex justify-between items-center gap-3">
          {showDevicePanel ? (
            <button onClick={onClose} className="px-5 py-2.5 text-suprema-gray-700 font-semibold hover:bg-suprema-gray-100 rounded-xl transition-colors">
              {t('register.cancel')}
            </button>
          ) : captureState === 'idle' ? (
            <>
              <button onClick={onClose} className="px-5 py-2.5 text-suprema-gray-700 font-semibold hover:bg-suprema-gray-100 rounded-xl transition-colors">
                {t('register.cancel')}
              </button>
              <button
                onClick={capture}
                disabled={modelsLoading || !modelsReady}
                className="px-6 py-2.5 bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark disabled:opacity-50 shadow-md shadow-suprema-burgundy/20 transition-all flex items-center gap-2"
              >
                <Camera size={18} /> {t('face.capture')}
              </button>
            </>
          ) : captureState === 'analyzing' ? (
            <div className="w-full text-center text-sm text-suprema-gray-800/60">{t('face.runningChecks')}</div>
          ) : captureState === 'preview' ? (
            <>
              <button onClick={retake} className="px-5 py-2.5 text-suprema-gray-700 font-semibold hover:bg-suprema-gray-100 rounded-xl transition-colors flex items-center gap-2">
                <RotateCcw size={16} /> {t('face.retake')}
              </button>
              <button onClick={validateAndAccept} className="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2">
                <Check size={18} /> {t('face.acceptValidate')}
              </button>
            </>
          ) : captureState === 'validating' ? (
            <div className="w-full text-center text-sm text-suprema-gray-800/60">{t('face.validatingTemplate')}</div>
          ) : captureState === 'rejected' ? (
            <div className="w-full flex justify-center">
              <button onClick={retake} className="px-6 py-2.5 bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark shadow-md shadow-suprema-burgundy/20 transition-all flex items-center gap-2">
                <RotateCcw size={16} /> {t('face.retakePhoto')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface DevicePanelProps {
  t: (key: string, params?: Record<string, string | number>) => string;
  enrollersLoading: boolean;
  faceEnrollers: EnrollerDevice[];
  selectedDevice: string;
  setSelectedDevice: (id: string) => void;
  deviceState: DeviceState;
  deviceError: string | null;
  countdown: number;
  livePreviewPhoto: string | null;
  onActivate: () => void;
  onRetry: () => void;
  onSwitchToWebcam: () => void;
}

function DevicePanel({
  t,
  enrollersLoading,
  faceEnrollers,
  selectedDevice,
  setSelectedDevice,
  deviceState,
  deviceError,
  countdown,
  livePreviewPhoto,
  onActivate,
  onRetry,
  onSwitchToWebcam,
}: DevicePanelProps) {
  if (enrollersLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="w-8 h-8 text-suprema-gray-800/30 animate-spin" />
        <p className="text-sm text-suprema-gray-800/50">{t('enrollers.loading')}</p>
      </div>
    );
  }

  if (faceEnrollers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
        <Cpu className="w-12 h-12 text-suprema-gray-800/20" />
        <p className="text-sm font-semibold text-suprema-gray-800/60">{t('face.deviceNoEnrollers')}</p>
        <p className="text-xs text-suprema-gray-800/40">{t('face.deviceNoEnrollersHint')}</p>
        <Link href="/dashboard/settings/enrollers" className="mt-1 text-xs text-suprema-burgundy hover:underline font-semibold">
          {t('enrollers.configureLink')}
        </Link>
      </div>
    );
  }

  if (deviceState === 'waiting') {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="relative w-20 h-20 flex-shrink-0">
          <div className="absolute inset-0 rounded-full border-4 border-suprema-burgundy/20" />
          <div className="absolute inset-0 rounded-full border-4 border-suprema-burgundy border-t-transparent animate-spin" style={{ animationDuration: '1.5s' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Cpu className="w-9 h-9 text-suprema-burgundy" />
          </div>
        </div>
        <div>
          <p className="text-base font-bold text-suprema-gray-900">{t('face.deviceWaiting')}</p>
          <p className="text-xs text-suprema-gray-800/60 mt-1">{t('face.deviceWaitingHint')}</p>
        </div>

        {livePreviewPhoto ? (
          <div className="w-full rounded-xl overflow-hidden border-2 border-emerald-400 shadow-md shadow-emerald-200">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border-b border-emerald-200">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <Radio className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700">{t('face.deviceLivePreview')}</span>
              <span className="ml-auto text-[10px] text-emerald-600/70">{t('face.deviceLivePreviewHint')}</span>
            </div>
            <div className="relative aspect-[4/3] bg-suprema-gray-900">
              <img
                src={`data:image/jpeg;base64,${livePreviewPhoto}`}
                alt={t('face.deviceLivePreview')}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-black/40 to-transparent" />
            </div>
          </div>
        ) : (
          <div className="w-full rounded-xl border-2 border-dashed border-suprema-gray-200 bg-suprema-gray-50 aspect-[4/3] flex flex-col items-center justify-center gap-3 px-4">
            <div className="relative">
              <Cpu className="w-10 h-10 text-suprema-gray-800/20" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-suprema-burgundy/40 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-suprema-burgundy/60" />
              </span>
            </div>
            <p className="text-xs text-suprema-gray-800/40 leading-relaxed">
              {t('face.deviceWaitingNoPreview')}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full">
          <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm font-bold text-amber-700">
            {t('face.deviceCountdown', { sec: countdown })}
          </span>
        </div>
      </div>
    );
  }

  if (deviceState === 'error') {
    const errLower = deviceError?.toLowerCase() ?? '';
    const isLanRestriction = errLower.includes('lan') || errLower.includes('red local') ||
      errLower.includes('local network') || errLower.includes('rede local') ||
      errLower.includes('ngrok') || errLower.includes('despliegue');
    const isPermissionError = !isLanRestriction && (
      errLower.includes('permission denied') ||
      errLower.includes('permiso requerido') ||
      (errLower.includes('403') && !isLanRestriction)
    );
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8 text-center px-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <div>
          <p className="text-sm font-bold text-suprema-gray-900">{t('face.deviceError')}</p>
          <p className="text-xs text-suprema-gray-800/60 mt-1 max-w-xs">{deviceError}</p>
        </div>
        {isLanRestriction && (
          <div className="w-full p-3 bg-blue-50 border border-blue-200 rounded-xl text-left">
            <p className="text-xs font-semibold text-blue-800 mb-1">🌐 {t('face.deviceLanTitle')}</p>
            <p className="text-xs text-blue-700 leading-relaxed">{t('face.deviceLanSteps')}</p>
          </div>
        )}
        {isPermissionError && (
          <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-left">
            <p className="text-xs font-semibold text-amber-800 mb-1">⚙️ {t('face.devicePermissionTitle')}</p>
            <p className="text-xs text-amber-700 leading-relaxed">{t('face.devicePermissionSteps')}</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={onRetry}
            className="px-4 py-2 border border-suprema-gray-300 text-suprema-gray-800 font-semibold rounded-xl hover:bg-suprema-gray-50 transition-all flex items-center gap-2 text-sm"
          >
            <RotateCcw size={14} /> {t('face.deviceRetry')}
          </button>
          <button
            onClick={onSwitchToWebcam}
            className="px-4 py-2 bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark shadow-md shadow-suprema-burgundy/20 transition-all flex items-center gap-2 text-sm"
          >
            <Camera size={14} /> {t('face.useWebcam')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
        <div className="flex items-start gap-2">
          <Cpu size={15} className="text-violet-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-violet-800 leading-relaxed">
            {t('face.deviceHint', { sec: CAPTURE_TIMEOUT_SEC })}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-2">
          {t('face.deviceSelectDevice')}
        </label>
        <div className="space-y-2">
          {faceEnrollers.map((enroller) => (
            <button
              key={enroller.deviceId}
              onClick={() => setSelectedDevice(enroller.deviceId)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                selectedDevice === enroller.deviceId
                  ? 'border-suprema-burgundy bg-suprema-burgundy/5'
                  : 'border-suprema-gray-200 hover:border-suprema-gray-300 bg-white'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                selectedDevice === enroller.deviceId ? 'bg-suprema-burgundy/10' : 'bg-suprema-gray-100'
              }`}>
                <Cpu className={`w-4 h-4 ${selectedDevice === enroller.deviceId ? 'text-suprema-burgundy' : 'text-suprema-gray-800/40'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${selectedDevice === enroller.deviceId ? 'text-suprema-burgundy' : 'text-suprema-gray-900'}`}>
                  {enroller.deviceName}
                </p>
                <p className="text-[11px] text-suprema-gray-800/50">
                  {enroller.typeName} · ID {enroller.deviceId}
                </p>
              </div>
              {selectedDevice === enroller.deviceId && (
                <Check className="w-4 h-4 text-suprema-burgundy flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onActivate}
        disabled={!selectedDevice}
        className="w-full flex items-center justify-center gap-2 py-3 bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark disabled:opacity-50 shadow-md shadow-suprema-burgundy/20 transition-all"
      >
        <Play className="w-4 h-4" />
        {t('face.deviceActivate')}
      </button>
    </div>
  );
}
