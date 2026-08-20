'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Laptop, Plus, Search, RefreshCw, Download, LogOut, CheckCircle,
    XCircle, Clock, AlertTriangle, ChevronDown, X, Loader2, Filter,
    Eye, Trash2, FileText, Package,
} from 'lucide-react';
import { api } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

type EquipmentStatus = 'PENDING_AUTH' | 'AUTHORIZED' | 'INSIDE' | 'EXITED' | 'REJECTED';
type EquipmentCategory = 'LAPTOP' | 'TABLET' | 'PHONE' | 'CAMERA' | 'STORAGE' | 'TOOL' | 'BIOMETRIC' | 'OTHER';

interface EquipmentEntry {
    id: string;
    serialNumber: string;
    brand: string;
    model: string;
    category: EquipmentCategory;
    responsibleName: string;
    hostArea: string;
    visitId: string | null;
    status: EquipmentStatus;
    entryAt: string;
    exitAt: string | null;
    authorizationCode: string | null;
    authorizedById: string | null;
    authorizedAt: string | null;
    rejectedReason: string | null;
    notes: string | null;
    maxStayHours: number;
    overtimeAlertSent: boolean;
    createdByName: string | null;
    createdAt: string;
}

interface Stats {
    inside: number;
    pendingAuth: number;
    exitedToday: number;
    overtime: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
    LAPTOP: 'Laptop', TABLET: 'Tablet', PHONE: 'Celular',
    CAMERA: 'Cámara', STORAGE: 'Almacenamiento', TOOL: 'Herramienta',
    BIOMETRIC: 'Dispositivo Biométrico', OTHER: 'Otro',
};

const STATUS_CONFIG: Record<EquipmentStatus, { label: string; color: string; icon: React.ReactNode }> = {
    PENDING_AUTH: { label: 'Pend. autorización', color: 'bg-amber-100 text-amber-800 border-amber-200',  icon: <Clock size={11} /> },
    AUTHORIZED:   { label: 'Autorizado',          color: 'bg-blue-100 text-blue-800 border-blue-200',    icon: <CheckCircle size={11} /> },
    INSIDE:       { label: 'En instalaciones',     color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: <Package size={11} /> },
    EXITED:       { label: 'Salió',                color: 'bg-gray-100 text-gray-700 border-gray-200',   icon: <LogOut size={11} /> },
    REJECTED:     { label: 'Rechazado',            color: 'bg-red-100 text-red-800 border-red-200',      icon: <XCircle size={11} /> },
};

const CATEGORIES: EquipmentCategory[] = ['LAPTOP', 'TABLET', 'PHONE', 'CAMERA', 'STORAGE', 'TOOL', 'BIOMETRIC', 'OTHER'];
const STATUSES: EquipmentStatus[] = ['PENDING_AUTH', 'AUTHORIZED', 'INSIDE', 'EXITED', 'REJECTED'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function fmtShortDate(iso: string | null | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
}

function durationHours(entryAt: string, exitAt: string | null) {
    const exit = exitAt ? new Date(exitAt) : new Date();
    const h = (exit.getTime() - new Date(entryAt).getTime()) / 3600_000;
    return h.toFixed(1) + ' h';
}

// ── Register Modal ────────────────────────────────────────────────────────────

interface RegisterModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

function RegisterModal({ isOpen, onClose, onSaved }: RegisterModalProps) {
    const empty = {
        serialNumber: '', brand: '', model: '',
        category: 'LAPTOP' as EquipmentCategory,
        responsibleName: '', hostArea: '',
        authorizationCode: '', notes: '',
        maxStayHours: 8, requiresAuth: false,
    };
    const [form, setForm] = useState({ ...empty });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) { setForm({ ...empty }); setError(null); }
    }, [isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        setForm(p => ({ ...p, [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await api.post('/equipment', {
                ...form,
                maxStayHours: Number(form.maxStayHours),
                authorizationCode: form.authorizationCode || undefined,
                notes: form.notes || undefined,
            });
            onSaved();
            onClose();
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Error al registrar el equipo.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const inp = 'w-full px-3 py-2 border border-suprema-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy bg-white';
    const lbl = 'block text-xs font-semibold text-suprema-gray-700 mb-1';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-suprema-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
                            <Laptop size={18} className="text-suprema-burgundy" />
                        </div>
                        <div>
                            <h2 className="font-bold text-suprema-gray-900">Registrar Ingreso de Equipo</h2>
                            <p className="text-xs text-suprema-gray-800/50">Complete los datos del equipo</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-suprema-gray-100 transition-colors">
                        <X size={18} className="text-suprema-gray-700" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                            <label className={lbl}>Número de Serie <span className="text-red-500">*</span></label>
                            <input name="serialNumber" value={form.serialNumber} onChange={handleChange} required
                                placeholder="Ej: SN-DELL-XPS-001" className={inp} />
                        </div>
                        <div>
                            <label className={lbl}>Marca <span className="text-red-500">*</span></label>
                            <input name="brand" value={form.brand} onChange={handleChange} required
                                placeholder="Ej: Dell" className={inp} />
                        </div>
                        <div>
                            <label className={lbl}>Modelo <span className="text-red-500">*</span></label>
                            <input name="model" value={form.model} onChange={handleChange} required
                                placeholder="Ej: XPS 15 9500" className={inp} />
                        </div>
                        <div>
                            <label className={lbl}>Categoría <span className="text-red-500">*</span></label>
                            <select name="category" value={form.category} onChange={handleChange} className={inp}>
                                {CATEGORIES.map(c => (
                                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className={lbl}>Nombre del Responsable <span className="text-red-500">*</span></label>
                            <input name="responsibleName" value={form.responsibleName} onChange={handleChange} required
                                placeholder="Nombre completo del portador" className={inp} />
                        </div>
                        <div className="col-span-2">
                            <label className={lbl}>Área / Departamento destino <span className="text-red-500">*</span></label>
                            <input name="hostArea" value={form.hostArea} onChange={handleChange} required
                                placeholder="Ej: Sala de servidores — Piso 3" className={inp} />
                        </div>
                        <div className="col-span-2">
                            <label className={lbl}>Código de Autorización Previa</label>
                            <input name="authorizationCode" value={form.authorizationCode} onChange={handleChange}
                                placeholder="Opcional — referencia de aprobación externa" className={inp} />
                        </div>
                        <div className="col-span-2">
                            <label className={lbl}>Notas</label>
                            <textarea name="notes" value={form.notes} onChange={handleChange} rows={2}
                                placeholder="Observaciones adicionales…" className={inp} />
                        </div>
                        <div className="col-span-2">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" name="requiresAuth" checked={form.requiresAuth}
                                    onChange={handleChange} className="w-4 h-4 accent-suprema-burgundy" />
                                <span className="text-sm text-suprema-gray-800">
                                    Requiere autorización previa (crea en estado Pendiente)
                                </span>
                            </label>
                        </div>
                    </div>
                </form>

                <div className="p-5 border-t border-suprema-gray-100 flex gap-3 justify-end">
                    <button type="button" onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} disabled={loading}
                        className="px-5 py-2 text-sm font-semibold text-white bg-suprema-burgundy hover:bg-suprema-burgundy-dark rounded-xl transition-colors flex items-center gap-2 disabled:opacity-60">
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        Registrar Ingreso
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Detail / Exit Modal ───────────────────────────────────────────────────────

interface DetailModalProps {
    entry: EquipmentEntry | null;
    userRole: string;
    onClose: () => void;
    onRefresh: () => void;
}

function DetailModal({ entry, userRole, onClose, onRefresh }: DetailModalProps) {
    const [exitNotes, setExitNotes] = useState('');
    const [rejectReason, setRejectReason] = useState('');
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showExitForm, setShowExitForm] = useState(false);
    const [showRejectForm, setShowRejectForm] = useState(false);

    useEffect(() => {
        if (entry) {
            setExitNotes(''); setRejectReason('');
            setError(null); setShowExitForm(false); setShowRejectForm(false);
        }
    }, [entry?.id]);

    if (!entry) return null;

    const canAuth = ['ADMIN', 'SUPERVISOR'].includes(userRole);
    const canWrite = ['ADMIN', 'SUPERVISOR', 'OPERATOR', 'SECURITY'].includes(userRole);

    const doAction = async (action: string, body: object = {}) => {
        setLoading(action);
        setError(null);
        try {
            await api.post(`/equipment/${entry.id}/${action}`, body);
            onRefresh();
            onClose();
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Error al procesar la acción.');
        } finally {
            setLoading(null);
        }
    };

    const sc = STATUS_CONFIG[entry.status];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-suprema-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
                            <Package size={18} className="text-suprema-burgundy" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="font-bold text-suprema-gray-900">{entry.brand} {entry.model}</h2>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${sc.color}`}>
                                    {sc.icon} {sc.label}
                                </span>
                            </div>
                            <p className="text-xs text-suprema-gray-800/50 font-mono">{entry.serialNumber}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-suprema-gray-100">
                        <X size={18} className="text-suprema-gray-700" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-suprema-gray-50 rounded-xl p-3">
                            <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">Categoría</p>
                            <p className="font-medium">{CATEGORY_LABELS[entry.category]}</p>
                        </div>
                        <div className="bg-suprema-gray-50 rounded-xl p-3">
                            <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">Responsable</p>
                            <p className="font-medium">{entry.responsibleName}</p>
                        </div>
                        <div className="col-span-2 bg-suprema-gray-50 rounded-xl p-3">
                            <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">Área de Destino</p>
                            <p className="font-medium">{entry.hostArea}</p>
                        </div>
                        <div className="bg-suprema-gray-50 rounded-xl p-3">
                            <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">Ingreso</p>
                            <p className="font-medium text-xs">{fmtDate(entry.entryAt)}</p>
                        </div>
                        <div className="bg-suprema-gray-50 rounded-xl p-3">
                            <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">
                                {entry.exitAt ? 'Salida' : 'Tiempo en sitio'}
                            </p>
                            <p className="font-medium text-xs">
                                {entry.exitAt ? fmtDate(entry.exitAt) : durationHours(entry.entryAt, null)}
                            </p>
                        </div>
                        {entry.authorizationCode && (
                            <div className="col-span-2 bg-suprema-gray-50 rounded-xl p-3">
                                <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">Código Autorización</p>
                                <p className="font-mono text-sm">{entry.authorizationCode}</p>
                            </div>
                        )}
                        {entry.rejectedReason && (
                            <div className="col-span-2 bg-red-50 border border-red-100 rounded-xl p-3">
                                <p className="text-xs text-red-600 font-semibold uppercase tracking-wide mb-1">Motivo de rechazo</p>
                                <p className="text-sm text-red-700">{entry.rejectedReason}</p>
                            </div>
                        )}
                        {entry.notes && (
                            <div className="col-span-2 bg-suprema-gray-50 rounded-xl p-3">
                                <p className="text-xs text-suprema-gray-800/50 font-semibold uppercase tracking-wide mb-1">Notas</p>
                                <p className="text-sm">{entry.notes}</p>
                            </div>
                        )}
                        {entry.overtimeAlertSent && entry.status === 'INSIDE' && (
                            <div className="col-span-2 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                <AlertTriangle size={14} className="text-amber-600" />
                                <span className="text-xs text-amber-800 font-semibold">Tiempo de estadía excedido — alerta enviada</span>
                            </div>
                        )}
                        <div className="col-span-2 text-xs text-suprema-gray-800/40">
                            Registrado por {entry.createdByName ?? 'sistema'} · {fmtDate(entry.createdAt)}
                        </div>
                    </div>

                    {/* ── Acciones ── */}
                    <div className="space-y-3 pt-2 border-t border-suprema-gray-100">
                        {/* Autorizar (PENDING_AUTH → INSIDE) */}
                        {entry.status === 'PENDING_AUTH' && canAuth && (
                            <button onClick={() => doAction('authorize')} disabled={!!loading}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
                                {loading === 'authorize' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                                Autorizar Ingreso
                            </button>
                        )}

                        {/* Rechazar */}
                        {entry.status === 'PENDING_AUTH' && canAuth && !showRejectForm && (
                            <button onClick={() => setShowRejectForm(true)}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold rounded-xl border border-red-200 transition-colors">
                                <XCircle size={14} /> Rechazar Equipo
                            </button>
                        )}
                        {showRejectForm && (
                            <div className="space-y-2">
                                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                                    rows={2} placeholder="Motivo del rechazo (opcional)…"
                                    className="w-full px-3 py-2 border border-red-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-200 resize-none" />
                                <div className="flex gap-2">
                                    <button onClick={() => setShowRejectForm(false)}
                                        className="flex-1 py-2 text-sm font-medium text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl border border-suprema-gray-200 transition-colors">
                                        Cancelar
                                    </button>
                                    <button onClick={() => doAction('reject', { reason: rejectReason })} disabled={!!loading}
                                        className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                                        {loading === 'reject' ? <Loader2 size={12} className="animate-spin" /> : null}
                                        Confirmar rechazo
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Registrar Salida */}
                        {['INSIDE', 'AUTHORIZED'].includes(entry.status) && canWrite && !showExitForm && (
                            <button onClick={() => setShowExitForm(true)}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-suprema-burgundy hover:bg-suprema-burgundy-dark text-white text-sm font-semibold rounded-xl transition-colors">
                                <LogOut size={14} /> Registrar Salida
                            </button>
                        )}
                        {showExitForm && (
                            <div className="space-y-2">
                                <textarea value={exitNotes} onChange={e => setExitNotes(e.target.value)}
                                    rows={2} placeholder="Notas de salida (opcional)…"
                                    className="w-full px-3 py-2 border border-suprema-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20 resize-none" />
                                <div className="flex gap-2">
                                    <button onClick={() => setShowExitForm(false)}
                                        className="flex-1 py-2 text-sm font-medium text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl border border-suprema-gray-200 transition-colors">
                                        Cancelar
                                    </button>
                                    <button onClick={() => doAction('exit', { notes: exitNotes })} disabled={!!loading}
                                        className="flex-1 py-2 text-sm font-semibold text-white bg-suprema-burgundy hover:bg-suprema-burgundy-dark rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                                        {loading === 'exit' ? <Loader2 size={12} className="animate-spin" /> : null}
                                        Confirmar salida
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EquipmentPage() {
    const [items, setItems] = useState<EquipmentEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [stats, setStats] = useState<Stats>({ inside: 0, pendingAuth: 0, exitedToday: 0, overtime: 0 });
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<EquipmentStatus | ''>('');
    const [categoryFilter, setCategoryFilter] = useState<EquipmentCategory | ''>('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<EquipmentEntry | null>(null);
    const [userRole, setUserRole] = useState('OPERATOR');
    const [exportingCsv, setExportingCsv] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const LIMIT = 20;

    useEffect(() => {
        const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
        setUserRole(stored.role ?? 'OPERATOR');
    }, []);

    const fetchAll = useCallback(async (p = page) => {
        setLoading(true);
        try {
            const params: Record<string, string> = {
                page: String(p), limit: String(LIMIT),
            };
            if (search) params.search = search;
            if (statusFilter) params.status = statusFilter;
            if (categoryFilter) params.category = categoryFilter;
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo) params.dateTo = dateTo;

            const [listRes, statsRes] = await Promise.all([
                api.get('/equipment', { params }),
                api.get('/equipment/stats'),
            ]);

            setItems(listRes.data.items ?? []);
            setTotal(listRes.data.total ?? 0);
            setStats(statsRes.data);
        } catch {
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, [page, search, statusFilter, categoryFilter, dateFrom, dateTo]);

    useEffect(() => {
        fetchAll(1);
        setPage(1);
    }, [statusFilter, categoryFilter, dateFrom, dateTo]);

    useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => { fetchAll(1); setPage(1); }, 350);
        return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
    }, [search]);

    const handleExport = async (format: 'csv' | 'pdf') => {
        const setter = format === 'csv' ? setExportingCsv : setExportingPdf;
        setter(true);
        try {
            const params: Record<string, string> = {};
            if (search) params.search = search;
            if (statusFilter) params.status = statusFilter;
            if (categoryFilter) params.category = categoryFilter;
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo) params.dateTo = dateTo;

            const res = await api.get(`/equipment/reports/${format}`, {
                params,
                responseType: 'blob',
            });

            const url = URL.createObjectURL(res.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `equipos_${new Date().toISOString().slice(0, 10)}.${format}`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            alert('Error al exportar el reporte.');
        } finally {
            setter(false);
        }
    };

    const totalPages = Math.ceil(total / LIMIT);
    const canExport = ['ADMIN', 'SUPERVISOR'].includes(userRole);
    const canWrite  = ['ADMIN', 'SUPERVISOR', 'OPERATOR', 'SECURITY'].includes(userRole);

    const StatCard = ({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) => (
        <div className="bg-white rounded-2xl border border-suprema-gray-100 p-4">
            <p className="text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-suprema-gray-800/40 mt-0.5">{sub}</p>}
        </div>
    );

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
                        <Laptop size={20} className="text-suprema-burgundy" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-suprema-gray-900">Control de Equipos</h1>
                        <p className="text-sm text-suprema-gray-800/50">Registro y trazabilidad de equipos en instalaciones</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => fetchAll(page)}
                        className="p-2 rounded-xl border border-suprema-gray-200 hover:bg-suprema-gray-100 transition-colors">
                        <RefreshCw size={16} className={`text-suprema-gray-700 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    {canExport && (
                        <>
                            <button onClick={() => handleExport('csv')} disabled={exportingCsv}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-suprema-gray-700 border border-suprema-gray-200 hover:bg-suprema-gray-100 rounded-xl transition-colors disabled:opacity-60">
                                {exportingCsv ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                                CSV
                            </button>
                            <button onClick={() => handleExport('pdf')} disabled={exportingPdf}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-suprema-gray-700 border border-suprema-gray-200 hover:bg-suprema-gray-100 rounded-xl transition-colors disabled:opacity-60">
                                {exportingPdf ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                                PDF
                            </button>
                        </>
                    )}
                    {canWrite && (
                        <button onClick={() => setShowRegisterModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-suprema-burgundy hover:bg-suprema-burgundy-dark text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-suprema-burgundy/20">
                            <Plus size={15} /> Registrar Equipo
                        </button>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard label="En Instalaciones" value={stats.inside} sub="activos ahora" color="text-emerald-600" />
                <StatCard label="Pend. Autorización" value={stats.pendingAuth} sub="esperando aprobación" color="text-amber-600" />
                <StatCard label="Salidas Hoy" value={stats.exitedToday} sub="registradas hoy" color="text-blue-600" />
            </div>

            {/* Filters */}
            <div className="bg-white rounded-2xl border border-suprema-gray-100 p-4 space-y-3">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-800/40" />
                        <input
                            value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por serie, marca, modelo, responsable, área…"
                            className="w-full pl-9 pr-3 py-2 border border-suprema-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy" />
                    </div>
                    <button onClick={() => setShowFilters(p => !p)}
                        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-colors
                            ${showFilters ? 'bg-suprema-burgundy/10 border-suprema-burgundy text-suprema-burgundy' : 'border-suprema-gray-200 text-suprema-gray-700 hover:bg-suprema-gray-100'}`}>
                        <Filter size={13} /> Filtros
                        {(statusFilter || categoryFilter || dateFrom || dateTo) && (
                            <span className="ml-1 w-4 h-4 rounded-full bg-suprema-burgundy text-white text-[10px] flex items-center justify-center">
                                {[statusFilter, categoryFilter, dateFrom || dateTo].filter(Boolean).length}
                            </span>
                        )}
                    </button>
                </div>

                {showFilters && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-suprema-gray-100">
                        <div>
                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Estado</label>
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
                                className="w-full px-3 py-2 border border-suprema-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20">
                                <option value="">Todos</option>
                                {STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Categoría</label>
                            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as any)}
                                className="w-full px-3 py-2 border border-suprema-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20">
                                <option value="">Todas</option>
                                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Desde</label>
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                className="w-full px-3 py-2 border border-suprema-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Hasta</label>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                className="w-full px-3 py-2 border border-suprema-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-suprema-burgundy/20" />
                        </div>
                        {(statusFilter || categoryFilter || dateFrom || dateTo) && (
                            <div className="col-span-2 md:col-span-4 flex justify-end">
                                <button onClick={() => { setStatusFilter(''); setCategoryFilter(''); setDateFrom(''); setDateTo(''); }}
                                    className="flex items-center gap-1 text-xs text-suprema-gray-700 hover:text-suprema-burgundy transition-colors">
                                    <X size={11} /> Limpiar filtros
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-suprema-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-suprema-gray-100 bg-suprema-gray-50/50">
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Equipo</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Serie</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Responsable</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Área</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Ingreso</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Tiempo</th>
                                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wide">Estado</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-16 text-suprema-gray-800/40">
                                        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                                        <p className="text-sm">Cargando registros…</p>
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-16">
                                        <Laptop size={32} className="mx-auto mb-3 text-suprema-gray-800/20" />
                                        <p className="text-sm font-medium text-suprema-gray-800/40">No hay registros de equipos</p>
                                        {canWrite && (
                                            <button onClick={() => setShowRegisterModal(true)}
                                                className="mt-3 text-xs text-suprema-burgundy hover:underline">
                                                Registrar primer equipo
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ) : (
                                items.map(item => {
                                    const sc = STATUS_CONFIG[item.status];
                                    const isOvertime = item.overtimeAlertSent && item.status === 'INSIDE';
                                    return (
                                        <tr key={item.id}
                                            className="border-b border-suprema-gray-50 hover:bg-suprema-gray-50/50 cursor-pointer transition-colors"
                                            onClick={() => setSelectedEntry(item)}>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-lg bg-suprema-gray-100 flex items-center justify-center flex-shrink-0">
                                                        <Laptop size={14} className="text-suprema-gray-700" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-suprema-gray-900 leading-tight">{item.brand} {item.model}</p>
                                                        <p className="text-xs text-suprema-gray-800/40">{CATEGORY_LABELS[item.category]}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="font-mono text-xs bg-suprema-gray-100 px-2 py-0.5 rounded">{item.serialNumber}</span>
                                            </td>
                                            <td className="px-4 py-3 text-suprema-gray-700">{item.responsibleName}</td>
                                            <td className="px-4 py-3 text-suprema-gray-700 max-w-[120px] truncate">{item.hostArea}</td>
                                            <td className="px-4 py-3 text-xs text-suprema-gray-700">{fmtShortDate(item.entryAt)}</td>
                                            <td className="px-4 py-3 text-xs">
                                                {item.exitAt
                                                    ? <span className="text-suprema-gray-800/50">{durationHours(item.entryAt, item.exitAt)}</span>
                                                    : <span className={isOvertime ? 'text-red-600 font-semibold' : 'text-emerald-600'}>{durationHours(item.entryAt, null)}</span>
                                                }
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${sc.color}`}>
                                                    {sc.icon} {sc.label}
                                                </span>
                                                {isOvertime && (
                                                    <AlertTriangle size={12} className="inline ml-1 text-amber-500" aria-label="Overtime" />
                                                )}
                                            </td>
                                            <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => setSelectedEntry(item)}
                                                    className="p-1.5 rounded-lg hover:bg-suprema-gray-100 transition-colors">
                                                    <Eye size={14} className="text-suprema-gray-700" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-suprema-gray-100">
                        <p className="text-xs text-suprema-gray-800/50">
                            {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} de {total} registros
                        </p>
                        <div className="flex gap-1">
                            <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); fetchAll(page - 1); }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-suprema-gray-200 hover:bg-suprema-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                ← Anterior
                            </button>
                            <button disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); fetchAll(page + 1); }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-suprema-gray-200 hover:bg-suprema-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                Siguiente →
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            <RegisterModal
                isOpen={showRegisterModal}
                onClose={() => setShowRegisterModal(false)}
                onSaved={() => fetchAll(1)}
            />
            <DetailModal
                entry={selectedEntry}
                userRole={userRole}
                onClose={() => setSelectedEntry(null)}
                onRefresh={() => fetchAll(page)}
            />
        </div>
    );
}
