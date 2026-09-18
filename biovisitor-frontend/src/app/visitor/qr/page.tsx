'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, Clock, AlertCircle, CheckCircle2, PauseCircle } from 'lucide-react';
import { useUrlToken } from '@/lib/useUrlToken';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

interface QrData {
    qrDataUrl: string;
    cardId: string;
    visitorName: string;
    expiresAt: string | null;
    visitId: string;
    countdownSeconds: number;
    showRenewButton: boolean;
}

export default function VisitorQrPortalPage() {
    const token = useUrlToken();

    const [qrData, setQrData]       = useState<QrData | null>(null);
    const [loading, setLoading]     = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError]         = useState<string | null>(null);
    const [countdown, setCountdown] = useState(60);
    const [isPaused, setIsPaused]   = useState(false);

    // Refs that never cause re-renders but are always current
    const countdownRef       = useRef<NodeJS.Timeout | null>(null);
    const refreshInFlightRef = useRef(false);
    const countdownValueRef  = useRef(60);      // mirrors countdown state
    const lastHiddenAtRef    = useRef<number | null>(null); // when tab was hidden
    const qrDataRef          = useRef<QrData | null>(null); // mirrors qrData state

    // Keep ref in sync with state
    useEffect(() => { qrDataRef.current = qrData; }, [qrData]);
    useEffect(() => { countdownValueRef.current = countdown; }, [countdown]);

    // ── Fetch initial QR (triggers lazy BioStar enrollment on first open) ──
    const fetchQr = useCallback(async () => {
        if (!token) return;
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/visitors/qr-portal/${token}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || 'No se pudo obtener el código QR.');
            }
            const data: QrData = await res.json();
            setQrData(data);
            const secs = data.countdownSeconds ?? 60;
            setCountdown(secs);
            countdownValueRef.current = secs;
        } catch (err: any) {
            setError(err.message || 'Error al cargar el QR.');
        } finally {
            setLoading(false);
        }
    }, [token]);

    // ── Refresh QR (rotates in BioStar only when called) ──
    const refreshQr = useCallback(async () => {
        if (refreshInFlightRef.current) return;
        refreshInFlightRef.current = true;
        setRefreshing(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/visitors/qr-portal/${token}/refresh`, {
                method: 'POST',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || 'No se pudo refrescar el código QR.');
            }
            const data: QrData = await res.json();
            setQrData(data);
            const secs = data.countdownSeconds ?? 60;
            setCountdown(secs);
            countdownValueRef.current = secs;
        } catch (err: any) {
            setError(err.message || 'Error al refrescar el QR.');
        } finally {
            setRefreshing(false);
            refreshInFlightRef.current = false;
        }
    }, [token]);

    // ── Start the countdown ticker ──
    const startTicker = useCallback((refreshFn: () => void) => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
            // If page is in background, freeze everything — no BioStar calls
            if (document.hidden) return;

            setCountdown(prev => {
                const next = prev - 1;
                countdownValueRef.current = next;
                if (next <= 0) {
                    refreshFn();
                    const secs = qrDataRef.current?.countdownSeconds ?? 60;
                    countdownValueRef.current = secs;
                    return secs;
                }
                return next;
            });
        }, 1000);
    }, []);

    // ── Stop the ticker ──
    const stopTicker = useCallback(() => {
        if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
        }
    }, []);

    // ── Load QR on mount ──
    useEffect(() => {
        fetchQr();
    }, [fetchQr]);

    // ── Start/restart ticker whenever qrData arrives or refreshQr changes ──
    useEffect(() => {
        if (!qrData) return;
        startTicker(refreshQr);
        return stopTicker;
    }, [qrData, refreshQr, startTicker, stopTicker]);

    // ── Page Visibility API: pause when hidden, resume + refresh when visible ──
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Tab went to background — freeze the ticker
                lastHiddenAtRef.current = Date.now();
                setIsPaused(true);
                // Keep the interval alive but it won't do anything (checked inside tick)
            } else {
                // Tab came back to foreground
                setIsPaused(false);
                const hiddenAt = lastHiddenAtRef.current;
                const secondsHidden = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0;
                const secs = qrDataRef.current?.countdownSeconds ?? 60;

                if (secondsHidden >= countdownValueRef.current) {
                    // Enough time passed that the QR would have expired → refresh immediately
                    // and reset countdown. BioStar sync happens here (and only here).
                    refreshQr();
                    setCountdown(secs);
                    countdownValueRef.current = secs;
                } else {
                    // Subtract the hidden time from the remaining countdown
                    const remaining = Math.max(1, Math.round(countdownValueRef.current - secondsHidden));
                    setCountdown(remaining);
                    countdownValueRef.current = remaining;
                }
                lastHiddenAtRef.current = null;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refreshQr]);

    // ── Cleanup on unmount ──
    useEffect(() => () => stopTicker(), [stopTicker]);

    const expiresLabel = qrData?.expiresAt
        ? new Date(qrData.expiresAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
        : null;

    const urgentColor =
        countdown <= 10 ? 'text-red-500' : countdown <= 20 ? 'text-amber-500' : 'text-emerald-600';

    const countdownLabel = (() => {
        const s = qrData?.countdownSeconds ?? 60;
        if (s < 60) return `${s} segundos`;
        if (s < 3600) return `${Math.floor(s / 60)} minuto${Math.floor(s / 60) !== 1 ? 's' : ''}`;
        return `${Math.floor(s / 3600)} hora${Math.floor(s / 3600) !== 1 ? 's' : ''}`;
    })();

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-white/10 rounded-2xl mb-4">
                    <QrCode size={28} className="text-white" />
                </div>
                <h1 className="text-2xl font-bold text-white">Portal de Acceso</h1>
                <p className="text-slate-400 text-sm mt-1">BioVisitor X — Suprema</p>
            </div>

            {/* Card */}
            <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
                        <p className="text-slate-500 text-sm">Cargando tu código QR…</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-16 px-6 space-y-4 text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                            <AlertCircle size={32} className="text-red-500" />
                        </div>
                        <h2 className="text-lg font-bold text-slate-800">No disponible</h2>
                        <p className="text-sm text-slate-500">{error}</p>
                        <button
                            onClick={fetchQr}
                            className="mt-2 px-5 py-2.5 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors text-sm"
                        >
                            Reintentar
                        </button>
                    </div>
                ) : qrData ? (
                    <>
                        {/* Visitor info */}
                        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Visitante</p>
                            <p className="text-lg font-bold text-slate-800 mt-0.5">{qrData.visitorName}</p>
                            {expiresLabel && (
                                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                    <CheckCircle2 size={11} className="text-emerald-500" />
                                    Vigente hasta {expiresLabel}
                                </p>
                            )}
                        </div>

                        {/* QR Image */}
                        <div className="flex flex-col items-center px-8 pt-8 pb-4">
                            {refreshing ? (
                                <div className="w-64 h-64 flex items-center justify-center">
                                    <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
                                </div>
                            ) : isPaused ? (
                                // When page is in background, show a dimmed QR with overlay
                                // (won't happen visually since the page is hidden, but on restore
                                //  the user sees a fresh QR immediately)
                                <div className="relative w-64 h-64">
                                    <img
                                        src={qrData.qrDataUrl}
                                        alt="Código QR de acceso"
                                        className="w-64 h-64 rounded-xl border border-slate-100 shadow-md opacity-30"
                                    />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                        <PauseCircle size={36} className="text-slate-600" />
                                        <p className="text-xs font-semibold text-slate-600">Actualizando…</p>
                                    </div>
                                </div>
                            ) : (
                                <img
                                    src={qrData.qrDataUrl}
                                    alt="Código QR de acceso"
                                    className="w-64 h-64 rounded-xl border border-slate-100 shadow-md"
                                />
                            )}
                        </div>

                        {/* Countdown */}
                        <div className="flex items-center justify-center gap-2 pb-4">
                            <Clock size={14} className={urgentColor} />
                            <span className={`text-sm font-bold tabular-nums ${urgentColor}`}>
                                Nuevo código en {countdown}s
                            </span>
                        </div>

                        {/* Instructions */}
                        <div className="px-6 pb-4">
                            <p className="text-xs text-center text-slate-400 leading-relaxed">
                                Muestra este código al lector de acceso. El código se renueva automáticamente cada{' '}
                                {countdownLabel} para garantizar tu seguridad.
                            </p>
                        </div>

                        {/* Refresh button — only if enabled in admin settings */}
                        {qrData.showRenewButton && (
                            <div className="px-6 pb-6">
                                <button
                                    onClick={refreshQr}
                                    disabled={refreshing}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors text-sm"
                                >
                                    <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                                    {refreshing ? 'Generando nuevo código…' : 'Solicitar nuevo código ahora'}
                                </button>
                            </div>
                        )}
                    </>
                ) : null}
            </div>

            {/* Footer */}
            <p className="text-slate-600 text-xs mt-8 text-center">
                Este enlace es personal e intransferible.
                <br />
                No compartas esta página con otras personas.
            </p>
        </div>
    );
}
