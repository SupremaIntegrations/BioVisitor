'use client';

import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, Loader2, AlertCircle, ArrowLeft, Trash2, Info, Clock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface DataRetentionConfig {
    enabled: boolean;
    retentionDays: number;
    lastRun?: {
        deletedVisits: number;
        deletedVisitors: number;
        deletedCredentials: number;
        deletedPhotos: number;
        ranAt: string;
    } | null;
}

const PRESETS = [
    { label: '30 días', days: 30, description: 'Mínimo recomendado para operación diaria' },
    { label: '90 días', days: 90, description: 'Políticas estándar de privacidad' },
    { label: '180 días', days: 180, description: 'Semestral — balance entre trazabilidad y privacidad' },
    { label: '365 días', days: 365, description: 'Anual — recomendado para auditorías corporativas' },
    { label: '2 años', days: 730, description: 'Exigido en algunos sectores regulados' },
    { label: '5 años', days: 1825, description: 'Cumplimiento normativo estricto (ej. ISO 27001)' },
];

function formatRelative(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'hace un momento';
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    return `hace ${Math.floor(hrs / 24)} días`;
}

export default function DataRetentionSettingsPage() {
    const [config, setConfig] = useState<DataRetentionConfig>({ enabled: false, retentionDays: 365 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [triggerResult, setTriggerResult] = useState<DataRetentionConfig['lastRun'] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmPurge, setConfirmPurge] = useState(false);

    useEffect(() => {
        api.get('/visitors/settings/data-retention')
            .then(res => setConfig(res.data))
            .catch(() => setError('No se pudo cargar la configuración.'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const res = await api.put('/visitors/settings/data-retention', {
                enabled: config.enabled,
                retentionDays: config.retentionDays,
            });
            setConfig(prev => ({ ...prev, ...res.data }));
            setSaved(true);
            setTimeout(() => setSaved(false), 4000);
        } catch {
            setError('Error al guardar la configuración. Intente de nuevo.');
        } finally {
            setSaving(false);
        }
    };

    const handleTrigger = async () => {
        setTriggering(true);
        setError(null);
        setTriggerResult(null);
        setConfirmPurge(false);
        try {
            const res = await api.post('/visitors/settings/data-retention/trigger');
            setTriggerResult(res.data);
            setConfig(prev => ({ ...prev, lastRun: res.data }));
        } catch {
            setError('Error al ejecutar la purga. Intente de nuevo.');
        } finally {
            setTriggering(false);
        }
    };

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() - config.retentionDays);

    const inputClass =
        'w-full px-3 py-2.5 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none transition-colors bg-white';

    return (
        <div className="max-w-2xl mx-auto space-y-6">

            {/* ── Header ── */}
            <div className="flex items-center gap-4">
                <Link
                    href="/dashboard/settings"
                    className="p-2 rounded-xl border border-suprema-gray-100 text-suprema-gray-800/50 hover:text-suprema-gray-900 hover:border-suprema-gray-200 transition-colors"
                >
                    <ArrowLeft size={16} />
                </Link>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
                        <Database className="w-5 h-5 text-suprema-burgundy" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-suprema-gray-900">Retención de datos</h1>
                        <p className="text-sm text-suprema-gray-800/60">
                            Período de conservación de registros y purga automática
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Loading ── */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-suprema-burgundy" />
                </div>
            )}

            {!loading && (
                <>
                    {/* ── Config card ── */}
                    <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">

                        {/* Toggle activado */}
                        <div className="flex items-center justify-between px-6 py-5 border-b border-suprema-gray-100">
                            <div>
                                <p className="text-sm font-bold text-suprema-gray-900">Purga automática</p>
                                <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                    Cuando está activa, el sistema elimina automáticamente los registros cada día a las 02:00 AM.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                                className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 ${config.enabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}
                                aria-label={config.enabled ? 'Desactivar purga automática' : 'Activar purga automática'}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-6' : ''}`} />
                            </button>
                        </div>

                        {/* Período de retención */}
                        <div className="px-6 py-5 border-b border-suprema-gray-100">
                            <p className="text-sm font-bold text-suprema-gray-900 mb-1">Período de retención</p>
                            <p className="text-xs text-suprema-gray-800/50 mb-4">
                                Los registros de visitas con estado final (Completada, Cancelada, No presentado) anteriores a este período serán eliminados permanentemente.
                            </p>

                            {/* Presets */}
                            <div className="grid grid-cols-3 gap-2 mb-5">
                                {PRESETS.map(preset => (
                                    <button
                                        key={preset.days}
                                        type="button"
                                        onClick={() => setConfig(c => ({ ...c, retentionDays: preset.days }))}
                                        title={preset.description}
                                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all text-left ${
                                            config.retentionDays === preset.days
                                                ? 'bg-suprema-burgundy text-white border-suprema-burgundy'
                                                : 'bg-white text-suprema-gray-800 border-suprema-gray-200 hover:border-suprema-burgundy/40 hover:bg-suprema-burgundy/5'
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>

                            {/* Input numérico */}
                            <div className="flex items-center gap-3">
                                <div className="w-36">
                                    <input
                                        type="number"
                                        min={1}
                                        max={3650}
                                        value={config.retentionDays}
                                        onChange={e => setConfig(c => ({
                                            ...c,
                                            retentionDays: Math.min(3650, Math.max(1, +e.target.value || 1)),
                                        }))}
                                        className={inputClass}
                                    />
                                </div>
                                <span className="text-sm text-suprema-gray-800/60">días</span>
                                <span className="text-xs text-suprema-gray-800/40">
                                    ≈ {(config.retentionDays / 365).toFixed(1)} año(s)
                                </span>
                            </div>

                            {/* Línea de umbral */}
                            <div className="mt-4 flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                                <Clock size={14} className="text-amber-600 flex-shrink-0" />
                                <p className="text-xs text-amber-800">
                                    Se eliminarán registros anteriores al{' '}
                                    <strong>{expiryDate.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
                                </p>
                            </div>
                        </div>

                        {/* Última ejecución */}
                        {config.lastRun && (
                            <div className="px-6 py-4 border-b border-suprema-gray-100 bg-suprema-gray-50/40">
                                <p className="text-xs font-semibold text-suprema-gray-800/60 mb-2 flex items-center gap-1.5">
                                    <Clock size={12} /> Última purga ejecutada — {formatRelative(config.lastRun.ranAt)}
                                </p>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    {[
                                        { label: 'Visitas eliminadas', value: config.lastRun.deletedVisits },
                                        { label: 'Visitantes eliminados', value: config.lastRun.deletedVisitors },
                                        { label: 'Credenciales eliminadas', value: config.lastRun.deletedCredentials },
                                        { label: 'Fotos eliminadas', value: config.lastRun.deletedPhotos },
                                    ].map(item => (
                                        <div key={item.label} className="bg-white rounded-lg border border-suprema-gray-100 px-3 py-2 text-center">
                                            <p className="text-lg font-bold text-suprema-gray-900">{item.value}</p>
                                            <p className="text-[10px] text-suprema-gray-800/50 leading-tight">{item.label}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Acciones */}
                        <div className="px-6 py-5 bg-suprema-gray-50/50 flex flex-wrap items-center gap-3">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-suprema-gray-900 text-white rounded-xl font-bold text-sm hover:bg-black disabled:opacity-40 transition-colors"
                            >
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                {saved ? '¡Guardado!' : 'Guardar configuración'}
                            </button>

                            {!confirmPurge ? (
                                <button
                                    onClick={() => setConfirmPurge(true)}
                                    disabled={triggering}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 disabled:opacity-40 transition-colors"
                                >
                                    <Trash2 size={14} />
                                    Ejecutar purga ahora
                                </button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-red-700">¿Confirmar eliminación?</span>
                                    <button
                                        onClick={handleTrigger}
                                        disabled={triggering}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-xl font-bold text-xs hover:bg-red-700 disabled:opacity-40 transition-colors"
                                    >
                                        {triggering ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                        Sí, eliminar
                                    </button>
                                    <button
                                        onClick={() => setConfirmPurge(false)}
                                        className="px-4 py-2 border border-suprema-gray-200 text-suprema-gray-800 rounded-xl font-bold text-xs hover:bg-suprema-gray-100 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Feedback ── */}
                    {saved && (
                        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-semibold text-emerald-800">
                            <CheckCircle2 size={16} /> Configuración guardada correctamente.
                        </div>
                    )}
                    {triggerResult && (
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                            <p className="text-sm font-bold text-emerald-800 mb-2 flex items-center gap-2">
                                <CheckCircle2 size={16} /> Purga ejecutada correctamente
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {[
                                    { label: 'Visitas', value: triggerResult.deletedVisits },
                                    { label: 'Visitantes', value: triggerResult.deletedVisitors },
                                    { label: 'Credenciales', value: triggerResult.deletedCredentials },
                                    { label: 'Fotos', value: triggerResult.deletedPhotos },
                                ].map(item => (
                                    <div key={item.label} className="bg-white rounded-lg border border-emerald-100 px-3 py-2 text-center">
                                        <p className="text-lg font-bold text-suprema-gray-900">{item.value}</p>
                                        <p className="text-[10px] text-suprema-gray-800/50">{item.label} eliminados</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-semibold text-red-800">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {/* ── Info legal ── */}
                    <div className="space-y-3">
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                            <p className="text-xs font-semibold text-blue-800 mb-1 flex items-center gap-1.5">
                                <Info size={12} /> ¿Qué datos se eliminan?
                            </p>
                            <ul className="text-xs text-blue-700 leading-relaxed space-y-1 list-disc list-inside">
                                <li>Visitas en estado <strong>Completada</strong>, <strong>Cancelada</strong> o <strong>No presentado</strong> anteriores al umbral configurado.</li>
                                <li>Credenciales de acceso (QR, biometría) vinculadas a esas visitas.</li>
                                <li>Registros de visitantes que no tengan visitas restantes en el sistema.</li>
                                <li>Fotografías de perfil de los visitantes eliminados.</li>
                            </ul>
                        </div>
                        <div className="p-4 bg-suprema-gray-50 border border-suprema-gray-100 rounded-xl">
                            <p className="text-xs font-semibold text-suprema-gray-900 mb-1 flex items-center gap-1.5">
                                <ShieldCheck size={12} className="text-suprema-burgundy" /> Referencia normativa
                            </p>
                            <p className="text-xs text-suprema-gray-800/60 leading-relaxed">
                                Configure el período de retención de acuerdo con la legislación aplicable en su país:
                                <strong> GDPR (UE) </strong> — máximo necesario para el propósito;
                                <strong> Ley 1581/2012 (Colombia) </strong> — mientras exista vigencia de la relación;
                                <strong> LGPD (Brasil) </strong> — finalidad + obligaciones legales.
                                Consulte a su DPO o asesor legal para una configuración precisa.
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
