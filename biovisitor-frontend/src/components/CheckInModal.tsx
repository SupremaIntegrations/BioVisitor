'use client';

import React, { useState, useCallback } from 'react';
import { X, UserCheck, CalendarClock, AlertCircle, Loader2, CheckCircle2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

interface CheckInModalProps {
    visitId: string;
    visitorName: string;
    initialAutoCheckoutEnabled?: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

function toLocalDatetimeValue(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToDate(val: string): Date {
    return new Date(val);
}

const PRESETS = [
    { label: '1 h',   minutes: 60 },
    { label: '2 h',   minutes: 120 },
    { label: '4 h',   minutes: 240 },
    { label: '8 h',   minutes: 480 },
    { label: 'Fin día', minutes: -1 },
];

export default function CheckInModal({ visitId, visitorName, initialAutoCheckoutEnabled = false, onClose, onSuccess }: CheckInModalProps) {
    const initNow = new Date();
    // Round down to nearest minute
    initNow.setSeconds(0, 0);

    const [startsAt, setStartsAt] = useState<string>(toLocalDatetimeValue(initNow));
    const [expiresAt, setExpiresAt] = useState<string>('');
    const [startsAtError, setStartsAtError] = useState<string | null>(null);
    const [expiresAtError, setExpiresAtError] = useState<string | null>(null);
    const [autoCheckoutEnabled, setAutoCheckoutEnabled] = useState<boolean>(initialAutoCheckoutEnabled);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Min for startsAt = now (rounded down)
    const minStartsAt = toLocalDatetimeValue(initNow);

    const applyPreset = (minutes: number) => {
        const base = startsAt ? localToDate(startsAt) : new Date();
        let target: Date;
        if (minutes === -1) {
            target = new Date(base);
            target.setHours(18, 0, 0, 0);
            if (target <= base) target.setDate(target.getDate() + 1);
            target.setHours(18, 0, 0, 0);
        } else {
            target = new Date(base.getTime() + minutes * 60000);
        }
        setExpiresAt(toLocalDatetimeValue(target));
        setExpiresAtError(null);
    };

    const getMinExpiresAt = useCallback(() => {
        if (!startsAt) return minStartsAt;
        const base = localToDate(startsAt);
        return toLocalDatetimeValue(new Date(base.getTime() + 60000));
    }, [startsAt, minStartsAt]);

    const validate = (): boolean => {
        let ok = true;

        if (!startsAt) {
            setStartsAtError('La fecha de entrada es obligatoria.');
            ok = false;
        } else {
            const s = localToDate(startsAt);
            if (isNaN(s.getTime())) {
                setStartsAtError('Fecha inválida.');
                ok = false;
            } else {
                setStartsAtError(null);
            }
        }

        if (!expiresAt) {
            setExpiresAtError('La fecha de salida programada es obligatoria.');
            ok = false;
        } else {
            const s = localToDate(startsAt);
            const e = localToDate(expiresAt);
            if (isNaN(e.getTime())) {
                setExpiresAtError('Fecha inválida.');
                ok = false;
            } else if (e <= s) {
                setExpiresAtError('La salida programada debe ser posterior a la entrada.');
                ok = false;
            } else {
                setExpiresAtError(null);
            }
        }

        return ok;
    };

    const handleSubmit = async () => {
        if (!validate()) return;
        setLoading(true);
        setError(null);
        try {
            await api.put(`/visitors/visit/${visitId}/checkin`, {
                startsAt: localToDate(startsAt).toISOString(),
                expiresAt: localToDate(expiresAt).toISOString(),
                autoCheckoutEnabled,
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.message || 'No se pudo realizar el check-in.');
        } finally {
            setLoading(false);
        }
    };

    const durationLabel = (() => {
        if (!startsAt || !expiresAt) return null;
        const s = localToDate(startsAt);
        const e = localToDate(expiresAt);
        if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return null;
        const diffMin = Math.round((e.getTime() - s.getTime()) / 60000);
        const h = Math.floor(diffMin / 60);
        const m = diffMin % 60;
        if (h === 0) return `${m} min`;
        if (m === 0) return `${h} h`;
        return `${h} h ${m} min`;
    })();

    const fmtDate = (val: string) => {
        const d = localToDate(val);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const canSubmit = !!startsAt && !!expiresAt && !startsAtError && !expiresAtError;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                            <UserCheck size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-lg leading-tight">Check-in</h2>
                            <p className="text-emerald-100 text-sm truncate max-w-[220px]">{visitorName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors rounded-xl p-1">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">

                    {error && (
                        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                            <AlertCircle size={15} className="flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Entrada programada */}
                    <div>
                        <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5">
                            <LogIn size={14} className="text-emerald-600" />
                            Entrada programada
                            <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <CalendarClock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                type="datetime-local"
                                value={startsAt}
                                min={minStartsAt}
                                onChange={e => {
                                    setStartsAt(e.target.value);
                                    setStartsAtError(null);
                                    // If expiresAt is now invalid (before new start), clear it
                                    if (expiresAt && e.target.value && localToDate(expiresAt) <= localToDate(e.target.value)) {
                                        setExpiresAt('');
                                        setExpiresAtError(null);
                                    }
                                }}
                                className={`w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors ${
                                    startsAtError
                                        ? 'border-red-300 focus:ring-red-200 bg-red-50'
                                        : 'border-slate-200 focus:ring-emerald-200 focus:border-emerald-400'
                                }`}
                            />
                        </div>
                        {startsAtError && (
                            <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                <AlertCircle size={11} /> {startsAtError}
                            </p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                            Auto-configurada al momento actual. Puede adelantarse, no retrasarse.
                        </p>
                    </div>

                    {/* Salida programada */}
                    <div>
                        <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-1.5">
                            <LogOut size={14} className="text-red-500" />
                            Salida programada
                            <span className="text-red-500">*</span>
                        </label>

                        {/* Presets */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {PRESETS.map(p => (
                                <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => applyPreset(p.minutes)}
                                    className="text-xs font-medium px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 border border-slate-200 text-slate-600 rounded-lg transition-all"
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        <div className="relative">
                            <CalendarClock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                type="datetime-local"
                                value={expiresAt}
                                min={getMinExpiresAt()}
                                onChange={e => { setExpiresAt(e.target.value); setExpiresAtError(null); }}
                                className={`w-full pl-10 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors ${
                                    expiresAtError
                                        ? 'border-red-300 focus:ring-red-200 bg-red-50'
                                        : 'border-slate-200 focus:ring-emerald-200 focus:border-emerald-400'
                                }`}
                            />
                        </div>
                        {expiresAtError && (
                            <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                                <AlertCircle size={11} /> {expiresAtError}
                            </p>
                        )}
                        {durationLabel && !expiresAtError && (
                            <p className="mt-1 text-xs text-emerald-700 flex items-center gap-1.5 font-medium">
                                <CheckCircle2 size={11} />
                                Duración autorizada: <strong>{durationLabel}</strong>
                            </p>
                        )}
                    </div>

                    {/* Auto-checkout status */}
                    <div>
                        <button
                            type="button"
                            onClick={() => setAutoCheckoutEnabled(v => !v)}
                            className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
                                autoCheckoutEnabled
                                    ? 'border-emerald-300 bg-emerald-50'
                                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                            }`}
                        >
                            <span className="flex items-center gap-2 text-left">
                                <ShieldCheck size={16} className={autoCheckoutEnabled ? 'text-emerald-600' : 'text-slate-400'} />
                                <span>
                                    <span className="block text-sm font-semibold text-slate-700">Auto-checkout</span>
                                    <span className="block text-xs text-slate-500">
                                        Estado: <strong className={autoCheckoutEnabled ? 'text-emerald-700' : 'text-slate-500'}>
                                            {autoCheckoutEnabled ? 'Activado' : 'Desactivado'}
                                        </strong>
                                    </span>
                                </span>
                            </span>
                            <span
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                                    autoCheckoutEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                        autoCheckoutEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </span>
                        </button>
                    </div>

                    {/* Summary card */}
                    {durationLabel && !startsAtError && !expiresAtError && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
                            <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Resumen de vigencia</p>
                            <div className="flex items-center justify-between text-sm text-emerald-900">
                                <span className="flex items-center gap-1.5 text-slate-600">
                                    <LogIn size={13} className="text-emerald-600" /> Entrada
                                </span>
                                <span className="font-semibold">{fmtDate(startsAt)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm text-emerald-900">
                                <span className="flex items-center gap-1.5 text-slate-600">
                                    <LogOut size={13} className="text-red-500" /> Salida
                                </span>
                                <span className="font-semibold">{fmtDate(expiresAt)}</span>
                            </div>
                            <div className="pt-1 border-t border-emerald-200 text-xs text-emerald-700 font-medium text-center">
                                Duración: {durationLabel}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 pb-6 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors text-sm"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || !canSubmit}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm shadow-sm"
                    >
                        {loading ? (
                            <><Loader2 size={15} className="animate-spin" /> Registrando…</>
                        ) : (
                            <><UserCheck size={15} /> Confirmar Check-in</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
