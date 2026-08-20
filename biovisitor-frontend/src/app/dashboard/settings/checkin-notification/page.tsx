'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Mail, CheckCircle2, Loader2, AlertCircle, ArrowLeft,
    ToggleLeft, ToggleRight, Upload, X, Image as ImageIcon,
    Sparkles, Info,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface CheckinNotifConfig {
    enabled: boolean;
    subject: string;
    bodyText: string;
    logoUrl: string | null;
}

// Chips shown to the user — friendly label only, no {{}} visible
const SUBJECT_VARS = [
    { key: '{{visitorName}}',   label: 'Nombre del visitante',     sample: 'María García' },
    { key: '{{hostName}}',      label: 'Nombre del anfitrión',     sample: 'Carlos Rodríguez' },
    { key: '{{visitorCompany}}',label: 'Empresa del visitante',    sample: 'Acme S.A.S.' },
    { key: '{{checkedInTime}}', label: 'Hora de llegada',          sample: 'martes 27 may · 09:35' },
];

const BODY_VARS = [
    { key: '{{visitorName}}',    label: 'Nombre del visitante',    sample: 'María García' },
    { key: '{{hostName}}',       label: 'Nombre del anfitrión',    sample: 'Carlos Rodríguez' },
    { key: '{{visitorCompany}}', label: 'Empresa del visitante',   sample: 'Acme S.A.S.' },
    { key: '{{visitorDocument}}',label: 'Documento de identidad',  sample: 'CC 80.234.567' },
    { key: '{{purpose}}',        label: 'Motivo de visita',        sample: 'Reunión comercial' },
    { key: '{{checkedInTime}}',  label: 'Hora y fecha de llegada', sample: 'martes 27 may · 09:35' },
];

const ALL_SAMPLES: Record<string, string> = {
    visitorName:    'María García',
    hostName:       'Carlos Rodríguez',
    visitorCompany: 'Acme S.A.S.',
    visitorDocument:'CC 80.234.567',
    purpose:        'Reunión comercial',
    checkedInTime:  'martes, 27 de mayo de 2026 · 09:35 a.m.',
};

function interpolate(tpl: string) {
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => ALL_SAMPLES[k] ?? '');
}

export default function CheckinNotifSettingsPage() {
    const [config, setConfig] = useState<CheckinNotifConfig>({
        enabled: true,
        subject: '',
        bodyText: '',
        logoUrl: null,
    });
    const [loading, setLoading]   = useState(true);
    const [saving, setSaving]     = useState(false);
    const [saved, setSaved]       = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const [logoError, setLogoError] = useState<string | null>(null);

    const subjectRef = useRef<HTMLInputElement>(null);
    const bodyRef    = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        api.get('/visitors/settings/checkin-notification')
            .then(res => setConfig(res.data))
            .catch(() => setError('No se pudo cargar la configuración.'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true); setError(null); setSaved(false);
        try {
            const res = await api.put('/visitors/settings/checkin-notification', config);
            setConfig(res.data);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch { setError('No se pudo guardar la configuración.'); }
        finally   { setSaving(false); }
    };

    // Insert variable at cursor — user never needs to type {{...}} manually
    const insertAtCursor = (
        varKey: string,
        field: 'subject' | 'bodyText',
        ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
        const el = ref.current;
        if (!el) { setConfig(p => ({ ...p, [field]: p[field] + varKey })); return; }
        const start = el.selectionStart ?? el.value.length;
        const end   = el.selectionEnd   ?? el.value.length;
        const newVal = el.value.slice(0, start) + varKey + el.value.slice(end);
        setConfig(p => ({ ...p, [field]: newVal }));
        setTimeout(() => { el.focus(); el.setSelectionRange(start + varKey.length, start + varKey.length); }, 0);
    };

    const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setLogoError(null);
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { setLogoError('El archivo debe ser una imagen.'); return; }
        if (file.size > 500 * 1024) { setLogoError('El logo no debe superar 500 KB.'); return; }
        const reader = new FileReader();
        reader.onload = ev => setConfig(p => ({ ...p, logoUrl: ev.target?.result as string }));
        reader.readAsDataURL(file);
        e.target.value = '';
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-suprema-burgundy" size={28} />
        </div>
    );

    const previewSubject = interpolate(config.subject || 'Tu visitante {{visitorName}} ha llegado al edificio');
    const previewBody    = interpolate(
        config.bodyText ||
        'Hola {{hostName}},\n\nTu visitante {{visitorName}} de {{visitorCompany}} ha realizado check-in en recepción y se encuentra esperándote.\n\nMotivo de visita: {{purpose}}\nHora de ingreso: {{checkedInTime}}\n\nSaludos,\nRecepción'
    );

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">

            {/* Header */}
            <div className="mb-6">
                <Link href="/dashboard/settings"
                    className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4">
                    <ArrowLeft size={14} /> Volver a Configuración
                </Link>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center flex-shrink-0">
                        <Mail size={20} className="text-suprema-burgundy" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Notificación al Anfitrión</h1>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Personaliza el correo que recibe el anfitrión cuando su visitante hace check-in
                        </p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mb-5 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <AlertCircle size={15} /> {error}
                </div>
            )}
            {saved && (
                <div className="mb-5 flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
                    <CheckCircle2 size={15} /> Configuración guardada correctamente.
                </div>
            )}

            {/* How it works banner */}
            <div className="mb-6 flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
                <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 leading-relaxed">
                    <strong>¿Qué estás configurando aquí?</strong> La <em>redacción</em> del correo: el saludo, las frases, el tono del mensaje.
                    Los datos del visitante (nombre, empresa, hora de llegada, etc.) siempre los toma el sistema automáticamente del registro —
                    no los estás editando ni sobreescribiendo. Usa los botones <strong>+ Insertar</strong> para marcar dónde deben aparecer esos datos dentro del texto.
                    <span className="block mt-1 text-blue-600">La columna derecha muestra en tiempo real cómo quedará el correo con datos reales de ejemplo.</span>
                </div>
            </div>

            {/* Two-column layout: form left, preview right */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

                {/* ── LEFT: Form ── */}
                <div className="space-y-5">

                    {/* Toggle */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h2 className="font-semibold text-slate-800">Notificaciones activas</h2>
                                <p className="text-sm text-slate-500 mt-0.5">
                                    Desactiva para no enviar ningún correo al anfitrión al hacer check-in.
                                </p>
                            </div>
                            <button onClick={() => setConfig(p => ({ ...p, enabled: !p.enabled }))} className="flex-shrink-0">
                                {config.enabled
                                    ? <ToggleRight size={44} className="text-suprema-burgundy" />
                                    : <ToggleLeft  size={44} className="text-slate-300" />}
                            </button>
                        </div>
                    </div>

                    {/* Logo */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <h2 className="font-semibold text-slate-800 mb-0.5">Logo de tu empresa</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            Aparece en la cabecera del correo. PNG, JPG, SVG o WebP · máx. 500 KB.
                        </p>
                        {config.logoUrl ? (
                            <div className="flex items-center gap-4">
                                <div className="w-24 h-14 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden p-2 flex-shrink-0">
                                    <img src={config.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <span className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                                        <CheckCircle2 size={13} /> Logo cargado
                                    </span>
                                    <div className="flex gap-2">
                                        <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors">
                                            <Upload size={11} /> Cambiar
                                            <input type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} />
                                        </label>
                                        <button onClick={() => setConfig(p => ({ ...p, logoUrl: null }))}
                                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors">
                                            <X size={11} /> Eliminar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <label className="cursor-pointer flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed border-slate-200 hover:border-suprema-burgundy/40 rounded-xl py-6 transition-colors group">
                                <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-suprema-burgundy/5 flex items-center justify-center transition-colors">
                                    <ImageIcon size={18} className="text-slate-400 group-hover:text-suprema-burgundy transition-colors" />
                                </div>
                                <p className="text-sm text-slate-500 group-hover:text-slate-700 transition-colors">
                                    Haz clic para subir tu logo
                                </p>
                                <input type="file" accept="image/*" className="sr-only" onChange={handleLogoUpload} />
                            </label>
                        )}
                        {logoError && <p className="mt-2 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{logoError}</p>}
                    </div>

                    {/* Subject */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <label className="block font-semibold text-slate-800 mb-0.5">Asunto del correo</label>
                        <p className="text-sm text-slate-500 mb-3">
                            Primera línea que verá el anfitrión en su bandeja de entrada.
                        </p>
                        <input
                            ref={subjectRef}
                            type="text"
                            value={config.subject}
                            onChange={e => setConfig(p => ({ ...p, subject: e.target.value }))}
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy"
                            placeholder="Ej: Tienes un visitante esperándote en recepción"
                        />
                        <div className="mt-3">
                            <p className="text-xs text-slate-400 mb-2">
                                Insertar dato del visitante en el asunto (clic para añadir donde está el cursor):
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {SUBJECT_VARS.map(v => (
                                    <button key={v.key} type="button"
                                        onClick={() => insertAtCursor(v.key, 'subject', subjectRef as any)}
                                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 bg-slate-50 hover:bg-suprema-burgundy/5 border border-slate-200 hover:border-suprema-burgundy/30 text-slate-600 hover:text-suprema-burgundy rounded-lg transition-all">
                                        <Sparkles size={10} className="text-amber-400" />
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <label className="block font-semibold text-slate-800 mb-0.5">Cuerpo del mensaje</label>
                        <p className="text-sm text-slate-500 mb-3">
                            El texto del correo. Escribe libremente y usa los botones de abajo para insertar datos del visitante donde quieras.
                        </p>
                        <textarea
                            ref={bodyRef}
                            value={config.bodyText}
                            onChange={e => setConfig(p => ({ ...p, bodyText: e.target.value }))}
                            rows={10}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy resize-none leading-relaxed"
                            placeholder={'Escribe aquí el texto del correo…'}
                        />
                        <div className="mt-3">
                            <p className="text-xs text-slate-400 mb-2">
                                Insertar dato del visitante en el mensaje (clic para añadir donde está el cursor):
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {BODY_VARS.map(v => (
                                    <button key={v.key} type="button"
                                        onClick={() => insertAtCursor(v.key, 'bodyText', bodyRef as any)}
                                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 bg-slate-50 hover:bg-suprema-burgundy/5 border border-slate-200 hover:border-suprema-burgundy/30 text-slate-600 hover:text-suprema-burgundy rounded-lg transition-all">
                                        <Sparkles size={10} className="text-amber-400" />
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Save */}
                    <div className="flex justify-end">
                        <button onClick={handleSave} disabled={saving}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-suprema-burgundy text-white font-semibold rounded-xl hover:bg-suprema-burgundy/90 disabled:opacity-50 transition-colors shadow-sm">
                            {saving ? <><Loader2 size={15} className="animate-spin" /> Guardando…</>
                            : saved  ? <><CheckCircle2 size={15} /> Guardado</>
                            : 'Guardar configuración'}
                        </button>
                    </div>
                </div>

                {/* ── RIGHT: Live preview — always visible ── */}
                <div className="lg:sticky lg:top-6">
                    <div className="bg-slate-100 rounded-2xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                Vista previa en tiempo real
                            </p>
                        </div>
                        <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                            Así verá el anfitrión el correo, con datos reales del visitante en lugar de los marcadores.
                        </p>

                        {/* Subject line preview */}
                        <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 mb-2 flex gap-2 items-start">
                            <span className="text-xs text-slate-400 font-medium mt-0.5 flex-shrink-0">Asunto</span>
                            <span className="text-sm text-slate-800 font-medium">{previewSubject}</span>
                        </div>

                        {/* Email card */}
                        <div className="rounded-xl overflow-hidden shadow border border-slate-200">
                            {/* Email header */}
                            <div className="bg-[#1a1a2e] border-b-4 border-[#A12944] px-6 py-5 text-center">
                                {config.logoUrl ? (
                                    <img src={config.logoUrl} alt="Logo" className="max-h-12 max-w-[160px] object-contain mx-auto mb-3" />
                                ) : (
                                    <div className="inline-flex items-center gap-1.5 mb-2 opacity-30">
                                        <ImageIcon size={14} className="text-white" />
                                        <span className="text-white text-xs">Tu logo aquí</span>
                                    </div>
                                )}
                                <p className="text-white font-bold text-sm">BioVisitor X</p>
                                <p className="text-white/50 text-xs mt-0.5">Sistema de Gestión de Visitantes</p>
                            </div>
                            {/* Email body */}
                            <div className="bg-white px-6 py-5 text-sm text-slate-700 leading-relaxed whitespace-pre-line min-h-[120px]">
                                {previewBody || <span className="text-slate-300 italic">El mensaje aparecerá aquí…</span>}
                            </div>
                            {/* Email footer */}
                            <div className="bg-slate-50 border-t border-slate-100 px-6 py-3 text-center text-xs text-slate-400">
                                © {new Date().getFullYear()} BioVisitor X · Todos los derechos reservados
                            </div>
                        </div>

                        {/* Sample data legend */}
                        <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-xs font-semibold text-slate-500 mb-2">Datos de ejemplo usados en la vista previa:</p>
                            <div className="space-y-1">
                                {BODY_VARS.map(v => (
                                    <div key={v.key} className="flex items-center gap-2 text-xs">
                                        <span className="text-slate-400">{v.label}:</span>
                                        <span className="font-medium text-slate-700">{v.sample}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
