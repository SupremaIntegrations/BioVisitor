'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import {
    CheckCircle2, AlertTriangle, Loader2, ChevronRight, ChevronLeft,
    User, Building2, CreditCard, Calendar, Clock, Shield,
} from 'lucide-react';

// Public API client — no auth header
const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function publicGet(path: string) {
    const res = await fetch(`${PUBLIC_API}${path}`, { cache: 'no-store' });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
    }
    return res.json();
}

async function publicPut(path: string, body: object) {
    const res = await fetch(`${PUBLIC_API}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return res.json();
}

interface VisitInfo {
    email: string;
    hostName: string;
    companyName: string;
    scheduledAt: string;
    expectedEndAt: string | null;
    purpose: string | null;
    status: string;
    isPreRegistered: boolean;
    lockedFirstName: string | null;
    lockedLastName: string | null;
    lockedDocumentType: string | null;
    lockedDocumentNumber: string | null;
}

type DocType = 'NATIONAL_ID' | 'PASSPORT' | 'FOREIGN_ID' | 'DRIVERS_LICENSE' | 'OTHER';

const DOC_LABELS: Record<DocType, string> = {
    NATIONAL_ID: 'Cédula de ciudadanía',
    PASSPORT: 'Pasaporte',
    FOREIGN_ID: 'Cédula de extranjería',
    DRIVERS_LICENSE: 'Licencia de conducción',
    OTHER: 'Otro documento',
};

const STEPS = [
    { id: 1, label: 'Datos personales', icon: User },
    { id: 2, label: 'Empresa e información', icon: Building2 },
];

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-CO', {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

// ─── Step 1: Personal Data ────────────────────────────────────────────────────

interface Step1Data {
    firstName: string;
    lastName: string;
    documentType: DocType;
    documentNumber: string;
    phone: string;
}

function LockedField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                {label}
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-1">
                    <Shield size={9} /> Verificado
                </span>
            </label>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 font-medium select-none">
                {icon && <span className="text-gray-400 flex-shrink-0">{icon}</span>}
                {value}
            </div>
        </div>
    );
}

function Step1({
    data, onChange, onNext, locked,
}: {
    data: Step1Data;
    onChange: (d: Partial<Step1Data>) => void;
    onNext: () => void;
    locked?: { firstName: string; lastName: string; documentType: string; documentNumber: string; email: string };
}) {
    const [errors, setErrors] = useState<Partial<Step1Data>>({});

    const validate = () => {
        const e: Partial<Step1Data> = {};
        if (!locked && !data.firstName.trim()) e.firstName = 'Campo requerido';
        if (!locked && !data.lastName.trim()) e.lastName = 'Campo requerido';
        if (!locked && !data.documentNumber.trim()) e.documentNumber = 'Campo requerido';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleNext = () => { if (validate()) onNext(); };

    return (
        <div className="space-y-5">
            {locked && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    <Shield size={14} className="flex-shrink-0 mt-0.5 text-amber-600" />
                    <span>Tu anfitrión registró tus datos de identidad. Estos campos están bloqueados por seguridad y no pueden modificarse.</span>
                </div>
            )}

            {locked ? (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <LockedField label="Nombre(s)" value={locked.firstName} />
                        <LockedField label="Apellido(s)" value={locked.lastName} />
                    </div>
                    <LockedField label="Tipo de documento" value={DOC_LABELS[locked.documentType as DocType] ?? locked.documentType} />
                    <LockedField label="Número de documento" value={locked.documentNumber} icon={<CreditCard size={14} />} />
                    <LockedField label="Correo electrónico" value={locked.email} />
                </>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                Nombre(s) <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={data.firstName}
                                onChange={(e) => onChange({ firstName: e.target.value })}
                                placeholder="Ej: María"
                                className={`w-full px-3 py-2.5 text-sm border rounded-xl outline-none transition-colors focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36] text-gray-900 ${errors.firstName ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                            />
                            {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                Apellido(s) <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={data.lastName}
                                onChange={(e) => onChange({ lastName: e.target.value })}
                                placeholder="Ej: González"
                                className={`w-full px-3 py-2.5 text-sm border rounded-xl outline-none transition-colors focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36] text-gray-900 ${errors.lastName ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                            />
                            {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                            Tipo de documento <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={data.documentType}
                            onChange={(e) => onChange({ documentType: e.target.value as DocType })}
                            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36] text-gray-900"
                        >
                            {(Object.entries(DOC_LABELS) as [DocType, string][]).map(([val, label]) => (
                                <option key={val} value={val}>{label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                            Número de documento <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <CreditCard size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={data.documentNumber}
                                onChange={(e) => onChange({ documentNumber: e.target.value })}
                                placeholder="Ej: 1234567890"
                                className={`w-full pl-9 pr-3 py-2.5 text-sm border rounded-xl outline-none transition-colors focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36] text-gray-900 ${errors.documentNumber ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                            />
                        </div>
                        {errors.documentNumber && <p className="text-xs text-red-500 mt-1">{errors.documentNumber}</p>}
                    </div>
                </>
            )}

            <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Teléfono (opcional)</label>
                <input
                    type="tel"
                    value={data.phone}
                    onChange={(e) => onChange({ phone: e.target.value })}
                    placeholder="+57 300 000 0000"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36] text-gray-900"
                />
            </div>

            <button
                onClick={handleNext}
                className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-[#A11A36] text-white font-bold text-sm rounded-xl hover:bg-[#8a1530] transition-colors shadow-md shadow-[#A11A36]/25"
            >
                Continuar <ChevronRight size={16} />
            </button>
        </div>
    );
}

// ─── Step 2: Company / Extra Info ─────────────────────────────────────────────

interface Step2Data {
    company: string;
    position: string;
}

function Step2({
    data, onChange, onBack, onSubmit, submitting,
}: {
    data: Step2Data;
    onChange: (d: Partial<Step2Data>) => void;
    onBack: () => void;
    onSubmit: () => void;
    submitting: boolean;
}) {
    return (
        <div className="space-y-5">
            <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Empresa u organización
                </label>
                <div className="relative">
                    <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={data.company}
                        onChange={(e) => onChange({ company: e.target.value })}
                        placeholder="Ej: Acme Corp S.A.S."
                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36]"
                    />
                </div>
            </div>

            <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Cargo o posición
                </label>
                <input
                    type="text"
                    value={data.position}
                    onChange={(e) => onChange({ position: e.target.value })}
                    placeholder="Ej: Gerente Comercial"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#A11A36]/20 focus:border-[#A11A36]"
                />
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 flex gap-2">
                <Shield size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
                <p>Tus datos personales son tratados conforme a las políticas de privacidad de la organización y se usan únicamente para gestionar el acceso a las instalaciones.</p>
            </div>

            <div className="flex gap-3">
                <button
                    onClick={onBack}
                    disabled={submitting}
                    className="flex items-center gap-1 px-5 py-3 text-sm font-semibold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                    <ChevronLeft size={16} /> Atrás
                </button>
                <button
                    onClick={onSubmit}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-6 bg-[#A11A36] text-white font-bold text-sm rounded-xl hover:bg-[#8a1530] transition-colors shadow-md shadow-[#A11A36]/25 disabled:opacity-50"
                >
                    {submitting ? (
                        <><Loader2 size={15} className="animate-spin" /> Enviando…</>
                    ) : (
                        <><CheckCircle2 size={15} /> Confirmar Registro</>
                    )}
                </button>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
    const { token } = useParams<{ token: string }>();

    const [loadState, setLoadState] = useState<'loading' | 'invalid' | 'used' | 'ready'>('loading');
    const [visitInfo, setVisitInfo] = useState<VisitInfo | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const [step, setStep] = useState(1);
    const [step1, setStep1] = useState<Step1Data>({
        firstName: '', lastName: '', documentType: 'NATIONAL_ID', documentNumber: '', phone: '',
    });
    const [step2, setStep2] = useState<Step2Data>({ company: '', position: '' });

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [done, setDone] = useState(false);
    const [visitorName, setVisitorName] = useState('');

    useEffect(() => {
        if (!token) return;
        publicGet(`/visitors/onboarding/${token}`)
            .then((data: VisitInfo) => {
                setVisitInfo(data);
                // Pre-populate step1 with locked identity data when host pre-registered
                if (data.isPreRegistered && data.lockedFirstName && data.lockedLastName) {
                    setStep1(prev => ({
                        ...prev,
                        firstName: data.lockedFirstName ?? '',
                        lastName: data.lockedLastName ?? '',
                        documentType: (data.lockedDocumentType as DocType) ?? 'NATIONAL_ID',
                        documentNumber: data.lockedDocumentNumber ?? '',
                    }));
                }
                setLoadState('ready');
            })
            .catch((err: Error) => {
                if (err.message.toLowerCase().includes('utilizado') || err.message.toLowerCase().includes('activ')) {
                    setLoadState('used');
                } else {
                    setErrorMsg(err.message);
                    setLoadState('invalid');
                }
            });
    }, [token]);

    const handleSubmit = async () => {
        setSubmitting(true);
        setSubmitError('');
        try {
            const payload: Record<string, string> = {
                firstName: step1.firstName.trim(),
                lastName: step1.lastName.trim(),
                documentType: step1.documentType,
                documentNumber: step1.documentNumber.trim(),
            };
            if (step1.phone.trim()) payload.phone = step1.phone.trim();
            if (step2.company.trim()) payload.company = step2.company.trim();
            if (step2.position.trim()) payload.position = step2.position.trim();
            if (visitInfo?.email) payload.email = visitInfo.email;

            const res = await publicPut(`/visitors/onboarding/${token}`, payload);
            setVisitorName(res.visitorName ?? `${step1.firstName} ${step1.lastName}`);
            setDone(true);
        } catch (err: any) {
            setSubmitError(err.message || 'Error al enviar. Inténtalo de nuevo.');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Success Screen ─────────────────────────────────────────────────────────
    if (done) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 text-center">
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={40} className="text-emerald-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">¡Registro Completo!</h1>
                    <p className="text-gray-500 text-sm mb-6">
                        Tu visita está confirmada y lista.
                    </p>
                    {visitInfo && (
                        <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-3 mb-6 border border-gray-100">
                            <div className="flex items-center gap-3">
                                <User size={16} className="text-[#A11A36] flex-shrink-0" />
                                <div>
                                    <p className="text-xs text-gray-500 font-medium">Visitante</p>
                                    <p className="text-sm font-bold text-gray-900">{visitorName}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Building2 size={16} className="text-[#A11A36] flex-shrink-0" />
                                <div>
                                    <p className="text-xs text-gray-500 font-medium">Anfitrión</p>
                                    <p className="text-sm font-bold text-gray-900">{visitInfo.hostName}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Calendar size={16} className="text-[#A11A36] flex-shrink-0" />
                                <div>
                                    <p className="text-xs text-gray-500 font-medium">Fecha y hora</p>
                                    <p className="text-sm font-bold text-gray-900">{fmtDate(visitInfo.scheduledAt)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="bg-[#A11A36]/5 border border-[#A11A36]/20 rounded-xl p-4 text-sm text-[#A11A36] font-medium">
                        Al llegar a recepción, simplemente menciona tu nombre o muestra tu correo.
                        El sistema te identificará automáticamente.
                    </div>
                </div>
            </div>
        );
    }

    // ── Loading ────────────────────────────────────────────────────────────────
    if (loadState === 'loading') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
                <div className="text-center space-y-3">
                    <Loader2 size={36} className="animate-spin text-white/60 mx-auto" />
                    <p className="text-white/60 text-sm">Verificando invitación…</p>
                </div>
            </div>
        );
    }

    // ── Invalid / Error ────────────────────────────────────────────────────────
    if (loadState === 'invalid') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 text-center">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertTriangle size={40} className="text-red-500" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Enlace inválido o expirado</h1>
                    <p className="text-gray-500 text-sm mb-4">
                        Este enlace de registro no es válido o ha expirado.
                    </p>
                    {errorMsg && (
                        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">{errorMsg}</p>
                    )}
                    <p className="text-sm text-gray-500 mt-4">
                        Si crees que es un error, contacta directamente a tu anfitrión.
                    </p>
                </div>
            </div>
        );
    }

    // ── Already Used ───────────────────────────────────────────────────────────
    if (loadState === 'used') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 text-center">
                    <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={40} className="text-blue-500" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Registro ya completado</h1>
                    <p className="text-gray-500 text-sm">
                        Tu registro ya fue completado anteriormente. Al llegar a recepción, simplemente menciona tu nombre.
                    </p>
                </div>
            </div>
        );
    }

    // ── Form ───────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#1a1a2e] to-[#16213e] px-8 py-6 border-b-4 border-[#A11A36]">
                    <p className="text-[#A11A36] text-xs font-bold uppercase tracking-widest mb-1">
                        {visitInfo?.companyName ?? 'BioVisitor X'}
                    </p>
                    <h1 className="text-white text-xl font-bold">Registro de Visitante</h1>
                    <p className="text-white/50 text-xs mt-1">Completa tu información para confirmar la visita</p>
                </div>

                {/* Visit info banner */}
                {visitInfo && (
                    <div className="bg-slate-50 border-b border-gray-100 px-8 py-4 flex flex-wrap gap-4 text-xs text-gray-600">
                        <span className="flex items-center gap-1.5">
                            <User size={12} className="text-[#A11A36]" />
                            <strong className="text-gray-800">Anfitrión:</strong> {visitInfo.hostName}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Calendar size={12} className="text-[#A11A36]" />
                            <strong className="text-gray-800">Fecha:</strong> {fmtDate(visitInfo.scheduledAt)}
                        </span>
                        {visitInfo.expectedEndAt && (
                            <span className="flex items-center gap-1.5">
                                <Clock size={12} className="text-[#A11A36]" />
                                <strong className="text-gray-800">Hasta:</strong> {fmtDate(visitInfo.expectedEndAt)}
                            </span>
                        )}
                    </div>
                )}

                {/* Stepper */}
                <div className="flex items-center px-8 pt-6 pb-2">
                    {STEPS.map((s, i) => {
                        const Icon = s.icon;
                        const isActive = step === s.id;
                        const isDone = step > s.id;
                        return (
                            <React.Fragment key={s.id}>
                                <div className="flex items-center gap-2">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                                        isDone ? 'bg-emerald-500 text-white' :
                                        isActive ? 'bg-[#A11A36] text-white' :
                                        'bg-gray-100 text-gray-400'
                                    }`}>
                                        {isDone ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                                    </div>
                                    <span className={`text-xs font-semibold transition-colors ${
                                        isActive ? 'text-[#A11A36]' : isDone ? 'text-emerald-600' : 'text-gray-400'
                                    }`}>
                                        {s.label}
                                    </span>
                                </div>
                                {i < STEPS.length - 1 && (
                                    <div className={`flex-1 h-px mx-3 transition-colors ${step > s.id ? 'bg-emerald-300' : 'bg-gray-200'}`} />
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Form content */}
                <div className="px-8 py-6">
                    {step === 1 && (
                        <Step1
                            data={step1}
                            onChange={(d) => setStep1((p) => ({ ...p, ...d }))}
                            onNext={() => setStep(2)}
                            locked={
                                visitInfo?.isPreRegistered && visitInfo.lockedFirstName
                                    ? {
                                        firstName: visitInfo.lockedFirstName,
                                        lastName: visitInfo.lockedLastName ?? '',
                                        documentType: visitInfo.lockedDocumentType ?? 'NATIONAL_ID',
                                        documentNumber: visitInfo.lockedDocumentNumber ?? '',
                                        email: visitInfo.email,
                                    }
                                    : undefined
                            }
                        />
                    )}
                    {step === 2 && (
                        <Step2
                            data={step2}
                            onChange={(d) => setStep2((p) => ({ ...p, ...d }))}
                            onBack={() => setStep(1)}
                            onSubmit={handleSubmit}
                            submitting={submitting}
                        />
                    )}
                    {submitError && (
                        <p className="mt-4 text-xs text-red-600 text-center font-semibold">{submitError}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-gray-50 border-t border-gray-100 px-8 py-3 text-center">
                    <p className="text-xs text-gray-400">
                        Powered by <span className="font-bold text-[#A11A36]">BioVisitor X</span> · {visitInfo?.companyName}
                    </p>
                </div>
            </div>
        </div>
    );
}
