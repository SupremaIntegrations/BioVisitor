"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    Users, AlertTriangle, QrCode, Wifi, WifiOff, LogIn,
    RefreshCw, X, Search, Loader2, Building2, ShieldAlert,
    CheckCircle2, TrendingUp, Clock, UserCheck, Activity,
    UserPlus, Upload, Send, ChevronDown, FileSpreadsheet,
    CalendarDays, Mail, IdCard, Hash,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '@/lib/api';
import AuthImage from '@/components/AuthImage';
import { useI18n } from '@/i18n/I18nContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InBuildingVisitor {
    id: string;
    visitorName: string;
    company: string;
    hostName: string;
    checkedInAt: string;
    expectedEndAt: string;
    isOverstay: boolean;
    photoPath: string | null;
    visitorId: string;
}

interface RecentArrival {
    id: string;
    visitorName: string;
    company: string;
    hostName: string;
    status: string;
    scheduledAt: string;
    checkedInAt: string;
    photoPath: string | null;
    visitorId: string;
    visitorUpdatedAt: string;
}

interface DashboardStats {
    inBuilding: number;
    totalToday: number;
    overstayCount: number;
    preRegCount: number;
    preRegRate: number;
    syncCounts: { synced: number; pending: number; failed: number };
    biostarHealthy: boolean;
    chartData: { label: string; count: number }[];
    purposeData: { name: string; value: number }[];
    inBuildingList: InBuildingVisitor[];
    recentArrivals: RecentArrival[];
}

type ChartRange = 'today' | '7d' | 'month' | 'year';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#A11A36', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function minutesAgo(iso: string): number {
    return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

// ─── Pre-Registered Modal ─────────────────────────────────────────────────────

interface PreRegVisit {
    id: string;
    scheduledAt: string;
    expectedEndAt: string | null;
    invitedEmail: string | null;
    visitor: {
        id: string;
        firstName: string;
        lastName: string;
        documentType: string;
        documentNumber: string;
        email: string;
        company: string | null;
        position: string | null;
        photoPath: string | null;
    };
    host?: { name: string } | null;
    hostUser?: { fullName?: string } | null;
}

const DOC_SHORT: Record<string, string> = {
    NATIONAL_ID: 'CC',
    PASSPORT: 'PAS',
    FOREIGN_ID: 'CE',
    DRIVERS_LICENSE: 'LIC',
    OTHER: 'OTR',
};

function PreRegisteredModal({ onClose }: { onClose: () => void }) {
    const [visits, setVisits] = useState<PreRegVisit[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        api.get('/visitors/active')
            .then((res) => {
                const all: PreRegVisit[] = Array.isArray(res.data) ? res.data : [];
                setVisits(all.filter((v) => (v as any).status === 'PRE_REGISTERED'));
            })
            .finally(() => setLoading(false));
    }, []);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return visits;
        return visits.filter((v) =>
            `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.toLowerCase().includes(q) ||
            (v.visitor?.email ?? '').toLowerCase().includes(q) ||
            (v.visitor?.documentNumber ?? '').toLowerCase().includes(q) ||
            (v.host?.name ?? v.hostUser?.fullName ?? '').toLowerCase().includes(q) ||
            (v.visitor?.company ?? '').toLowerCase().includes(q)
        );
    }, [visits, search]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-violet-100">
                            <UserCheck size={18} className="text-violet-600" />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-900 text-base">Pre-Registros completados</h2>
                            <p className="text-xs text-gray-500">Visitantes que completaron su Magic Link</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                        <X size={16} className="text-gray-500" />
                    </button>
                </div>

                {/* Search */}
                <div className="px-6 py-3 border-b border-gray-100">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por nombre, email, documento o anfitrión…"
                            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400 text-gray-900"
                        />
                    </div>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 size={28} className="animate-spin text-violet-500" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <div className="p-4 rounded-full bg-violet-50">
                                <UserCheck size={28} className="text-violet-400" />
                            </div>
                            <p className="text-sm font-semibold text-gray-600">
                                {search ? 'Sin resultados para esa búsqueda' : 'No hay pre-registros pendientes'}
                            </p>
                            <p className="text-xs text-gray-400 text-center max-w-xs">
                                {search ? 'Intenta con otro término' : 'Cuando un visitante complete su Magic Link aparecerá aquí'}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {filtered.map((v) => {
                                const name = `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}`.trim() || v.invitedEmail || '—';
                                const hostLabel = v.host?.name ?? v.hostUser?.fullName ?? '—';
                                const doc = v.visitor?.documentNumber
                                    ? `${DOC_SHORT[v.visitor.documentType] ?? v.visitor.documentType} ${v.visitor.documentNumber}`
                                    : null;
                                const scheduledDate = v.scheduledAt
                                    ? new Date(v.scheduledAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                                    : '—';
                                return (
                                    <div key={v.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                                        {/* Avatar */}
                                        <div className="flex-shrink-0">
                                            {v.visitor?.photoPath ? (
                                                <AuthImage
                                                    src={`/api/v1/visitors/${v.visitor.id}/photo`}
                                                    alt={name}
                                                    className="w-10 h-10 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 font-bold text-sm">
                                                    {name.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                        </div>

                                        {/* Main info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-semibold text-sm text-gray-900 truncate">{name}</p>
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                                                    <CheckCircle2 size={9} /> Pre-registrado
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                                {v.visitor?.email && (
                                                    <span className="flex items-center gap-1 text-xs text-gray-500">
                                                        <Mail size={10} /> {v.visitor.email}
                                                    </span>
                                                )}
                                                {doc && (
                                                    <span className="flex items-center gap-1 text-xs text-gray-500">
                                                        <IdCard size={10} /> {doc}
                                                    </span>
                                                )}
                                                {v.visitor?.company && (
                                                    <span className="text-xs text-gray-400 truncate">{v.visitor.company}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right side */}
                                        <div className="flex-shrink-0 text-right">
                                            <p className="text-xs font-semibold text-gray-700 flex items-center gap-1 justify-end">
                                                <Users size={10} className="text-gray-400" /> {hostLabel}
                                            </p>
                                            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 justify-end">
                                                <CalendarDays size={10} /> {scheduledDate}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {!loading && filtered.length > 0 && (
                    <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                        <p className="text-xs text-gray-400">
                            {filtered.length} visitante{filtered.length !== 1 ? 's' : ''} pre-registrado{filtered.length !== 1 ? 's' : ''}
                        </p>
                        <button onClick={onClose} className="text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors">
                            Cerrar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Evacuation Modal ─────────────────────────────────────────────────────────

function EvacuationModal({
    visitors, onClose,
}: { visitors: InBuildingVisitor[]; onClose: () => void }) {
    const { t } = useI18n();
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        const base = !q ? visitors : visitors.filter(
            (v) =>
                v.visitorName.toLowerCase().includes(q) ||
                v.company.toLowerCase().includes(q) ||
                v.hostName.toLowerCase().includes(q),
        );
        return [...base].sort((a, b) => {
            if (a.isOverstay !== b.isOverstay) return a.isOverstay ? -1 : 1;
            return new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime();
        });
    }, [visitors, search]);

    const overstayCount = visitors.filter((v) => v.isOverstay).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-suprema-gray-900 to-suprema-gray-800 p-5 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/20 rounded-xl">
                            <Building2 size={20} className="text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="font-bold text-lg">{t('evac.title')}</h2>
                            <p className="text-xs text-white/60">
                                {t('evac.subtitle', { count: String(visitors.length), p: visitors.length !== 1 ? 's' : '' })}
                                {overstayCount > 0 && ` · ${t('evac.overstayNote', { count: String(overstayCount) })}`}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-5 pt-4 pb-3 border-b border-suprema-gray-100">
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                        <input
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('evac.searchPlaceholder')}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-suprema-gray-200 rounded-xl focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        />
                    </div>
                </div>

                {/* Overstay banner */}
                {overstayCount > 0 && !search && (
                    <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
                        <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
                        <p className="text-xs font-semibold text-red-700">
                            {t('evac.overstayBanner', { count: String(overstayCount), p: overstayCount !== 1 ? 's' : '' })}
                        </p>
                    </div>
                )}

                {/* List */}
                <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
                    {filtered.length === 0 && (
                        <p className="text-center text-sm text-suprema-gray-400 py-8">{t('evac.noResults')}</p>
                    )}
                    {filtered.map((v) => (
                        <EvacRow key={v.id} v={v} isOverstay={v.isOverstay} />
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-suprema-gray-100 bg-suprema-gray-50 text-xs text-suprema-gray-500 flex items-center justify-between">
                    <span>{t('evac.updatedAt', { time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</span>
                    <span className="font-semibold">{t('evac.showing', { shown: String(filtered.length), total: String(visitors.length), p: filtered.length !== 1 ? 's' : '' })}</span>
                </div>
            </div>
        </div>
    );
}

function EvacRow({ v, isOverstay }: { v: InBuildingVisitor; isOverstay: boolean }) {
    const { t } = useI18n();
    return (
        <div className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
            isOverstay ? 'bg-red-50 border-red-200' : 'bg-white border-suprema-gray-100 hover:bg-suprema-gray-50'
        }`}>
            <div className="w-9 h-9 rounded-full overflow-hidden bg-suprema-gray-100 flex-shrink-0 flex items-center justify-center text-xs font-bold text-suprema-gray-600">
                {v.photoPath ? (
                    <AuthImage
                        src={`/visitors/${v.visitorId}/photo`}
                        alt={v.visitorName}
                        className="w-full h-full object-cover"
                        fallback={<span>{v.visitorName[0]}</span>}
                    />
                ) : (
                    v.visitorName[0]
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm text-suprema-gray-900 truncate">{v.visitorName}</p>
                    {isOverstay && <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />}
                </div>
                <p className="text-xs text-suprema-gray-500 truncate">
                    {v.company || t('evac.noCompany')} · {t('evac.host')} {v.hostName || '—'}
                </p>
            </div>
            <div className="text-right flex-shrink-0">
                <p className="text-xs font-semibold text-suprema-gray-700">{fmtTime(v.checkedInAt)}</p>
                <p className={`text-xs ${isOverstay ? 'text-red-600 font-bold' : 'text-suprema-gray-400'}`}>
                    {v.expectedEndAt ? t('evac.until', { time: fmtTime(v.expectedEndAt) }) : t('evac.noLimit')}
                </p>
            </div>
        </div>
    );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
    label, value, sub, icon, colorCls, alert, onClick,
}: {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ReactNode;
    colorCls: string;
    alert?: boolean;
    onClick?: () => void;
}) {
    const { t } = useI18n();
    return (
        <button
            onClick={onClick}
            className={`relative w-full text-left rounded-2xl p-5 border shadow-sm transition-all outline-none
                ${alert ? 'border-red-300 bg-red-50 animate-pulse-border' : 'bg-white border-suprema-gray-100 hover:shadow-md hover:border-suprema-gray-200'}
                ${onClick ? 'cursor-pointer' : 'cursor-default'}
            `}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-suprema-gray-500 uppercase tracking-wider mb-2">{label}</p>
                    <p className={`text-3xl font-bold ${colorCls}`}>{value}</p>
                    {sub && <p className="text-xs text-suprema-gray-400 mt-1 truncate">{sub}</p>}
                </div>
                <div className={`p-3 rounded-xl flex-shrink-0 ${alert ? 'bg-red-100' : 'bg-suprema-gray-100'}`}>
                    {icon}
                </div>
            </div>
            {onClick && (
                <p className="text-xs text-suprema-burgundy font-semibold mt-3 opacity-70">{t('dashboard.visitDetail')}</p>
            )}
        </button>
    );
}

// ─── Custom Bar Tooltip ───────────────────────────────────────────────────────

function BarTooltip({ active, payload, label }: any) {
    const { t } = useI18n();
    if (!active || !payload?.length) return null;
    const count = payload[0].value;
    return (
        <div className="bg-white border border-suprema-gray-200 rounded-xl px-3 py-2 shadow-lg text-xs">
            <p className="font-bold text-suprema-gray-900">{label}</p>
            <p className="text-suprema-burgundy font-semibold">{count} {t('dashboard.tooltipVisits', { p: count !== 1 ? 's' : '' })}</p>
        </div>
    );
}

// ─── Custom Pie Tooltip ───────────────────────────────────────────────────────

function PieTooltip({ active, payload }: any) {
    const { t } = useI18n();
    if (!active || !payload?.length) return null;
    const count = payload[0].value;
    return (
        <div className="bg-white border border-suprema-gray-200 rounded-xl px-3 py-2 shadow-lg text-xs">
            <p className="font-bold text-suprema-gray-900">{payload[0].name}</p>
            <p style={{ color: payload[0].payload.fill }} className="font-semibold">{count} {t('dashboard.tooltipVisits', { p: count !== 1 ? 's' : '' })}</p>
        </div>
    );
}

// ─── Document Types ───────────────────────────────────────────────────────────

const DOC_TYPES = [
    { value: 'NATIONAL_ID',      label: 'Cédula de ciudadanía' },
    { value: 'PASSPORT',         label: 'Pasaporte' },
    { value: 'FOREIGN_ID',       label: 'Cédula de extranjería' },
    { value: 'DRIVERS_LICENSE',  label: 'Licencia de conducción' },
    { value: 'OTHER',            label: 'Otro' },
];

// ─── Host Dashboard ───────────────────────────────────────────────────────────

function HostDashboard({ hostName, hostId }: { hostName: string; hostId: string }) {
    const [view, setView] = useState<'home' | 'invite'>('home');
    const [form, setForm] = useState({
        documentType: 'NATIONAL_ID',
        documentNumber: '',
        invitedName: '',
        email: '',
        scheduledAt: '',
        expectedEndAt: '',
    });
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<'ok' | 'err' | null>(null);
    const [err, setErr] = useState('');

    function setField(k: keyof typeof form, v: string) {
        setForm(p => ({ ...p, [k]: v }));
    }

    async function handleSend() {
        if (!form.invitedName.trim() || !form.email.trim() || !form.documentNumber.trim() || !form.scheduledAt) {
            setErr('Completa todos los campos obligatorios.');
            return;
        }
        setErr('');
        setSending(true);
        try {
            await api.post('/visitors/invite', {
                emails: [form.email.trim().toLowerCase()],
                scheduledAt: new Date(form.scheduledAt).toISOString(),
                expectedEndAt: form.expectedEndAt ? new Date(form.expectedEndAt).toISOString() : undefined,
                hostId,
                invitedName: form.invitedName.trim(),
                documentType: form.documentType,
                documentNumber: form.documentNumber.trim(),
            });
            setResult('ok');
        } catch (e: any) {
            setErr(e?.response?.data?.message ?? 'Error al enviar la invitación.');
            setResult('err');
        } finally {
            setSending(false);
        }
    }

    function resetForm() {
        setForm({ documentType: 'NATIONAL_ID', documentNumber: '', invitedName: '', email: '', scheduledAt: '', expectedEndAt: '' });
        setResult(null);
        setErr('');
        setView('home');
    }

    // ── Success screen ──
    if (result === 'ok') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 size={40} className="text-emerald-600" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-suprema-gray-900 mb-2">¡Invitación enviada!</h2>
                    <p className="text-suprema-gray-500 max-w-sm">
                        Se envió un Magic Link al correo de <strong>{form.invitedName}</strong>. El visitante recibirá un enlace para completar su registro.
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => { setResult(null); setErr(''); setView('invite'); setForm(p => ({ ...p, invitedName: '', email: '', documentNumber: '' })); }}
                        className="px-5 py-2.5 rounded-xl border border-suprema-gray-200 text-sm font-semibold text-suprema-gray-700 hover:bg-suprema-gray-50 transition-colors"
                    >
                        Invitar otro visitante
                    </button>
                    <button
                        onClick={resetForm}
                        className="px-5 py-2.5 rounded-xl bg-suprema-burgundy text-white text-sm font-semibold hover:bg-suprema-burgundy/90 transition-colors"
                    >
                        Volver al inicio
                    </button>
                </div>
            </div>
        );
    }

    // ── Invite form ──
    if (view === 'invite') {
        return (
            <div className="max-w-lg mx-auto py-8 px-4">
                <button onClick={() => setView('home')} className="text-sm text-suprema-gray-500 hover:text-suprema-gray-900 mb-6 flex items-center gap-1 transition-colors">
                    ← Volver
                </button>
                <h2 className="text-2xl font-bold text-suprema-gray-900 mb-1">Nuevo Visitante</h2>
                <p className="text-sm text-suprema-gray-500 mb-7">
                    Completa los datos del visitante. Se enviará un <strong>Magic Link</strong> a su correo para que finalice el registro.
                </p>

                <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm p-6 space-y-5">

                    {/* Host (readonly) */}
                    <div>
                        <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Anfitrión</label>
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-suprema-gray-50 border border-suprema-gray-100 text-sm text-suprema-gray-700 font-medium">
                            <UserCheck size={15} className="text-suprema-burgundy flex-shrink-0" />
                            {hostName}
                        </div>
                    </div>

                    {/* Doc type + number */}
                    <div>
                        <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Tipo de identificación <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <IdCard size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                            <select
                                value={form.documentType}
                                onChange={e => setField('documentType', e.target.value)}
                                className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none appearance-none bg-white"
                            >
                                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-400 pointer-events-none" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Número de identificación <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                            <input
                                type="text"
                                value={form.documentNumber}
                                onChange={e => setField('documentNumber', e.target.value)}
                                placeholder="Ej: 1234567890"
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                            />
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Nombre completo <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                            <input
                                type="text"
                                value={form.invitedName}
                                onChange={e => setField('invitedName', e.target.value)}
                                placeholder="Ej: María Gómez"
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                            />
                        </div>
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Correo electrónico <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                            <input
                                type="email"
                                value={form.email}
                                onChange={e => setField('email', e.target.value)}
                                placeholder="visitante@empresa.com"
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                            />
                        </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Inicio visita <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <CalendarDays size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                                <input
                                    type="datetime-local"
                                    value={form.scheduledAt}
                                    onChange={e => setField('scheduledAt', e.target.value)}
                                    className="w-full pl-9 pr-2 py-2.5 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-suprema-gray-500 uppercase tracking-wider mb-1.5">Fin visita</label>
                            <div className="relative">
                                <CalendarDays size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                                <input
                                    type="datetime-local"
                                    value={form.expectedEndAt}
                                    onChange={e => setField('expectedEndAt', e.target.value)}
                                    className="w-full pl-9 pr-2 py-2.5 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {err && (
                        <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
                            {err}
                        </div>
                    )}

                    <button
                        onClick={handleSend}
                        disabled={sending}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-suprema-burgundy hover:bg-suprema-burgundy/90 text-white font-semibold text-sm transition-colors disabled:opacity-60"
                    >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        {sending ? 'Enviando...' : 'Enviar Magic Link'}
                    </button>
                </div>
            </div>
        );
    }

    // ── Home ──
    return (
        <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
            {/* Welcome */}
            <div className="bg-gradient-to-r from-suprema-gray-900 to-suprema-gray-800 rounded-2xl p-7 text-white shadow-xl relative overflow-hidden">
                <div className="absolute right-0 top-0 w-48 h-48 bg-suprema-burgundy/20 rounded-full blur-3xl -mr-12 -mt-12" />
                <div className="relative z-10">
                    <p className="text-white/60 text-sm font-medium mb-1">Bienvenido/a</p>
                    <h1 className="text-2xl font-bold mb-1">{hostName}</h1>
                    <p className="text-white/50 text-sm">Portal de Anfitrión · BioVisitor X</p>
                </div>
            </div>

            {/* Action cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                    onClick={() => setView('invite')}
                    className="group flex flex-col items-center gap-4 p-8 bg-white border-2 border-suprema-gray-100 rounded-2xl shadow-sm hover:border-suprema-burgundy hover:shadow-md transition-all text-center"
                >
                    <div className="w-16 h-16 rounded-2xl bg-suprema-burgundy/10 flex items-center justify-center group-hover:bg-suprema-burgundy/20 transition-colors">
                        <UserPlus size={30} className="text-suprema-burgundy" />
                    </div>
                    <div>
                        <p className="font-bold text-suprema-gray-900 text-lg">Nuevo Visitante</p>
                        <p className="text-sm text-suprema-gray-500 mt-1">Invita a un visitante y envía un Magic Link a su correo</p>
                    </div>
                </button>

                <button
                    disabled
                    className="group flex flex-col items-center gap-4 p-8 bg-white border-2 border-suprema-gray-100 rounded-2xl shadow-sm opacity-60 cursor-not-allowed text-center"
                    title="Próximamente"
                >
                    <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                        <FileSpreadsheet size={30} className="text-blue-400" />
                    </div>
                    <div>
                        <p className="font-bold text-suprema-gray-900 text-lg">Cargar CSV</p>
                        <p className="text-sm text-suprema-gray-500 mt-1">Registra varios visitantes a la vez desde un archivo</p>
                        <span className="mt-2 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">Próximamente</span>
                    </div>
                </button>
            </div>

            <p className="text-center text-xs text-suprema-gray-400">
                Como anfitrión solo puedes invitar visitantes. Para otras acciones, contacta al administrador.
            </p>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardOverview() {
    const router = useRouter();
    const { t } = useI18n();

    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [userName, setUserName] = useState('Admin');
    const [chartRange, setChartRange] = useState<ChartRange>('today');
    const [selectedMonth, setSelectedMonth] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const selectedMonthRef = React.useRef(selectedMonth);
    selectedMonthRef.current = selectedMonth;
    const [showEvacuation, setShowEvacuation] = useState(false);
    const [showPreRegistered, setShowPreRegistered] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [currentUser, setCurrentUser] = useState<{ role?: string; fullName?: string; hostId?: string } | null>(null);

    const fetchStats = useCallback(async (range: ChartRange = chartRange, quiet = false) => {
        if (!quiet) setLoading(true);
        else setRefreshing(true);
        try {
            const params: Record<string, string | number> = { range, tz: new Date().getTimezoneOffset() };
            if (range === 'month') params.month = selectedMonthRef.current;
            const res = await api.get('/reports/dashboard', { params });
            setStats(res.data);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Dashboard stats error:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [chartRange]);

    useEffect(() => {
        const user = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
        setCurrentUser(user);
        if (user.fullName) setUserName(user.fullName.split(' ')[0]);
        if (user.role !== 'HOST') fetchStats();
        else setLoading(false);
    }, []);

    useEffect(() => {
        if (currentUser?.role === 'HOST') return;
        const timer = setInterval(() => fetchStats(chartRange, true), 60000);
        return () => clearInterval(timer);
    }, [fetchStats, chartRange, currentUser]);

    // Re-fetch when user picks a different month (only while in 'month' range)
    useEffect(() => {
        if (currentUser?.role === 'HOST' || chartRange !== 'month') return;
        fetchStats('month', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth]);

    const handleRangeChange = (r: ChartRange) => {
        setChartRange(r);
        if (r === 'month') {
            // reset to current month when switching to month view
            const d = new Date();
            const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            setSelectedMonth(cur);
            selectedMonthRef.current = cur;
        }
        fetchStats(r, true);
    };

    const inBuildingPct = stats && stats.totalToday > 0
        ? Math.round((stats.inBuilding / stats.totalToday) * 100)
        : 0;

    const chartDataFiltered = useMemo(() => {
        if (!stats) return [];
        if (chartRange === 'today') {
            return stats.chartData.filter((_, i) => i >= 6 && i <= 22);
        }
        return stats.chartData;
    }, [stats, chartRange]);

    const xAxisLabel = chartRange === 'today'
        ? t('dashboard.xAxisHour')
        : chartRange === '7d'
        ? t('dashboard.xAxisDayOfWeek')
        : chartRange === 'year'
        ? 'Mes'
        : t('dashboard.xAxisDayOfMonth');

    const rangeButtons: [ChartRange, string][] = [
        ['today', t('dashboard.rangeToday')],
        ['7d', t('dashboard.range7d')],
        ['month', t('dashboard.rangeMonth')],
        ['year', 'Año'],
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center space-y-3">
                    <Loader2 size={36} className="animate-spin text-suprema-burgundy mx-auto" />
                    <p className="text-sm text-suprema-gray-500">{t('dashboard.loadingMetrics')}</p>
                </div>
            </div>
        );
    }

    if (currentUser?.role === 'HOST') {
        return (
            <HostDashboard
                hostName={currentUser.fullName ?? 'Anfitrión'}
                hostId={currentUser.hostId ?? ''}
            />
        );
    }

    return (
        <>
            <div className="space-y-5 max-w-7xl mx-auto">

                {/* ── Welcome Banner ── */}
                <div className="bg-gradient-to-r from-suprema-gray-900 to-suprema-gray-800 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
                    <div className="absolute right-0 top-0 w-64 h-64 bg-suprema-burgundy/20 rounded-full blur-3xl -mr-16 -mt-16" />
                    <div className="absolute right-12 bottom-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mb-8" />
                    <div className="relative z-10 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold mb-1">{t('dashboard.welcomeHi', { name: userName })}</h2>
                            <p className="text-white/60 text-sm">
                                {stats
                                    ? t('dashboard.inBuildingSubtitle', {
                                        count: String(stats.inBuilding),
                                        p: stats.inBuilding !== 1 ? 's' : '',
                                        total: String(stats.totalToday),
                                        tp: stats.totalToday !== 1 ? 's' : '',
                                    })
                                    : t('dashboard.loadingData')}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            {lastUpdated && (
                                <p className="text-xs text-white/40 hidden sm:block">
                                    {t('dashboard.updatedAt', { time: lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}
                                </p>
                            )}
                            <button
                                onClick={() => fetchStats(chartRange, true)}
                                disabled={refreshing}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-semibold transition-colors"
                            >
                                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                                {refreshing ? t('dashboard.refreshing') : t('dashboard.refresh')}
                            </button>
                            <button
                                onClick={() => router.push('/dashboard/visitors')}
                                className="flex items-center gap-1.5 px-4 py-2 bg-suprema-burgundy hover:bg-suprema-burgundy-dark rounded-xl text-sm font-bold transition-colors shadow-md shadow-suprema-burgundy/40"
                            >
                                <Users size={15} />
                                {t('dashboard.newVisitorBtn')}
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── KPI Row ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <KpiCard
                        label={t('dashboard.kpiInBuilding')}
                        value={stats?.inBuilding ?? 0}
                        sub={t('dashboard.kpiInBuildingSub', { pct: String(inBuildingPct), total: String(stats?.totalToday ?? 0) })}
                        icon={<Building2 size={20} className="text-emerald-600" />}
                        colorCls="text-emerald-600"
                        onClick={() => setShowEvacuation(true)}
                    />
                    <KpiCard
                        label={t('dashboard.kpiOverstay')}
                        value={stats?.overstayCount ?? 0}
                        sub={stats?.overstayCount ? t('dashboard.kpiOverstayAlert') : t('dashboard.kpiNoAlerts')}
                        icon={<ShieldAlert size={20} className={stats?.overstayCount ? 'text-red-600' : 'text-suprema-gray-400'} />}
                        colorCls={stats?.overstayCount ? 'text-red-600' : 'text-suprema-gray-400'}
                        alert={(stats?.overstayCount ?? 0) > 0}
                        onClick={stats?.overstayCount ? () => router.push('/dashboard/visitors?filter=overstay') : undefined}
                    />
                    <KpiCard
                        label={t('dashboard.kpiPreReg')}
                        value={`${stats?.preRegRate ?? 0}%`}
                        sub={t('dashboard.kpiPreRegSub', {
                            count: String(stats?.preRegCount ?? 0),
                            onSite: String((stats?.totalToday ?? 0) - (stats?.preRegCount ?? 0)),
                        })}
                        icon={<QrCode size={20} className="text-violet-600" />}
                        colorCls="text-violet-600"
                        onClick={() => setShowPreRegistered(true)}
                    />
                    <KpiCard
                        label={t('dashboard.kpiBiostar')}
                        value={stats?.biostarHealthy ? t('dashboard.kpiBiostarOk') : t('dashboard.kpiBiostarAlert')}
                        sub={t('dashboard.kpiBiostarSub', {
                            synced: String(stats?.syncCounts.synced ?? 0),
                            pending: String(stats?.syncCounts.pending ?? 0),
                            failed: String(stats?.syncCounts.failed ?? 0),
                        })}
                        icon={stats?.biostarHealthy
                            ? <Wifi size={20} className="text-emerald-600" />
                            : <WifiOff size={20} className="text-amber-500" />}
                        colorCls={stats?.biostarHealthy ? 'text-emerald-600' : 'text-amber-500'}
                    />
                </div>

                {/* ── Charts Row ── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                    {/* Affluence Bar Chart */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-suprema-gray-100 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                                <TrendingUp size={18} className="text-suprema-burgundy" />
                                <h3 className="font-bold text-suprema-gray-900">{t('dashboard.affluenceMap')}</h3>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="flex gap-1">
                                    {rangeButtons.map(([r, l]) => (
                                        <button
                                            key={r}
                                            onClick={() => handleRangeChange(r)}
                                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                                chartRange === r
                                                    ? 'bg-suprema-burgundy text-white'
                                                    : 'border border-suprema-gray-200 text-suprema-gray-600 hover:bg-suprema-gray-50'
                                            }`}
                                        >
                                            {l}
                                        </button>
                                    ))}
                                </div>
                                {chartRange === 'month' && (
                                    <input
                                        type="month"
                                        value={selectedMonth}
                                        min="2025-01"
                                        max={`${new Date().getFullYear()}-12`}
                                        onChange={e => {
                                            if (e.target.value) setSelectedMonth(e.target.value);
                                        }}
                                        className="text-xs border border-suprema-gray-200 rounded-lg px-2 py-1 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none bg-white text-suprema-gray-700"
                                    />
                                )}
                            </div>
                        </div>

                        {refreshing ? (
                            <div className="flex items-center justify-center h-48 text-suprema-gray-300">
                                <Loader2 size={24} className="animate-spin" />
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={chartDataFiltered} margin={{ top: 4, right: 4, left: 12, bottom: 0 }}>
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 11, fill: '#6b7280' }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{
                                            value: xAxisLabel,
                                            position: 'insideBottom',
                                            offset: 6,
                                            style: { fontSize: 10, fill: '#9ca3af', textAnchor: 'middle' },
                                        }}
                                        height={32}
                                    />
                                    <YAxis
                                        allowDecimals={false}
                                        tick={{ fontSize: 11, fill: '#6b7280' }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{
                                            value: t('dashboard.yAxisVisits'),
                                            angle: -90,
                                            position: 'insideLeft',
                                            offset: -2,
                                            style: { fontSize: 10, fill: '#9ca3af', textAnchor: 'middle' },
                                        }}
                                    />
                                    <Tooltip content={<BarTooltip />} cursor={{ fill: '#f3f4f6', radius: 4 }} />
                                    <Bar
                                        dataKey="count"
                                        fill="#A11A36"
                                        radius={[4, 4, 0, 0]}
                                        maxBarSize={32}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        )}

                        {!refreshing && chartDataFiltered.every((d) => d.count === 0) && (
                            <p className="text-center text-xs text-suprema-gray-400 -mt-4">{t('dashboard.noDataPeriod')}</p>
                        )}
                    </div>

                    {/* Purpose Doughnut */}
                    <div className="bg-white rounded-2xl border border-suprema-gray-100 p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-5">
                            <Activity size={18} className="text-suprema-burgundy" />
                            <h3 className="font-bold text-suprema-gray-900">{t('dashboard.purposeTitle')}</h3>
                        </div>

                        {stats?.purposeData && stats.purposeData.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height={160}>
                                    <PieChart>
                                        <Pie
                                            data={stats.purposeData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={45}
                                            outerRadius={72}
                                            paddingAngle={2}
                                            dataKey="value"
                                        >
                                            {stats.purposeData.map((_, index) => (
                                                <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<PieTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <ul className="space-y-1.5 mt-3">
                                    {stats.purposeData.slice(0, 5).map((item, i) => (
                                        <li key={i} className="flex items-center justify-between text-xs">
                                            <span className="flex items-center gap-1.5">
                                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                                                <span className="text-suprema-gray-700 truncate max-w-[120px]">{item.name}</span>
                                            </span>
                                            <span className="font-bold text-suprema-gray-900 ml-2">{item.value}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <div className="flex items-center justify-center h-48 text-suprema-gray-300">
                                <p className="text-sm">{t('dashboard.noDataToday')}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Recent Arrivals + Actions ── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                    {/* Recent arrivals */}
                    <div className="lg:col-span-2 bg-white rounded-2xl border border-suprema-gray-100 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <UserCheck size={18} className="text-suprema-burgundy" />
                                <h3 className="font-bold text-suprema-gray-900">{t('dashboard.recentArrivals')}</h3>
                            </div>
                            <button
                                onClick={() => router.push('/dashboard/visitors')}
                                className="text-xs text-suprema-burgundy font-semibold hover:underline"
                            >
                                {t('dashboard.viewAll')}
                            </button>
                        </div>

                        {!stats?.recentArrivals || stats.recentArrivals.length === 0 ? (
                            <div className="flex items-center justify-center py-10 text-suprema-gray-300">
                                <p className="text-sm">{t('dashboard.noRecentVisits')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {stats.recentArrivals.slice(0, 6).map((v) => (
                                    <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-suprema-gray-50 transition-colors">
                                        <div className="w-9 h-9 rounded-full overflow-hidden bg-suprema-gray-100 flex-shrink-0 flex items-center justify-center text-xs font-bold text-suprema-gray-600">
                                            {v.photoPath ? (
                                                <AuthImage
                                                    src={`/visitors/${v.visitorId}/photo`}
                                                    alt={v.visitorName}
                                                    className="w-full h-full object-cover"
                                                    fallback={<span>{v.visitorName[0]}</span>}
                                                />
                                            ) : (
                                                v.visitorName[0]
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-suprema-gray-900 truncate">{v.visitorName}</p>
                                            <p className="text-xs text-suprema-gray-500 truncate">
                                                {v.company || t('dashboard.noCompany')} · {v.hostName || t('dashboard.noHostName')}
                                            </p>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                v.status === 'CHECKED_IN'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : 'bg-blue-100 text-blue-700'
                                            }`}>
                                                {v.status === 'CHECKED_IN' ? t('dashboard.inFacilities') : t('dashboard.scheduled')}
                                            </span>
                                            <p className="text-[10px] text-suprema-gray-400 mt-0.5">
                                                {v.checkedInAt
                                                    ? `${minutesAgo(v.checkedInAt)}m`
                                                    : fmtTime(v.scheduledAt)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Quick actions + sync summary */}
                    <div className="space-y-4">
                        {/* Quick actions */}
                        <div className="bg-white rounded-2xl border border-suprema-gray-100 p-5 shadow-sm">
                            <h3 className="font-bold text-suprema-gray-900 mb-3">{t('dashboard.quickActionsTitle')}</h3>
                            <div className="space-y-2.5">
                                <button
                                    onClick={() => router.push('/dashboard/visitors')}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-suprema-burgundy text-white rounded-xl font-semibold text-sm hover:bg-suprema-burgundy-dark transition-colors shadow-md shadow-suprema-burgundy/20"
                                >
                                    <Users size={16} /> {t('dashboard.registerVisitorBtn')}
                                </button>
                                <button
                                    onClick={() => setShowEvacuation(true)}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 transition-colors"
                                >
                                    <Building2 size={16} /> {t('dashboard.evacuationBtn')}
                                </button>
                                <button
                                    onClick={() => router.push('/dashboard/reports')}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white border-2 border-suprema-gray-100 text-suprema-gray-800 rounded-xl font-semibold text-sm hover:bg-suprema-gray-50 transition-colors"
                                >
                                    <TrendingUp size={16} /> {t('dashboard.viewReports')}
                                </button>
                            </div>
                        </div>

                        {/* Sync status */}
                        <div className="bg-white rounded-2xl border border-suprema-gray-100 p-5 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                                <Wifi size={16} className={stats?.biostarHealthy ? 'text-emerald-600' : 'text-amber-500'} />
                                <h3 className="font-bold text-suprema-gray-900">{t('dashboard.syncStatusTitle')}</h3>
                                <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                                    stats?.biostarHealthy
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {stats?.biostarHealthy ? t('dashboard.syncOperative') : t('dashboard.syncCheck')}
                                </span>
                            </div>
                            <div className="space-y-2">
                                {[
                                    { key: 'syncSynced', value: stats?.syncCounts.synced ?? 0, cls: 'text-emerald-600 bg-emerald-50', icon: <CheckCircle2 size={12} /> },
                                    { key: 'syncPending', value: stats?.syncCounts.pending ?? 0, cls: 'text-amber-600 bg-amber-50', icon: <Clock size={12} /> },
                                    { key: 'syncFailed', value: stats?.syncCounts.failed ?? 0, cls: 'text-red-600 bg-red-50', icon: <AlertTriangle size={12} /> },
                                ].map((s) => (
                                    <div key={s.key} className="flex items-center justify-between">
                                        <span className="text-xs text-suprema-gray-600 flex items-center gap-1">
                                            <span className={`p-0.5 rounded ${s.cls}`}>{s.icon}</span>
                                            {t(`dashboard.${s.key}`)}
                                        </span>
                                        <span className={`text-sm font-bold ${s.cls.split(' ')[0]}`}>{s.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Pre-Registered Modal ── */}
            {showPreRegistered && (
                <PreRegisteredModal onClose={() => setShowPreRegistered(false)} />
            )}

            {/* ── Evacuation Modal ── */}
            {showEvacuation && stats && (
                <EvacuationModal
                    visitors={stats.inBuildingList}
                    onClose={() => setShowEvacuation(false)}
                />
            )}
        </>
    );
}
