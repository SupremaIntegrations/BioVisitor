'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, UploadCloud, UserCircle2, ArrowRight, ShieldCheck, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useUrlToken } from '@/lib/useUrlToken';
import { api } from '@/lib/api';

interface TokenData {
    visitId: string;
    visitorName?: string;
    hostName?: string;
    scheduledDate?: string;
}

export default function PreRegistrationPortal() {
    const token = useUrlToken();

    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [isValidating, setIsValidating] = useState(true);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [tokenData, setTokenData] = useState<TokenData | null>(null);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        documentType: 'NATIONAL_ID',
        documentNumber: '',
    });
    const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);

    useEffect(() => {
        if (!token) return;
        const validateToken = async () => {
            try {
                const response = await api.get(`/pre-registration/token/${token}`);
                setTokenData(response.data);
            } catch (error: any) {
                const msg = error.response?.data?.message || 'This pre-registration link is invalid or has expired.';
                setTokenError(msg);
            } finally {
                setIsValidating(false);
            }
        };
        validateToken();
    }, [token]);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            setIsCameraActive(true);
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => {
                        videoRef.current?.play().catch(e => console.error("Error playing video:", e));
                    };
                }
            }, 50);
        } catch (err: any) {
            const errMsg = err.name === 'NotAllowedError'
                ? "Camera access was denied. Please allow camera permissions in your browser."
                : "Could not access camera. Ensure your device has a working webcam.";
            alert(errMsg);
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            setIsCameraActive(false);
        }
    };

    const capturePhoto = useCallback(() => {
        if (videoRef.current) {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoRef.current, 0, 0);
                setPhotoDataUrl(canvas.toDataURL('image/jpeg'));
                stopCamera();
            }
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step < 3) {
            setStep(step + 1);
            return;
        }

        setIsLoading(true);
        try {
            await api.post(`/pre-registration/token/${token}/complete`, {
                firstName: formData.firstName,
                lastName: formData.lastName,
                documentType: formData.documentType,
                documentNumber: formData.documentNumber,
                photoPath: photoDataUrl ? 'captured' : undefined,
            });
            setStep(4);
        } catch (error: any) {
            console.error('Pre-registration failed:', error);
            alert(error.response?.data?.message || 'Failed to complete pre-registration. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (isValidating) {
        return (
            <div className="min-h-screen bg-suprema-gray-100 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-suprema-burgundy mx-auto mb-4" />
                    <p className="text-suprema-gray-800/60 font-medium">Validating your registration link...</p>
                </div>
            </div>
        );
    }

    if (tokenError) {
        return (
            <div className="min-h-screen bg-suprema-gray-100 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-suprema-gray-900 mb-2">Invalid Link</h2>
                    <p className="text-suprema-gray-800/60">{tokenError}</p>
                </div>
            </div>
        );
    }

    const renderSuccess = () => (
        <div className="text-center py-8">
            <div className="mx-auto w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 ring-8 ring-emerald-50">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-bold text-suprema-gray-900 mb-2">You're All Set!</h2>
            <p className="text-suprema-gray-800/70 mb-8 max-w-sm mx-auto">
                Your pre-registration is complete. Present this confirmation at the lobby for fast-track entry.
            </p>
            <div className="bg-suprema-gray-100/50 rounded-2xl p-6 border border-suprema-gray-100">
                <p className="text-sm font-semibold text-suprema-gray-900 mb-1">Visit Details</p>
                <p className="text-sm text-suprema-gray-800/60">
                    {formData.firstName} {formData.lastName}
                </p>
                <p className="text-sm text-suprema-gray-800/60">
                    Document: {formData.documentType} - {formData.documentNumber}
                </p>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-suprema-gray-100 sm:bg-suprema-gray-100 flex flex-col items-center justify-center p-0 sm:p-4">
            <div className="w-full max-w-lg bg-white sm:rounded-3xl shadow-xl shadow-suprema-gray-900/5 overflow-hidden min-h-screen sm:min-h-0 border-x sm:border border-suprema-gray-100/50">

                <div className="px-6 py-6 bg-suprema-gray-900 text-white relative overflow-hidden">
                    <div className="absolute -right-20 -top-20 w-64 h-64 bg-suprema-burgundy rounded-full blur-3xl opacity-40 mix-blend-screen" />
                    <div className="relative z-10 flex items-center justify-between pl-2">
                        <div>
                            <div className="inline-flex items-center gap-2 mb-1">
                                <div className="w-6 h-6 rounded bg-suprema-burgundy text-white flex items-center justify-center text-xs font-bold">
                                    S
                                </div>
                                <span className="font-semibold text-sm tracking-widest uppercase text-white/80">Suprema Inc.</span>
                            </div>
                            <h1 className="text-2xl font-bold">Pre-Registration</h1>
                        </div>
                    </div>
                </div>

                {step < 4 && (
                    <div className="bg-suprema-gray-100 flex h-1.5 w-full">
                        <div
                            className="bg-suprema-burgundy transition-all duration-500 ease-out"
                            style={{ width: `${(step / 3) * 100}%` }}
                        />
                    </div>
                )}

                <div className="p-6 sm:p-8">
                    {step === 4 ? renderSuccess() : (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="mb-8">
                                <span className="text-xs font-bold tracking-widest uppercase text-suprema-burgundy px-3 py-1 bg-suprema-burgundy/10 rounded-full inline-block mb-3">
                                    Step {step} of 3
                                </span>
                                <h2 className="text-xl font-bold text-suprema-gray-900">
                                    {step === 1 && "Personal Information"}
                                    {step === 2 && "Identity Document"}
                                    {step === 3 && "Facial Verification (Optional)"}
                                </h2>
                                <p className="text-sm text-suprema-gray-800/60 mt-1">
                                    {step === 1 && "Please verify your details to speed up your entry."}
                                    {step === 2 && "Enter your ID details to verify your identity."}
                                    {step === 3 && "Take a selfie for seamless biometric access at the speedstiles."}
                                </p>
                            </div>

                            {step === 1 && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5 pb-2">First Name</label>
                                            <input
                                                required
                                                type="text"
                                                value={formData.firstName}
                                                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                                className="w-full px-4 items-center align-middle justify-center py-3 rounded-xl border border-suprema-gray-100 bg-suprema-gray-100/30 focus:bg-white focus:border-suprema-burgundy focus:ring-2 focus:ring-suprema-burgundy/20 transition-all outline-none"
                                                placeholder="John"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5 pb-2">Last Name</label>
                                            <input
                                                required
                                                type="text"
                                                value={formData.lastName}
                                                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                                className="w-full px-4 items-center align-middle py-3 rounded-xl border border-suprema-gray-100 bg-suprema-gray-100/30 focus:bg-white focus:border-suprema-burgundy focus:ring-2 focus:ring-suprema-burgundy/20 transition-all outline-none"
                                                placeholder="Doe"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
                                    <div>
                                        <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5">Document Type</label>
                                        <select
                                            value={formData.documentType}
                                            onChange={(e) => setFormData({ ...formData, documentType: e.target.value })}
                                            className="w-full px-4 py-3 pb-2 rounded-xl border border-suprema-gray-100 bg-suprema-gray-100/30 focus:bg-white focus:border-suprema-burgundy focus:ring-2 focus:ring-suprema-burgundy/20 outline-none appearance-none font-medium"
                                        >
                                            <option value="NATIONAL_ID">National ID (DNI)</option>
                                            <option value="PASSPORT">Passport</option>
                                            <option value="DRIVERS_LICENSE">Driver's License</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5 pb-2">Document Number</label>
                                        <input
                                            required
                                            type="text"
                                            value={formData.documentNumber}
                                            onChange={(e) => setFormData({ ...formData, documentNumber: e.target.value })}
                                            className="w-full px-4 items-center align-middle py-3 rounded-xl border border-suprema-gray-100 bg-suprema-gray-100/30 focus:bg-white focus:border-suprema-burgundy focus:ring-2 focus:ring-suprema-burgundy/20 outline-none"
                                        />
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 text-center">
                                    <div className="w-48 h-48 mx-auto rounded-full bg-suprema-gray-100/50 border-4 border-white shadow-xl shadow-suprema-gray-900/10 flex items-center justify-center overflow-hidden relative group">
                                        {photoDataUrl ? (
                                            <img src={photoDataUrl} alt="Captured selfie" className="w-full h-full object-cover" />
                                        ) : isCameraActive ? (
                                            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                        ) : (
                                            <UserCircle2 className="w-24 h-24 text-suprema-gray-800/20" />
                                        )}
                                    </div>
                                    <div>
                                        {photoDataUrl ? (
                                            <button
                                                type="button"
                                                onClick={() => { setPhotoDataUrl(null); }}
                                                className="text-sm text-suprema-burgundy font-semibold hover:underline"
                                            >
                                                Retake Photo
                                            </button>
                                        ) : isCameraActive ? (
                                            <button
                                                type="button"
                                                onClick={capturePhoto}
                                                className="px-6 py-2.5 rounded-full bg-emerald-600 text-white text-sm font-semibold shadow-md hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 mx-auto"
                                            >
                                                <Camera size={18} />
                                                Capture
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={startCamera}
                                                className="px-6 py-2.5 rounded-full bg-suprema-gray-900 text-white text-sm font-semibold shadow-md hover:bg-suprema-gray-800 transition-colors flex items-center justify-center gap-2 mx-auto"
                                            >
                                                <Camera size={18} />
                                                Take Selfie
                                            </button>
                                        )}
                                        <p className="text-xs text-suprema-gray-800/50 mt-4 max-w-xs mx-auto">
                                            Your photo is optional and will only be used for access control at the facial recognition terminals.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="pt-6 mt-6 border-t border-suprema-gray-100 flex items-center justify-between">
                                {step > 1 ? (
                                    <button
                                        type="button"
                                        onClick={() => setStep(step - 1)}
                                        className="px-4 py-3 text-sm font-semibold text-suprema-gray-800/60 hover:text-suprema-gray-900 transition-colors"
                                    >
                                        Back
                                    </button>
                                ) : <div></div>}

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="flex items-center gap-2 py-3 px-8 rounded-xl text-sm font-bold text-white bg-suprema-burgundy hover:bg-suprema-burgundy-dark focus:ring-2 focus:ring-offset-2 focus:ring-suprema-burgundy transition-all shadow-md active:scale-95 disabled:opacity-70"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            {step === 3 ? 'Complete' : 'Continue'}
                                            {step < 3 && <ArrowRight size={18} />}
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                {step < 4 && (
                    <div className="p-4 bg-suprema-gray-100/30 flex items-center justify-center gap-2 text-xs text-suprema-gray-800/50 font-medium border-t border-suprema-gray-100/50">
                        <ShieldCheck size={14} className="text-emerald-600" />
                        <span className="mb-0.5">End-to-end encrypted transfer</span>
                    </div>
                )}
            </div>
        </div>
    );
}
