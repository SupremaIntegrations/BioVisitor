'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    FileText, Download, Calendar as CalendarIcon, Loader2,
    Users, LogIn, LogOut, AlertTriangle, XCircle, Clock,
    QrCode, CreditCard, Fingerprint, UserCheck, ChevronUp, ChevronDown,
    RefreshCw, Filter, ListFilter, X, Settings2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';
import { usePermissions } from '@/hooks/usePermissions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VisitRow {
    id: string;
    visitorName: string;
    visitorDocument: string;
    visitorCompany: string;
    visitorEmail: string;
    hostName: string;
    purpose: string;
    serviceOrder: string;
    accessMethod: string;
    status: string;
    scheduledAt: string;
    expectedEndAt: string;
    checkedInAt: string;
    checkedOutAt: string;
    durationMinutes: number | null;
}

interface Kpis {
    total: number;
    scheduled: number;
    preRegistered: number;
    checkedIn: number;
    checkedOut: number;
    noShow: number;
    cancelled: number;
    avgDurationMinutes: number | null;
}

interface ReportData {
    kpis: Kpis;
    rows: VisitRow[];
}

type SortDir = 'asc' | 'desc';
type SortKey = keyof VisitRow;

interface ColDef {
    key: SortKey;
    label: string;
    filterable?: boolean;
    defaultVisible?: boolean;
}

// ─── Static maps (non-translated — backed by API values) ──────────────────────

const STATUS_BADGE: Record<string, string> = {
    'Programada':       'bg-blue-100 text-blue-700',
    'Pre-registrada':   'bg-violet-100 text-violet-700',
    'En instalaciones': 'bg-emerald-100 text-emerald-700',
    'Salió':            'bg-suprema-gray-100 text-suprema-gray-600',
    'No se presentó':   'bg-amber-100 text-amber-700',
    'Cancelada':        'bg-red-100 text-red-700',
};

const ACCESS_ICON: Record<string, React.ReactNode> = {
    'QR Dinámico':           <QrCode size={12} />,
    'Tarjeta RFID':          <CreditCard size={12} />,
    'Reconocimiento facial': <UserCheck size={12} />,
    'Huella dactilar':       <Fingerprint size={12} />,
    'Manual':                <Users size={12} />,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDt(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function today(): string { return new Date().toISOString().split('T')[0]; }
function daysAgo(n: number): string {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
}
function startOfMonth(): string {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
}

function sortRows(rows: VisitRow[], key: SortKey, dir: SortDir): VisitRow[] {
    return [...rows].sort((a, b) => {
        const av = a[key] ?? ''; const bv = b[key] ?? '';
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
    });
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color }: {
    label: string; value: string | number; icon: React.ReactNode; color: string;
}) {
    return (
        <div className={`rounded-xl p-4 border flex items-center gap-3 ${color}`}>
            <div className="flex-shrink-0 opacity-80">{icon}</div>
            <div>
                <p className="text-2xl font-bold leading-none">{value}</p>
                <p className="text-xs mt-1 opacity-70 font-medium">{label}</p>
            </div>
        </div>
    );
}

// ─── Column Filter Popover ────────────────────────────────────────────────────

interface FilterPopoverProps {
    col: SortKey;
    label: string;
    anchorRect: DOMRect;
    draft: string;
    suggestions: string[];
    onDraftChange: (v: string) => void;
    onSelect: (v: string) => void;
    onClear: () => void;
    onClose: () => void;
    hasActive: boolean;
}

function FilterPopover({
    label, anchorRect, draft, suggestions,
    onDraftChange, onSelect, onClear, onClose, hasActive,
}: FilterPopoverProps) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    return (
        <div
            ref={ref}
            style={{ position: 'fixed', top: anchorRect.bottom + 4, left: Math.min(anchorRect.left, window.innerWidth - 260), zIndex: 9999 }}
            className="w-60 bg-white rounded-xl shadow-xl border border-suprema-gray-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex items-center justify-between px-3 py-2 bg-suprema-gray-50 border-b border-suprema-gray-100">
                <span className="text-xs font-bold text-suprema-gray-700 uppercase tracking-wide">
                    {t('reports.filterBy', { label })}
                </span>
                <button onClick={onClose} className="text-suprema-gray-400 hover:text-suprema-gray-700">
                    <X size={13} />
                </button>
            </div>

            <div className="px-3 pt-2.5 pb-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={draft}
                    onChange={(e) => onDraftChange(e.target.value)}
                    placeholder={t('reports.writePlaceholder', { label: label.toLowerCase() })}
                    className="w-full text-sm border border-suprema-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                />
            </div>

            {suggestions.length > 0 && (
                <ul className="max-h-52 overflow-y-auto border-t border-suprema-gray-100">
                    {suggestions.map((s, i) => (
                        <li key={i}>
                            <button
                                onMouseDown={(e) => { e.preventDefault(); onSelect(s); }}
                                className="w-full text-left px-3 py-2 text-sm text-suprema-gray-800 hover:bg-suprema-burgundy/5 hover:text-suprema-burgundy transition-colors flex items-center gap-2"
                            >
                                {draft ? (
                                    <>
                                        <span className="font-semibold text-suprema-burgundy">
                                            {s.slice(0, draft.length)}
                                        </span>
                                        <span>{s.slice(draft.length)}</span>
                                    </>
                                ) : s}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {suggestions.length === 0 && draft && (
                <p className="px-3 py-2 text-xs text-suprema-gray-400 border-t border-suprema-gray-100">
                    {t('reports.noMatches', { q: draft })}
                </p>
            )}

            <div className="flex gap-2 px-3 py-2 border-t border-suprema-gray-100 bg-suprema-gray-50">
                <button
                    onMouseDown={(e) => { e.preventDefault(); if (draft) onSelect(draft); }}
                    className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-suprema-burgundy text-white hover:bg-suprema-burgundy-dark transition-colors"
                >
                    {t('reports.apply')}
                </button>
                {hasActive && (
                    <button
                        onMouseDown={(e) => { e.preventDefault(); onClear(); }}
                        className="flex-1 text-xs font-semibold py-1.5 rounded-lg border border-suprema-gray-200 text-suprema-gray-600 hover:bg-suprema-gray-100 transition-colors"
                    >
                        {t('reports.clear')}
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Column Settings Modal ────────────────────────────────────────────────────

function ColumnSettingsModal({
    allCols,
    visibility,
    onApply,
    onClose,
}: {
    allCols: ColDef[];
    visibility: Record<string, boolean>;
    onApply: (v: Record<string, boolean>) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState<Record<string, boolean>>({ ...visibility });
    const toggle = (key: string) => setDraft(prev => ({ ...prev, [key]: !prev[key] }));
    const resetDefaults = () => {
        const d: Record<string, boolean> = {};
        allCols.forEach(c => { d[c.key] = c.defaultVisible ?? true; });
        setDraft(d);
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-80 border border-suprema-gray-200 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-suprema-gray-200">
                    <span className="font-bold text-suprema-gray-900 text-sm">Configuración de Columnas</span>
                    <button onClick={onClose} className="text-suprema-gray-400 hover:text-suprema-gray-700 transition-colors">
                        <X size={14} />
                    </button>
                </div>
                <div className="flex items-center justify-between px-4 py-2 bg-suprema-gray-50 border-b border-suprema-gray-100">
                    <span className="text-xs font-semibold text-suprema-gray-500 uppercase tracking-wide">[ Lista de Columnas ]</span>
                    <button
                        onClick={resetDefaults}
                        className="text-xs font-semibold border border-suprema-gray-200 bg-white px-3 py-1 rounded-lg text-suprema-gray-700 hover:bg-suprema-gray-100 transition-colors"
                    >
                        Predeterminadas
                    </button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-suprema-gray-50">
                    {allCols.map(col => (
                        <label key={col.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-suprema-gray-50 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={draft[col.key] !== false}
                                onChange={() => toggle(col.key)}
                                className="w-4 h-4 rounded cursor-pointer accent-suprema-burgundy"
                            />
                            <span className="text-sm text-suprema-gray-800">{col.label}</span>
                        </label>
                    ))}
                </div>
                <div className="flex gap-2 px-4 py-3 border-t border-suprema-gray-100 bg-suprema-gray-50 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold border border-suprema-gray-200 rounded-xl text-suprema-gray-700 hover:bg-suprema-gray-100 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => onApply(draft)}
                        className="px-4 py-2 text-sm font-semibold bg-suprema-burgundy text-white rounded-xl hover:bg-suprema-burgundy-dark transition-colors"
                    >
                        Aplicar
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
    const { t } = useI18n();
    const { canViewPage } = usePermissions();
    useEffect(() => {
        const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
        if (stored.role === 'OPERATOR' && !canViewPage('reports')) window.location.href = '/dashboard';
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [startDate, setStartDate] = useState(() => startOfMonth());
    const [endDate, setEndDate] = useState(() => today());
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [accessFilter, setAccessFilter] = useState('ALL');

    const [data, setData] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isExportingCsv, setIsExportingCsv] = useState(false);
    const [isExportingPdf, setIsExportingPdf] = useState(false);

    const [sortKey, setSortKey] = useState<SortKey>('scheduledAt');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [searchQuery, setSearchQuery] = useState('');

    const [pageSize, setPageSize] = useState(25);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
    const pageSizeMenuRef = useRef<HTMLDivElement>(null);

    const [showColSettings, setShowColSettings] = useState(false);
    const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(() => {
        try {
            const stored = localStorage.getItem('biovisitor_report_cols');
            if (stored) return JSON.parse(stored);
        } catch { /* ignore */ }
        return {
            visitorDocument: true, visitorName: true, visitorCompany: true, visitorEmail: true,
            hostName: true, purpose: true, serviceOrder: false, accessMethod: true, status: true,
            scheduledAt: true, expectedEndAt: true, checkedInAt: true, checkedOutAt: true, durationMinutes: true,
        };
    });

    const applyColVisibility = (v: Record<string, boolean>) => {
        setColVisibility(v);
        try { localStorage.setItem('biovisitor_report_cols', JSON.stringify(v)); } catch { /* ignore */ }
        setShowColSettings(false);
    };

    const [columnFilters, setColumnFilters] = useState<Partial<Record<SortKey, string>>>({});
    const [openFilterCol, setOpenFilterCol] = useState<SortKey | null>(null);
    const [filterAnchor, setFilterAnchor] = useState<DOMRect | null>(null);
    const [filterDraft, setFilterDraft] = useState('');

    // ── Translated column/filter definitions (computed inside component) ──────

    const ALL_COLUMNS: ColDef[] = [
        { key: 'visitorDocument', label: t('reports.colVisitorDocument'), filterable: true,  defaultVisible: true },
        { key: 'visitorName',     label: t('reports.colVisitorName'),     filterable: true,  defaultVisible: true },
        { key: 'visitorCompany',  label: t('reports.colVisitorCompany'),  filterable: true,  defaultVisible: true },
        { key: 'visitorEmail',    label: t('reports.colVisitorEmail'),    filterable: true,  defaultVisible: true },
        { key: 'hostName',        label: t('reports.colHostName'),        filterable: true,  defaultVisible: true },
        { key: 'purpose',         label: t('reports.colPurpose'),         filterable: true,  defaultVisible: true },
        { key: 'serviceOrder',    label: 'Orden de Servicio',             filterable: true,  defaultVisible: false },
        { key: 'accessMethod',    label: t('reports.colAccessMethod'),    filterable: true,  defaultVisible: true },
        { key: 'status',          label: t('reports.colStatus'),          filterable: true,  defaultVisible: true },
        { key: 'scheduledAt',     label: t('reports.colScheduledAt'),     filterable: false, defaultVisible: true },
        { key: 'expectedEndAt',   label: t('reports.colExpectedEndAt'),   filterable: false, defaultVisible: true },
        { key: 'checkedInAt',     label: t('reports.colCheckedInAt'),     filterable: false, defaultVisible: true },
        { key: 'checkedOutAt',    label: t('reports.colCheckedOutAt'),    filterable: false, defaultVisible: true },
        { key: 'durationMinutes', label: t('reports.colDurationMinutes'), filterable: false, defaultVisible: true },
    ];

    const COLUMNS = ALL_COLUMNS.filter(c => colVisibility[c.key] !== false);

    const STATUS_OPTIONS = [
        { value: 'ALL',            label: t('reports.statusAll') },
        { value: 'SCHEDULED',      label: t('reports.statusScheduled') },
        { value: 'PRE_REGISTERED', label: t('reports.statusPreReg') },
        { value: 'CHECKED_IN',     label: t('reports.statusCheckedIn') },
        { value: 'CHECKED_OUT',    label: t('reports.statusCheckedOut') },
        { value: 'NO_SHOW',        label: t('reports.statusNoShow') },
        { value: 'CANCELLED',      label: t('reports.statusCancelled') },
    ];

    const ACCESS_OPTIONS = [
        { value: 'ALL',         label: t('reports.methodAll') },
        { value: 'QR_DYNAMIC',  label: t('reports.methodQr') },
        { value: 'RFID',        label: t('reports.methodRfid') },
        { value: 'FACE',        label: t('reports.methodFace') },
        { value: 'FINGERPRINT', label: t('reports.methodFingerprint') },
        { value: 'MANUAL',      label: t('reports.methodManual') },
    ];

    const QUICK_RANGES: [string, string, () => void][] = [
        ['today',   t('reports.quickToday'), () => setQuickRange('today')],
        ['week',    t('reports.quick7d'),    () => setQuickRange('week')],
        ['month',   t('reports.quickMonth'), () => setQuickRange('month')],
        ['quarter', t('reports.quick90d'),   () => setQuickRange('quarter')],
    ];

    // ─────────────────────────────────────────────────────────────────────────

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/reports/visits', {
                params: { startDate, endDate, status: statusFilter, accessMethod: accessFilter },
            });
            setData(res.data);
        } catch {
            setError(t('reports.loadingError'));
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, statusFilter, accessFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const suggestions = useMemo<string[]>(() => {
        if (!openFilterCol || !data) return [];
        const allVals = data.rows.map((r) => {
            const v = r[openFilterCol];
            return typeof v === 'string' ? v : v != null ? String(v) : '';
        }).filter(Boolean);
        const unique = Array.from(new Set(allVals)).sort((a, b) => a.localeCompare(b));
        if (!filterDraft.trim()) return unique.slice(0, 10);
        const q = filterDraft.toLowerCase();
        const sw = unique.filter((v) => v.toLowerCase().startsWith(q));
        const inc = unique.filter((v) => !v.toLowerCase().startsWith(q) && v.toLowerCase().includes(q));
        return [...sw, ...inc].slice(0, 10);
    }, [openFilterCol, filterDraft, data]);

    function openFilter(col: SortKey, btn: HTMLButtonElement) {
        if (openFilterCol === col) { setOpenFilterCol(null); return; }
        setFilterAnchor(btn.getBoundingClientRect());
        setFilterDraft(columnFilters[col] ?? '');
        setOpenFilterCol(col);
    }

    function applyColFilter(value: string) {
        if (!openFilterCol) return;
        if (value.trim()) {
            setColumnFilters((prev) => ({ ...prev, [openFilterCol]: value.trim() }));
        } else {
            setColumnFilters((prev) => { const n = { ...prev }; delete n[openFilterCol]; return n; });
        }
        setOpenFilterCol(null);
    }

    function clearColFilter(col?: SortKey) {
        const target = col ?? openFilterCol;
        if (!target) return;
        setColumnFilters((prev) => { const n = { ...prev }; delete n[target]; return n; });
        setOpenFilterCol(null);
    }

    function clearAllColFilters() {
        setColumnFilters({});
        setOpenFilterCol(null);
    }

    const activeFilterCount = Object.keys(columnFilters).length;

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir('asc'); }
    };

    const handleExport = async (type: 'csv' | 'pdf') => {
        try {
            if (type === 'csv') setIsExportingCsv(true); else setIsExportingPdf(true);
            const params: Record<string, string> = { startDate, endDate };
            if (type === 'pdf') {
                params.columns = ALL_COLUMNS
                    .filter(c => colVisibility[c.key] !== false)
                    .map(c => c.key)
                    .join(',');
            }
            const response = await api.get(`/reports/visits/${type}`, {
                params,
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            let filename = `visitas_${startDate}_${endDate}.${type}`;
            const disposition = response.headers['content-disposition'];
            if (disposition) {
                const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                if (m?.[1]) filename = m[1].replace(/['"]/g, '');
            }
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            alert(t('reports.exportAlert'));
        } finally {
            if (type === 'csv') setIsExportingCsv(false); else setIsExportingPdf(false);
        }
    };

    function setQuickRange(range: 'today' | 'week' | 'month' | 'quarter') {
        const map = {
            today:   { s: today(), e: today() },
            week:    { s: daysAgo(7), e: today() },
            month:   { s: startOfMonth(), e: today() },
            quarter: { s: daysAgo(90), e: today() },
        };
        setStartDate(map[range].s); setEndDate(map[range].e);
    }

    const visibleRows = useMemo(() => {
        let rows = data?.rows ?? [];

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            rows = rows.filter((r) =>
                r.visitorName.toLowerCase().includes(q) ||
                r.visitorCompany.toLowerCase().includes(q) ||
                r.hostName.toLowerCase().includes(q) ||
                r.visitorDocument.includes(q) ||
                r.visitorEmail.toLowerCase().includes(q)
            );
        }

        (Object.entries(columnFilters) as [SortKey, string][]).forEach(([col, val]) => {
            if (!val) return;
            const q = val.toLowerCase();
            rows = rows.filter((r) => {
                const v = r[col];
                const str = typeof v === 'string' ? v : v != null ? String(v) : '';
                return str.toLowerCase().includes(q);
            });
        });

        return sortRows(rows, sortKey, sortDir);
    }, [data, searchQuery, columnFilters, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const paginatedRows = useMemo(() => {
        const start = (safeCurrentPage - 1) * pageSize;
        return visibleRows.slice(start, start + pageSize);
    }, [visibleRows, safeCurrentPage, pageSize]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, columnFilters, sortKey, sortDir, pageSize, data]);

    useEffect(() => {
        function handler(e: MouseEvent) {
            if (pageSizeMenuRef.current && !pageSizeMenuRef.current.contains(e.target as Node)) {
                setPageSizeMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const SortIcon = ({ col }: { col: SortKey }) =>
        sortKey === col
            ? sortDir === 'asc'
                ? <ChevronUp size={11} className="text-suprema-burgundy" />
                : <ChevronDown size={11} className="text-suprema-burgundy" />
            : <ChevronUp size={11} className="opacity-20" />;

    const selectCls = 'text-sm border border-suprema-gray-200 rounded-lg px-3 py-2 text-suprema-gray-800 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none bg-white';
    const inputCls = 'text-sm border border-suprema-gray-200 rounded-lg px-3 py-2 text-suprema-gray-800 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none';

    return (
        <div className="space-y-5">
            {/* ── Header ── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-suprema-gray-900 tracking-tight">{t('reports.pageTitle')}</h1>
                    <p className="text-sm text-suprema-gray-800/60 mt-0.5">{t('reports.pageSubtitle')}</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowColSettings(true)}
                        className="flex items-center gap-2 px-4 py-2 border border-suprema-gray-200 bg-white text-suprema-gray-800 rounded-xl text-sm font-semibold hover:bg-suprema-gray-50 transition-colors"
                        title="Configurar columnas visibles"
                    >
                        <Settings2 size={15} />
                        Columnas
                    </button>
                    <button
                        onClick={() => handleExport('csv')}
                        disabled={isExportingCsv || isExportingPdf || !data}
                        className="flex items-center gap-2 px-4 py-2 border border-suprema-gray-200 bg-white text-suprema-gray-800 rounded-xl text-sm font-semibold hover:bg-suprema-gray-50 transition-colors disabled:opacity-40"
                    >
                        {isExportingCsv ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                        {t('reports.exportCsvBtn')}
                    </button>
                    <button
                        onClick={() => handleExport('pdf')}
                        disabled={isExportingCsv || isExportingPdf || !data}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-suprema-burgundy to-suprema-burgundy-dark text-white rounded-xl text-sm font-bold shadow-sm hover:shadow-md transition-all disabled:opacity-40"
                    >
                        {isExportingPdf ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        {t('reports.exportPdfBtn')}
                    </button>
                </div>
            </div>

            {/* ── Global filters ── */}
            <div className="bg-white rounded-2xl border border-suprema-gray-100 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-suprema-gray-500 uppercase tracking-wider">
                    <Filter size={12} /> {t('reports.filtersLabel')}
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex gap-1.5">
                        {QUICK_RANGES.map(([key, label, handler]) => (
                            <button key={key} onClick={handler}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-suprema-gray-200 hover:bg-suprema-gray-50 text-suprema-gray-700 transition-colors">
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <CalendarIcon size={14} className="text-suprema-gray-400 flex-shrink-0" />
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                        <span className="text-suprema-gray-400 text-sm">→</span>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                    </div>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <select value={accessFilter} onChange={(e) => setAccessFilter(e.target.value)} className={selectCls}>
                        {ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button onClick={fetchData} disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-suprema-gray-700 border border-suprema-gray-200 rounded-lg hover:bg-suprema-gray-50 transition-colors disabled:opacity-40">
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {t('reports.refreshBtn')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
                    <AlertTriangle size={15} /> {error}
                </div>
            )}

            {/* ── KPIs ── */}
            {data && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                    <KpiCard label={t('reports.kpiTotal')}       value={data.kpis.total}         icon={<Users size={22} />}         color="bg-white border-suprema-gray-100 text-suprema-gray-900" />
                    <KpiCard label={t('reports.kpiScheduled')}   value={data.kpis.scheduled}     icon={<CalendarIcon size={22} />}  color="bg-blue-50 border-blue-100 text-blue-800" />
                    <KpiCard label={t('reports.kpiPreReg')}      value={data.kpis.preRegistered} icon={<UserCheck size={22} />}     color="bg-violet-50 border-violet-100 text-violet-800" />
                    <KpiCard label={t('reports.kpiCheckedIn')}   value={data.kpis.checkedIn}     icon={<LogIn size={22} />}         color="bg-emerald-50 border-emerald-100 text-emerald-800" />
                    <KpiCard label={t('reports.kpiCheckedOut')}  value={data.kpis.checkedOut}    icon={<LogOut size={22} />}        color="bg-gray-50 border-gray-200 text-gray-700" />
                    <KpiCard label={t('reports.kpiNoShow')}      value={data.kpis.noShow}        icon={<AlertTriangle size={22} />} color="bg-amber-50 border-amber-100 text-amber-800" />
                    <KpiCard label={t('reports.kpiCancelled')}   value={data.kpis.cancelled}     icon={<XCircle size={22} />}       color="bg-red-50 border-red-100 text-red-700" />
                    <KpiCard
                        label={t('reports.kpiAvgDuration')}
                        value={data.kpis.avgDurationMinutes != null ? `${data.kpis.avgDurationMinutes} min` : '—'}
                        icon={<Clock size={22} />}
                        color="bg-orange-50 border-orange-100 text-orange-800"
                    />
                </div>
            )}

            {/* ── Table ── */}
            <div className="bg-white rounded-2xl border border-suprema-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-suprema-gray-100 gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <p className="text-sm font-semibold text-suprema-gray-800">
                            {loading
                                ? t('reports.loading')
                                : t('reports.visitCount', { count: String(visibleRows.length), p: visibleRows.length !== 1 ? 's' : '' })}
                            {data && visibleRows.length < data.rows.length && (
                                <span className="font-normal text-suprema-gray-500"> {t('reports.ofTotal', { total: String(data.rows.length) })}</span>
                            )}
                        </p>
                        {activeFilterCount > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {(Object.entries(columnFilters) as [SortKey, string][]).map(([col, val]) => {
                                    const colDef = COLUMNS.find((c) => c.key === col);
                                    return (
                                        <span key={col}
                                            className="inline-flex items-center gap-1 text-xs font-semibold bg-suprema-burgundy/10 text-suprema-burgundy rounded-full px-2.5 py-0.5">
                                            <ListFilter size={10} />
                                            {colDef?.label}: <em className="not-italic font-bold">{val}</em>
                                            <button onClick={() => clearColFilter(col)} className="ml-0.5 hover:text-suprema-burgundy-dark">
                                                <X size={10} />
                                            </button>
                                        </span>
                                    );
                                })}
                                <button onClick={clearAllColFilters}
                                    className="text-xs text-suprema-gray-500 underline underline-offset-2 hover:text-suprema-gray-800 transition-colors">
                                    {t('reports.clearAll')}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="text"
                            placeholder={t('reports.searchPlaceholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="text-sm border border-suprema-gray-200 rounded-lg px-3 py-1.5 w-64 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none"
                        />

                        {visibleRows.length > 0 && (
                            <>
                                {/* Page size selector */}
                                <div className="relative" ref={pageSizeMenuRef}>
                                    <button
                                        onClick={() => setPageSizeMenuOpen(o => !o)}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-suprema-gray-200 bg-white text-[11px] font-semibold text-suprema-gray-700 hover:bg-suprema-gray-50 transition-colors"
                                        title="Filas por página"
                                    >
                                        {pageSize} por página
                                        <ChevronDown size={12} className={`transition-transform ${pageSizeMenuOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    {pageSizeMenuOpen && (
                                        <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-suprema-gray-100 z-30 overflow-hidden">
                                            {[10, 25, 50, 100].map(size => (
                                                <button
                                                    key={size}
                                                    onClick={() => { setPageSize(size); setPageSizeMenuOpen(false); }}
                                                    className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors ${pageSize === size ? 'bg-suprema-burgundy/10 text-suprema-burgundy' : 'text-suprema-gray-700 hover:bg-suprema-gray-50'}`}
                                                >
                                                    {size} por página
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Page navigation */}
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={safeCurrentPage <= 1}
                                        className="p-1.5 rounded-lg border border-suprema-gray-200 bg-white text-suprema-gray-700 hover:bg-suprema-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Página anterior"
                                    >
                                        <ChevronUp size={14} className="-rotate-90" />
                                    </button>
                                    <span className="px-1 text-[11px] font-semibold text-suprema-gray-700 whitespace-nowrap">
                                        Página {safeCurrentPage} de {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={safeCurrentPage >= totalPages}
                                        className="p-1.5 rounded-lg border border-suprema-gray-200 bg-white text-suprema-gray-700 hover:bg-suprema-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="Página siguiente"
                                    >
                                        <ChevronUp size={14} className="rotate-90" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20 text-suprema-gray-400">
                        <Loader2 size={32} className="animate-spin" />
                    </div>
                ) : visibleRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-suprema-gray-400 gap-2">
                        <FileText size={36} className="opacity-30" />
                        <p className="text-sm">{t('reports.noVisits')}</p>
                        {activeFilterCount > 0 && (
                            <button onClick={clearAllColFilters}
                                className="text-xs text-suprema-burgundy underline underline-offset-2 mt-1">
                                {t('reports.clearColFilters')}
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[1350px]">
                            <thead className="bg-suprema-gray-50 border-b border-suprema-gray-100">
                                <tr>
                                    {COLUMNS.map(({ key, label, filterable }) => {
                                        const hasFilter = !!columnFilters[key];
                                        const isOpen = openFilterCol === key;
                                        return (
                                            <th key={key}
                                                className="px-4 py-2.5 text-left text-xs font-semibold text-suprema-gray-500 uppercase tracking-wider whitespace-nowrap select-none">
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => handleSort(key)}
                                                        className="flex items-center gap-1 hover:text-suprema-gray-900 transition-colors"
                                                    >
                                                        {label}
                                                        <SortIcon col={key} />
                                                    </button>
                                                    {filterable && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); openFilter(key, e.currentTarget); }}
                                                            title={t('reports.filterBy', { label })}
                                                            className={`ml-0.5 p-0.5 rounded transition-colors ${
                                                                hasFilter || isOpen
                                                                    ? 'text-suprema-burgundy bg-suprema-burgundy/10'
                                                                    : 'text-suprema-gray-400 hover:text-suprema-gray-700 hover:bg-suprema-gray-200/50'
                                                            }`}
                                                        >
                                                            <ListFilter size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-suprema-gray-50">
                                {paginatedRows.map((row) => (
                                    <tr key={row.id} className="hover:bg-suprema-gray-50/50 transition-colors">
                                        {colVisibility['visitorDocument'] !== false && (
                                            <td className="px-4 py-2.5 text-suprema-gray-500 whitespace-nowrap font-mono text-xs">
                                                {row.visitorDocument || <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                        {colVisibility['visitorName'] !== false && (
                                            <td className="px-4 py-2.5 font-semibold text-suprema-gray-900 whitespace-nowrap">
                                                {row.visitorName}
                                            </td>
                                        )}
                                        {colVisibility['visitorCompany'] !== false && (
                                            <td className="px-4 py-2.5 text-suprema-gray-700 whitespace-nowrap">
                                                {row.visitorCompany || '—'}
                                            </td>
                                        )}
                                        {colVisibility['visitorEmail'] !== false && (
                                            <td className="px-4 py-2.5 text-suprema-gray-500 whitespace-nowrap text-xs">
                                                {row.visitorEmail
                                                    ? <span className="truncate block max-w-[180px]" title={row.visitorEmail}>{row.visitorEmail}</span>
                                                    : <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                        {colVisibility['hostName'] !== false && (
                                            <td className="px-4 py-2.5 text-suprema-gray-700 whitespace-nowrap">{row.hostName}</td>
                                        )}
                                        {colVisibility['purpose'] !== false && (
                                            <td className="px-4 py-2.5 text-suprema-gray-600 max-w-[120px]">
                                                <span className="truncate block" title={row.purpose}>{row.purpose || '—'}</span>
                                            </td>
                                        )}
                                        {colVisibility['serviceOrder'] === true && (
                                            <td className="px-4 py-2.5 text-suprema-gray-600 whitespace-nowrap text-xs font-mono">
                                                {row.serviceOrder || <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                        {colVisibility['accessMethod'] !== false && (
                                            <td className="px-4 py-2.5 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1 text-xs font-medium text-suprema-gray-600 bg-suprema-gray-100 rounded-full px-2 py-0.5">
                                                    {ACCESS_ICON[row.accessMethod]} {row.accessMethod}
                                                </span>
                                            </td>
                                        )}
                                        {colVisibility['status'] !== false && (
                                            <td className="px-4 py-2.5 whitespace-nowrap">
                                                <span className={`inline-block text-xs font-semibold rounded-full px-2.5 py-0.5 ${STATUS_BADGE[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                                    {row.status}
                                                </span>
                                            </td>
                                        )}
                                        {colVisibility['scheduledAt'] !== false && (
                                            <td className="px-4 py-2.5 text-suprema-gray-600 whitespace-nowrap text-xs">{fmtDt(row.scheduledAt)}</td>
                                        )}
                                        {colVisibility['expectedEndAt'] !== false && (
                                            <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                                                {row.expectedEndAt
                                                    ? <span className="text-suprema-gray-600">{fmtDt(row.expectedEndAt)}</span>
                                                    : <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                        {colVisibility['checkedInAt'] !== false && (
                                            <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                                                {row.checkedInAt
                                                    ? <span className="text-emerald-700 font-medium">{fmtDt(row.checkedInAt)}</span>
                                                    : <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                        {colVisibility['checkedOutAt'] !== false && (
                                            <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                                                {row.checkedOutAt
                                                    ? <span className="text-suprema-gray-600">{fmtDt(row.checkedOutAt)}</span>
                                                    : <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                        {colVisibility['durationMinutes'] !== false && (
                                            <td className="px-4 py-2.5 whitespace-nowrap text-xs text-center">
                                                {row.durationMinutes != null
                                                    ? <span className="font-medium text-suprema-gray-700">{row.durationMinutes} min</span>
                                                    : <span className="text-suprema-gray-300">—</span>}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {openFilterCol && filterAnchor && (
                <FilterPopover
                    col={openFilterCol}
                    label={COLUMNS.find((c) => c.key === openFilterCol)?.label ?? openFilterCol}
                    anchorRect={filterAnchor}
                    draft={filterDraft}
                    suggestions={suggestions}
                    onDraftChange={setFilterDraft}
                    onSelect={applyColFilter}
                    onClear={() => clearColFilter()}
                    onClose={() => setOpenFilterCol(null)}
                    hasActive={!!columnFilters[openFilterCol]}
                />
            )}

            {showColSettings && (
                <ColumnSettingsModal
                    allCols={ALL_COLUMNS}
                    visibility={colVisibility}
                    onApply={applyColVisibility}
                    onClose={() => setShowColSettings(false)}
                />
            )}
        </div>
    );
}
