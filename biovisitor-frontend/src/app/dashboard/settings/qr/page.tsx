'use client';

import React, { useState, useEffect } from 'react';
import { QrCode, CheckCircle2, Loader2, AlertCircle, ArrowLeft, ToggleLeft, ToggleRight, Clock, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface QrConfig {
    countdownSeconds: number;
    showRenewButton: boolean;
}

const COUNTDOWN_OPTIONS = [
    { value: 30, label: '30 segundos' },
    { value: 60, label: '1 minuto (predeterminado)' },
    { value: 120, label: '2 minutos' },
    { value: 180, label: '3 minutos' },
    { value: 300, label: '5 minutos' },
    { value: 600, label: '10 minutos' },
    { value: 900, label: '15 minutos' },
    { value: 1800, label: '30 minutos' },
    { value: 3600, label: '1 hora' },
];

export default function QrSettingsPage() {
    const [config, setConfig] = useState<QrConfig>({
        countdownSeconds: 60,
        showRenewButton: true,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.get('/visitors/settings/qr')
            .then(res => setConfig(res.data))
            .catch(() => setError('No se pudo cargar la configuración.'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const res = await api.put('/visitors/settings/qr', config);
            setConfig(res.data);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError('No se pudo guardar la configuración.');
        } finally {
            setSaving(false);
        }
    };

    const formatSeconds = (s: number) => {
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)} min`;
        return `${Math.floor(s / 3600)} h`;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-suprema-burgundy" size={28} />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="mb-8">
                <Link
                    href="/dashboard/settings"
                    className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4"
                >
                    <ArrowLeft size={14} />
                    Volver a Configuración
                </Link>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
                        <QrCode size={20} className="text-suprema-burgundy" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Configuración de QR Dinámico</h1>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Controla la vigencia y las opciones del portal de acceso QR para visitantes
                        </p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <AlertCircle size={15} />
                    {error}
                </div>
            )}

            {saved && (
                <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
                    <CheckCircle2 size={15} />
                    Configuración guardada correctamente.
                </div>
            )}

            <div className="space-y-6">
                {/* Countdown / TTL */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-1">
                        <Clock size={16} className="text-suprema-burgundy" />
                        <h2 className="font-semibold text-slate-800">Vigencia del código QR</h2>
                    </div>
                    <p className="text-sm text-slate-500 mb-5">
                        Cada cuánto tiempo se renueva automáticamente el QR en el portal del visitante. 
                        Un intervalo corto aumenta la seguridad; uno largo es más cómodo para el visitante.
                    </p>

                    <div className="grid grid-cols-3 gap-2.5">
                        {COUNTDOWN_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setConfig(p => ({ ...p, countdownSeconds: opt.value }))}
                                className={`rounded-xl border px-3 py-3 text-sm font-medium text-left transition-all ${
                                    config.countdownSeconds === opt.value
                                        ? 'border-suprema-burgundy bg-suprema-burgundy/5 text-suprema-burgundy ring-1 ring-suprema-burgundy/30'
                                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                }`}
                            >
                                <span className="block text-lg font-bold tabular-nums">
                                    {formatSeconds(opt.value)}
                                </span>
                                <span className="text-xs font-normal text-slate-400 mt-0.5 block">
                                    {opt.label.includes('predeterminado') ? 'predeterminado' : ''}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Custom value */}
                    <div className="mt-4 flex items-center gap-3">
                        <label className="text-sm text-slate-600 flex-shrink-0">Personalizado (segundos):</label>
                        <input
                            type="number"
                            min={10}
                            max={3600}
                            value={config.countdownSeconds}
                            onChange={e => setConfig(p => ({ ...p, countdownSeconds: Number(e.target.value) }))}
                            className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy"
                        />
                        <span className="text-xs text-slate-400">Mínimo 10, máximo 3600</span>
                    </div>
                </div>

                {/* Show renew button */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-start gap-3">
                            {config.showRenewButton ? (
                                <Eye size={18} className="text-suprema-burgundy mt-0.5 flex-shrink-0" />
                            ) : (
                                <EyeOff size={18} className="text-slate-400 mt-0.5 flex-shrink-0" />
                            )}
                            <div>
                                <h2 className="font-semibold text-slate-800">Botón "Solicitar nuevo código"</h2>
                                <p className="text-sm text-slate-500 mt-1">
                                    Cuando está activo, el visitante puede pulsar un botón en su portal para renovar 
                                    el QR manualmente antes de que venza el tiempo automático.
                                    Desactívalo si deseas que la renovación sea solo automática.
                                </p>
                                <div className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${
                                    config.showRenewButton
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                                }`}>
                                    {config.showRenewButton ? (
                                        <><CheckCircle2 size={12} /> Visible para el visitante</>
                                    ) : (
                                        <><EyeOff size={12} /> Oculto — solo renovación automática</>
                                    )}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setConfig(p => ({ ...p, showRenewButton: !p.showRenewButton }))}
                            className="flex-shrink-0 ml-4"
                            aria-label={config.showRenewButton ? 'Ocultar botón' : 'Mostrar botón'}
                        >
                            {config.showRenewButton ? (
                                <ToggleRight size={44} className="text-suprema-burgundy" />
                            ) : (
                                <ToggleLeft size={44} className="text-slate-300" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Preview */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                    <h3 className="text-sm font-semibold text-slate-600 mb-3">Vista previa del comportamiento</h3>
                    <div className="flex items-center gap-6 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                            <Clock size={14} className="text-slate-400" />
                            <span>El QR se renueva cada <strong className="text-slate-800">{formatSeconds(config.countdownSeconds)}</strong> automáticamente</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {config.showRenewButton ? (
                                <><Eye size={14} className="text-emerald-600" /><span>Botón de renovación <strong className="text-emerald-700">visible</strong></span></>
                            ) : (
                                <><EyeOff size={14} className="text-slate-400" /><span>Botón de renovación <strong className="text-slate-500">oculto</strong></span></>
                            )}
                        </div>
                    </div>
                </div>

                {/* Save */}
                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-suprema-burgundy text-white font-semibold rounded-xl hover:bg-suprema-burgundy/90 disabled:opacity-50 transition-colors shadow-sm"
                    >
                        {saving ? (
                            <><Loader2 size={15} className="animate-spin" /> Guardando…</>
                        ) : saved ? (
                            <><CheckCircle2 size={15} /> Guardado</>
                        ) : (
                            'Guardar configuración'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
