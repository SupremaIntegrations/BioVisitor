'use client';

import React, { useState } from 'react';
import { X, ShieldAlert, Loader2, AlertTriangle, Unlock, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
    visitId: string;
    visitorName: string;
    onClose: () => void;
    onResolved: () => void;
}

function defaultReenableUntil(): string {
    const d = new Date(Date.now() + 60 * 60 * 1000); // +1h por defecto
    d.setSeconds(0, 0);
    // formato requerido por <input type="datetime-local">
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FalseExitAlertModal({ visitId, visitorName, onClose, onResolved }: Props) {
    const [mode, setMode] = useState<'choose' | 'reenable' | 'dismiss'>('choose');
    const [reenableUntil, setReenableUntil] = useState(defaultReenableUntil());
    const [autoCheckoutEnabled, setAutoCheckoutEnabled] = useState(true);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleReenable = async () => {
        setError(null);
        const dateVal = new Date(reenableUntil);
        if (isNaN(dateVal.getTime()) || dateVal.getTime() <= Date.now()) {
            setError('Selecciona una fecha/hora de expiración futura.');
            return;
        }
        setLoading(true);
        try {
            await api.put(`/visitors/visit/${visitId}/temporary-reenable`, {
                reenableUntil: dateVal.toISOString(),
                autoCheckoutEnabled,
                resolutionNote: note.trim() || undefined,
            });
            onResolved();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'No se pudo reactivar el acceso.');
        } finally {
            setLoading(false);
        }
    };

    const handleDismiss = async () => {
        setError(null);
        setLoading(true);
        try {
            await api.put(`/visitors/visit/${visitId}/false-exit/dismiss`, {
                resolutionNote: note.trim() || undefined,
            });
            onResolved();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'No se pudo descartar el reporte.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                            <ShieldAlert className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-900">Falsa salida reportada</h2>
                            <p className="text-sm text-gray-500">{visitorName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {mode === 'choose' && (
                    <div className="space-y-3">
                        <p className="text-sm text-gray-600 mb-4">
                            El visitante indicó que sigue dentro de las instalaciones a pesar del auto-checkout.
                            Selecciona una acción:
                        </p>
                        <button
                            onClick={() => setMode('reenable')}
                            className="w-full flex items-center gap-3 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg px-4 py-3 text-sm font-semibold transition-colors"
                        >
                            <Unlock size={16} />
                            Reactivar acceso temporalmente
                        </button>
                        <button
                            onClick={() => setMode('dismiss')}
                            className="w-full flex items-center gap-3 border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg px-4 py-3 text-sm font-semibold transition-colors"
                        >
                            <XCircle size={16} />
                            Descartar (en efecto ya salió)
                        </button>
                    </div>
                )}

                {mode === 'reenable' && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">
                                Acceso válido hasta
                            </label>
                            <input
                                type="datetime-local"
                                value={reenableUntil}
                                onChange={(e) => setReenableUntil(e.target.value)}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#A12944]/30 focus:border-[#A12944]"
                            />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={autoCheckoutEnabled}
                                onChange={(e) => setAutoCheckoutEnabled(e.target.checked)}
                                className="rounded border-gray-300"
                            />
                            Auto-checkout habilitado para esta visita
                        </label>
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Nota (opcional)</label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={2}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#A12944]/30 focus:border-[#A12944]"
                                placeholder="Ej: confirmado por cámara de recepción"
                            />
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
                                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => setMode('choose')}
                                className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50"
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleReenable}
                                disabled={loading}
                                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60"
                            >
                                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                Reactivar acceso
                            </button>
                        </div>
                    </div>
                )}

                {mode === 'dismiss' && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Nota (opcional)</label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={2}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#A12944]/30 focus:border-[#A12944]"
                                placeholder="Ej: se confirmó salida por cámara"
                            />
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
                                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => setMode('choose')}
                                className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50"
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleDismiss}
                                disabled={loading}
                                className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60"
                            >
                                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                Confirmar salida
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
