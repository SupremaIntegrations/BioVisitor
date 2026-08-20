'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import {
    Search, Plus, Printer, Fingerprint,
    Loader2, RefreshCw, UserCheck, ArrowRight, AlertCircle, AlertTriangle,
    Clock, WifiOff, CheckCircle2, TriangleAlert, X, XCircle, Shield,
    UserX, Download, Upload, ChevronDown, ChevronLeft, ChevronRight, Users, MoreHorizontal,
    ArrowUp, ArrowDown, ArrowUpDown, Columns3, Lock, CalendarPlus,
} from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { api } from '@/lib/api';
import PrintBadgeModal from '@/components/PrintBadgeModal';
import FingerprintEnrollModal from '@/components/FingerprintEnrollModal';
import RegisterWalkInModal from '@/components/RegisterWalkInModal';
import VisitorDetailModal from '@/components/VisitorDetailModal';
import AuthImage from '@/components/AuthImage';
import CsvImportModal from '@/components/CsvImportModal';
import CheckInModal from '@/components/CheckInModal';
import FalseExitAlertModal from '@/components/FalseExitAlertModal';
import { useI18n } from '@/i18n/I18nContext';
import ColumnFilterPopover, {
    ColumnFilter,
    applyFilter,
    FilterType,
} from '@/components/table/ColumnFilterPopover';
import ColumnSelector, { ColumnDef } from '@/components/table/ColumnSelector';
import { useVisitorTypeCatalog } from '@/lib/visitor-types';

/* ─────────────────────────── types ─────────────────────────── */

interface FrequentVisitor {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    company: string | null;
    email: string | null;
    documentType: string;
    documentNumber: string;
    photoPath: string | null;
    visitorType: string | null;
    visitCount: number;
    lastVisitDate: string | null;
    firstVisitDate: string | null;
}

interface VisitResponse {
    id: string;
    visitorId: string;
    hostUserId: string;
    tenantId: string;
    purpose: string;
    scheduledAt: string;
    expectedEndAt: string | null;
    checkedInAt: string | null;
    checkedOutAt: string | null;
    maxStayMinutes: number | null;
    accessMethod: string;
    status: 'SCHEDULED' | 'PRE_REGISTERED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW' | 'FALSE_EXIT_REPORTED';
    wasTemporaryReenabled?: boolean;
    syncStatus: string;
    visitorType?: 'WALK_IN' | 'CONTRACTOR' | 'VIP' | 'INTERVIEW' | 'SUPPLIER' | 'COURIER' | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
    visitor?: {
        id: string;
        firstName: string;
        lastName: string;
        documentType: string;
        documentNumber: string;
        company: string | null;
        photoPath: string | null;
        updatedAt: string;
    };
    hostUser?: { fullName: string; email: string };
    host?: { fullName: string; };
    accessGroups?: { id: number; name: string }[] | null;
    autoCheckoutEnabled?: boolean;
}

/* ─────────────── column definitions ─────────────── */

const COLUMNS: (ColumnDef & { filterType?: FilterType; filterOptions?: { label: string; value: string }[]; getValue?: (v: VisitResponse) => string })[] = [
    { id: 'name',         label: 'Visitante',       alwaysVisible: true,  defaultVisible: true,  filterType: 'text',   getValue: v => `${v.visitor?.firstName ?? ''} ${v.visitor?.lastName ?? ''}` },
    { id: 'document',     label: 'Cédula',           alwaysVisible: true,  defaultVisible: true,  filterType: 'text',   getValue: v => v.visitor?.documentNumber ?? '' },
    { id: 'company',      label: 'Empresa',          alwaysVisible: false, defaultVisible: true,  filterType: 'text',   getValue: v => v.visitor?.company ?? '' },
    { id: 'host',         label: 'Anfitrión',        alwaysVisible: false, defaultVisible: true,  filterType: 'text',   getValue: v => v.host?.fullName ?? v.hostUser?.fullName ?? '' },
    { id: 'scheduledAt',  label: 'Hora agendada',    alwaysVisible: false, defaultVisible: true,  filterType: 'date',   getValue: v => v.scheduledAt ? v.scheduledAt.slice(0, 10) : '' },
    {
        id: 'status', label: 'Estado', alwaysVisible: false, defaultVisible: true, filterType: 'select',
        filterOptions: [
            { label: 'Agendado',       value: 'SCHEDULED' },
            { label: 'Pre-registrado', value: 'PRE_REGISTERED' },
            { label: 'En edificio',    value: 'CHECKED_IN' },
            { label: 'Checkout',       value: 'CHECKED_OUT' },
            { label: 'No-Show',        value: 'NO_SHOW' },
            { label: 'Cancelado',      value: 'CANCELLED' },
        ],
        getValue: v => v.status,
    },
    { id: 'checkedInAt',  label: 'Hora check-in',   alwaysVisible: false, defaultVisible: false, filterType: 'date',   getValue: v => v.checkedInAt ? v.checkedInAt.slice(0, 10) : '' },
    { id: 'accessMethod', label: 'Método acceso',   alwaysVisible: false, defaultVisible: false, filterType: 'text',   getValue: v => v.accessMethod ?? '' },
    { id: 'sync',         label: 'Sincronización',  alwaysVisible: false, defaultVisible: false, filterType: 'select',
        filterOptions: [
            { label: 'OK',             value: 'SYNCED' },
            { label: 'Pendiente',      value: 'PENDING' },
            { label: 'Fallido',        value: 'FAILED' },
            { label: 'Sin BioStar',    value: 'OFFLINE' },
        ],
        getValue: v => v.syncStatus ?? '',
    },
    { id: 'visitorType',  label: 'Tipo',             alwaysVisible: false, defaultVisible: true,  filterType: 'text',   getValue: v => v.visitorType ?? 'WALK_IN' },
    { id: 'accessGroups', label: 'Grupos de Acceso', alwaysVisible: false, defaultVisible: false, filterType: 'text',   getValue: v => (v.accessGroups ?? []).map(g => g.name).join(' ') },
    { id: 'actions',      label: 'Acciones',         alwaysVisible: true,  defaultVisible: true },
];

/* ─────────────── helpers ─────────────── */

function isOvertime(visit: VisitResponse): boolean {
    if (!visit.checkedInAt || !visit.maxStayMinutes) return false;
    return (Date.now() - new Date(visit.checkedInAt).getTime()) / 60000 > visit.maxStayMinutes;
}

function fmtTime(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ─────────────── component ─────────────── */

export default function VisitorsManagement() {
    const { t } = useI18n();
    const { labels: visitorTypeLabels } = useVisitorTypeCatalog();
    const { canViewPage } = usePermissions();
    const searchParams = useSearchParams();

    useEffect(() => {
        const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
        if (stored.role === 'OPERATOR' && !canViewPage('visitors')) window.location.href = '/dashboard';
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* data */
    const [visits, setVisits] = useState<VisitResponse[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    /* tab */
    const [activeTab, setActiveTab] = useState<'ALL' | 'EXPECTED' | 'CHECKED_IN' | 'NO_SHOW' | 'FALSE_EXIT' | 'FREQUENT'>('EXPECTED');

    /* frequent visitors */
    const [frequentVisitors, setFrequentVisitors] = useState<FrequentVisitor[]>([]);
    const [frequentTotal, setFrequentTotal] = useState(0);
    const [isFrequentLoading, setIsFrequentLoading] = useState(false);
    const [frequentSearch, setFrequentSearch] = useState('');
    const [frequentMinVisits, setFrequentMinVisits] = useState(3);

    /* global search */
    const [searchQuery, setSearchQuery] = useState('');

    /* per-column filters */
    const [columnFilters, setColumnFilters] = useState<Map<string, ColumnFilter>>(new Map());

    /* column visibility */
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
        new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.id))
    );

    /* modals */
    const [printVisitId, setPrintVisitId] = useState<string | null>(null);
    const [fingerprintVisit, setFingerprintVisit] = useState<{ id: string; name: string } | null>(null);
    const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
    const [registerPrefillDoc, setRegisterPrefillDoc] = useState<{ documentType: string; documentNumber: string } | null>(null);
    const [detailVisitId, setDetailVisitId] = useState<string | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [checkInModal, setCheckInModal] = useState<{ visitId: string; visitorName: string; autoCheckoutEnabled: boolean } | null>(null);

    /* action states */
    const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
    const [actionError, setActionError] = useState<string | null>(null);

    /* toast */
    const [comingSoonToast, setComingSoonToast] = useState<string | null>(null);
    const [successToast, setSuccessToast] = useState<string | null>(null);

    /* tick for overtime */
    const [, setTick] = useState(0);

    /* refresh trigger */
    const [refreshKey, setRefreshKey] = useState(0);

    /* ── multi-select ── */
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkConfirm, setBulkConfirm] = useState<{
        action: 'checkin' | 'checkout';
        ids: string[];
        count: number;
        startsAt?: string;
        expiresAt?: string;
    } | null>(null);
    const [isBulkLoading, setIsBulkLoading] = useState(false);

    /* ── export dropdown ── */
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    /* ── sort ── */
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    /* ── pagination ── */
    const [pageSize, setPageSize] = useState<number>(25);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
    const pageSizeMenuRef = useRef<HTMLDivElement>(null);

    const handleSort = (colId: string) => {
        if (sortBy === colId) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(colId);
            setSortDir('asc');
        }
    };

    const { isConnected, listenToEvent } = useSocket();

    /* ── fetch ── */
    const fetchVisits = async (tab?: typeof activeTab) => {
        try {
            setIsLoading(true);
            const currentTab = tab ?? activeTab;
            let url = '/visitors/active';
            if (currentTab === 'ALL') url = '/visitors/active?includeAll=true';
            else if (currentTab === 'NO_SHOW') url = '/visitors/active?includeNoShow=true';
            const res = await api.get(url);
            const data = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
            setVisits(Array.isArray(data) ? data : []);
            setSelectedIds(new Set()); // clear selection on refresh
        } catch (e) {
            console.error('Failed to load visits:', e);
        } finally {
            setIsLoading(false);
        }
    };

    /* Initialize tab from URL param (?filter=noshow) */
    useEffect(() => {
        const filter = searchParams?.get('filter');
        if (filter === 'noshow') {
            setActiveTab('NO_SHOW');
            fetchVisits('NO_SHOW');
        } else if (filter === 'falseexit') {
            setActiveTab('FALSE_EXIT');
            fetchVisits('EXPECTED');
        } else {
            fetchVisits('EXPECTED');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (refreshKey === 0) return;
        fetchVisits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 60_000);
        return () => clearInterval(id);
    }, []);

    const [falseExitModal, setFalseExitModal] = useState<{ visitId: string; visitorName: string } | null>(null);
    const [falseExitBanner, setFalseExitBanner] = useState<{ visitId: string; visitorName: string } | null>(null);

    useEffect(() => {
        if (!isConnected) return;
        const c1 = listenToEvent('visit.checked_in', () => fetchVisits());
        const c2 = listenToEvent('visit.checked_out', () => fetchVisits());
        const c3 = listenToEvent('visit.no_show', () => fetchVisits());
        const c4 = listenToEvent('visit.false_exit_reported', (payload: any) => {
            setFalseExitBanner({ visitId: payload.visitId, visitorName: payload.visitorName || 'Visitante' });
            fetchVisits();
        });
        const c5 = listenToEvent('visit.temporary_reenabled', () => fetchVisits());
        const c6 = listenToEvent('visit.false_exit_dismissed', () => fetchVisits());
        return () => { c1(); c2(); c3(); c4(); c5(); c6(); };
    }, [isConnected, listenToEvent]);

    /* close export menu on outside click */
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setExportMenuOpen(false);
            }
            if (pageSizeMenuRef.current && !pageSizeMenuRef.current.contains(e.target as Node)) {
                setPageSizeMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    /* reset to page 1 whenever filters/search/tab/page size change */
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, searchQuery, columnFilters, sortBy, sortDir, pageSize]);

    /* ── single actions ── */
    const handleAction = async (visitId: string, action: 'checkin' | 'checkout' | 'noshow', visit?: VisitResponse) => {
        if (action === 'checkin') {
            // Open modal to collect mandatory expiration date
            const name = visit
                ? `${visit.visitor?.firstName ?? ''} ${visit.visitor?.lastName ?? ''}`.trim() || 'Visitante'
                : 'Visitante';
            setCheckInModal({ visitId, visitorName: name, autoCheckoutEnabled: !!visit?.autoCheckoutEnabled });
            return;
        }
        setActionLoading(prev => ({ ...prev, [visitId]: action }));
        setActionError(null);
        try {
            if (action === 'checkout') await api.put(`/visitors/checkout/${visitId}`);
            else await api.put(`/visitors/visit/${visitId}/no-show`);
            fetchVisits();
        } catch (err: any) {
            setActionError(err.response?.data?.message || `Error al realizar ${action}`);
            setTimeout(() => setActionError(null), 4000);
        } finally {
            setActionLoading(prev => ({ ...prev, [visitId]: null }));
        }
    };

    /* ── multi-select helpers ── */
    const toggleSelect = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredVisits.length && filteredVisits.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredVisits.map(v => v.id)));
        }
    };

    const handleBulkConfirm = async () => {
        if (!bulkConfirm) return;
        if (bulkConfirm.action === 'checkin' && !bulkConfirm.expiresAt) {
            setActionError('Selecciona la fecha de salida programada para continuar.');
            return;
        }
        setIsBulkLoading(true);
        setActionError(null);
        try {
            let res: any;
            if (bulkConfirm.action === 'checkin') {
                res = await api.post('/visitors/bulk-checkin', {
                    visitIds: bulkConfirm.ids,
                    startsAt: bulkConfirm.startsAt ? new Date(bulkConfirm.startsAt).toISOString() : new Date().toISOString(),
                    expiresAt: new Date(bulkConfirm.expiresAt!).toISOString(),
                });
            } else {
                res = await api.post('/visitors/bulk-checkout-selected', { visitIds: bulkConfirm.ids });
            }
            const data = res.data;
            const label = bulkConfirm.action === 'checkin' ? 'check-in' : 'check-out';
            showSuccess(`${label} masivo: ${data.success ?? 0} exitosos${data.failed ? `, ${data.failed} fallidos` : ''}`);
            setSelectedIds(new Set());
            fetchVisits();
        } catch (err: any) {
            setActionError(err.response?.data?.message || 'Error en la operación masiva');
            setTimeout(() => setActionError(null), 5000);
        } finally {
            setIsBulkLoading(false);
            setBulkConfirm(null);
        }
    };

    /* ── export PDF ── */
    const [exportingPdf, setExportingPdf] = useState(false);
    const exportPdf = async () => {
        setExportingPdf(true);
        setExportMenuOpen(false);
        try {
            const today = new Date();
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const params = new URLSearchParams({
                startDate: startOfMonth.toISOString(),
                endDate: today.toISOString(),
            });
            const res = await api.get(`/reports/visits/pdf?${params}`, { responseType: 'blob' });
            const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `visitantes_${today.toISOString().slice(0, 10)}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            showSuccess('PDF exportado correctamente');
        } catch {
            showSuccess('Error al generar el PDF');
        } finally {
            setExportingPdf(false);
        }
    };

    /* ── export CSV ── */
    const exportCsv = () => {
        const dataToExport = selectedIds.size > 0
            ? filteredVisits.filter(v => selectedIds.has(v.id))
            : filteredVisits;

        const headers = ['Nombre', 'Apellido', 'Documento', 'Tipo Doc', 'Empresa', 'Anfitrión', 'Hora Agendada', 'Estado', 'Check-in', 'Checkout', 'Tipo', 'Método Acceso'];
        const rows = dataToExport.map(v => [
            v.visitor?.firstName ?? '',
            v.visitor?.lastName ?? '',
            v.visitor?.documentNumber ?? '',
            v.visitor?.documentType ?? '',
            v.visitor?.company ?? '',
            v.host?.fullName ?? v.hostUser?.fullName ?? '',
            v.scheduledAt ? new Date(v.scheduledAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '',
            v.status,
            v.checkedInAt ? new Date(v.checkedInAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '',
            v.checkedOutAt ? new Date(v.checkedOutAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '',
            v.visitorType ?? 'WALK_IN',
            v.accessMethod ?? '',
        ]);
        const csv = [headers, ...rows]
            .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `visitantes_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setExportMenuOpen(false);
    };

    /* ── toast helper ── */
    const showSuccess = (msg: string) => {
        setSuccessToast(msg);
        setTimeout(() => setSuccessToast(null), 3500);
    };

    /* ── column filter helpers ── */
    const setColumnFilter = (filter: ColumnFilter | null) => {
        setColumnFilters(prev => {
            const next = new Map(prev);
            if (!filter) return next;
            next.set(filter.columnId, filter);
            return next;
        });
    };

    const removeColumnFilter = (columnId: string) => {
        setColumnFilters(prev => { const n = new Map(prev); n.delete(columnId); return n; });
    };

    /* ── column visibility ── */
    const toggleColumn = (id: string) => {
        setVisibleColumns(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    /* ── frequent visitors fetch ── */
    const fetchFrequentVisitors = async (minVisits = frequentMinVisits) => {
        setIsFrequentLoading(true);
        try {
            const { data } = await api.get('/visitors/frequent', { params: { minVisits, windowDays: 180, limit: 200 } });
            setFrequentVisitors(data.visitors ?? []);
            setFrequentTotal(data.total ?? 0);
        } catch {
            setFrequentVisitors([]);
        } finally {
            setIsFrequentLoading(false);
        }
    };

    /* ── tab change ── */
    const handleTabChange = (tab: typeof activeTab) => {
        setActiveTab(tab);
        setSelectedIds(new Set());
        if (tab === 'FREQUENT') {
            fetchFrequentVisitors();
            return;
        }
        if (tab === 'NO_SHOW' || activeTab === 'NO_SHOW' || tab === 'ALL' || activeTab === 'ALL') {
            fetchVisits(tab);
        }
    };

    /* ── filtered data ── */
    const overtimeCount = useMemo(() => visits.filter(v => v.status === 'CHECKED_IN' && isOvertime(v)).length, [visits]);
    const falseExitCount = useMemo(() => visits.filter(v => v.status === 'FALSE_EXIT_REPORTED').length, [visits]);

    const filteredVisits = useMemo(() => {
        const filtered = visits.filter(visit => {
            if (activeTab === 'FALSE_EXIT') return visit.status === 'FALSE_EXIT_REPORTED';
            if (visit.status === 'FALSE_EXIT_REPORTED') return activeTab === 'ALL';
            if (activeTab === 'EXPECTED' && !['SCHEDULED', 'PRE_REGISTERED'].includes(visit.status)) return false;
            if (activeTab === 'CHECKED_IN' && visit.status !== 'CHECKED_IN') return false;
            if (activeTab === 'NO_SHOW' && visit.status !== 'NO_SHOW') return false;

            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const haystack = [
                    visit.visitor?.firstName, visit.visitor?.lastName,
                    visit.visitor?.company, visit.visitor?.documentNumber,
                    visit.host?.fullName ?? visit.hostUser?.fullName,
                ].join(' ').toLowerCase();
                if (!haystack.includes(q)) return false;
            }

            for (const [colId, filter] of columnFilters) {
                const colDef = COLUMNS.find(c => c.id === colId);
                if (!colDef?.getValue) continue;
                const cellValue = colDef.getValue(visit);
                if (!applyFilter(cellValue, filter)) return false;
            }

            return true;
        });

        if (!sortBy) return filtered;

        const colDef = COLUMNS.find(c => c.id === sortBy);
        const getValue = colDef?.getValue;
        if (!getValue) return filtered;

        return [...filtered].sort((a, b) => {
            const va = getValue(a).toLowerCase();
            const vb = getValue(b).toLowerCase();
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [visits, activeTab, searchQuery, columnFilters, sortBy, sortDir]);

    /* ── pagination derived data ── */
    const totalPages = Math.max(1, Math.ceil(filteredVisits.length / pageSize));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const paginatedVisits = useMemo(() => {
        const start = (safeCurrentPage - 1) * pageSize;
        return filteredVisits.slice(start, start + pageSize);
    }, [filteredVisits, safeCurrentPage, pageSize]);

    /* ── bulk action derived counts ── */
    const bulkCheckinIds = useMemo(
        () => [...selectedIds].filter(id => {
            const v = filteredVisits.find(x => x.id === id);
            return v && (v.status === 'SCHEDULED' || v.status === 'PRE_REGISTERED' || v.status === 'CHECKED_OUT');
        }),
        [selectedIds, filteredVisits]
    );
    const bulkCheckoutIds = useMemo(
        () => [...selectedIds].filter(id => {
            const v = filteredVisits.find(x => x.id === id);
            return v && v.status === 'CHECKED_IN';
        }),
        [selectedIds, filteredVisits]
    );

    /* ── render helpers ── */
    const statusBadge = (visit: VisitResponse) => {
        const overtime = isOvertime(visit);
        const classes =
            visit.status === 'FALSE_EXIT_REPORTED'
                ? 'bg-red-100 text-red-800 animate-pulse'
                : visit.status === 'CHECKED_IN'
                ? overtime ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                : visit.status === 'SCHEDULED' || visit.status === 'PRE_REGISTERED'
                ? 'bg-amber-100 text-amber-800'
                : visit.status === 'NO_SHOW'
                ? 'bg-purple-100 text-purple-800'
                : 'bg-gray-100 text-gray-600';

        const label = {
            SCHEDULED: 'Agendado',
            PRE_REGISTERED: 'Pre-registrado',
            CHECKED_IN: overtime ? 'Overtime' : 'En edificio',
            CHECKED_OUT: 'Checkout',
            NO_SHOW: 'No-Show',
            CANCELLED: 'Cancelado',
            FALSE_EXIT_REPORTED: 'Falsa salida',
        }[visit.status] ?? visit.status;

        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${classes}`}>
                {overtime && <TriangleAlert size={10} />}
                {label}
            </span>
        );
    };

    const visibleColIds = useMemo(
        () => COLUMNS.filter(c => visibleColumns.has(c.id) || c.alwaysVisible),
        [visibleColumns]
    );

    const activeFilterCount = columnFilters.size;
    const showComingSoon = (f: string) => { setComingSoonToast(f); setTimeout(() => setComingSoonToast(null), 2500); };
    const allFilteredSelected = filteredVisits.length > 0 && selectedIds.size === filteredVisits.length;
    const someSelected = selectedIds.size > 0 && !allFilteredSelected;

    /* ────────────────────────── JSX ────────────────────────── */
    return (
        <div className="space-y-6 w-full h-full flex flex-col">

            {/* ── Falsa salida — banner de alerta en vivo ── */}
            {falseExitBanner && (
                <div className="flex items-center justify-between gap-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 animate-pulse">
                    <div className="flex items-center gap-3">
                        <TriangleAlert className="text-red-600 flex-shrink-0" size={18} />
                        <p className="text-sm text-red-800">
                            <strong>{falseExitBanner.visitorName}</strong> reportó que sigue dentro de las instalaciones tras un auto-checkout.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            onClick={() => setFalseExitModal(falseExitBanner)}
                            className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5"
                        >
                            Resolver
                        </button>
                        <button
                            onClick={() => setFalseExitBanner(null)}
                            className="text-red-400 hover:text-red-600"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* ── Page header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-suprema-gray-900">{t('visitors.title')}</h2>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">

                    {/* Register Walk-In */}
                    <button
                        onClick={() => { setRegisterPrefillDoc(null); setIsRegisterModalOpen(true); }}
                        className="flex items-center gap-2 px-4 py-2.5 bg-suprema-burgundy text-white rounded-xl hover:bg-suprema-burgundy-dark transition-colors shadow-md shadow-suprema-burgundy/20 text-sm font-normal"
                    >
                        <Plus size={15} />
                        {t('visitors.registerWalkIn')}
                    </button>

                    {/* More actions (3 dots) */}
                    <div className="relative" ref={exportMenuRef}>
                        <button
                            onClick={() => setExportMenuOpen(o => !o)}
                            className="flex items-center justify-center w-9 h-9 bg-white border-2 border-suprema-gray-100 text-suprema-gray-900 rounded-xl hover:border-suprema-gray-800/20 hover:bg-suprema-gray-100/50 transition-colors shadow-sm"
                            title="Más opciones"
                        >
                            <MoreHorizontal size={17} />
                        </button>
                        {exportMenuOpen && (
                            <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-suprema-gray-100 z-30 overflow-hidden overflow-y-auto max-h-[80vh]">
                                {/* Exportar section */}
                                <div className="px-3 py-1.5 text-[10px] font-bold text-suprema-gray-800/40 uppercase tracking-widest border-b border-suprema-gray-100">
                                    Exportar
                                </div>
                                <button
                                    onClick={exportCsv}
                                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-suprema-gray-900 hover:bg-suprema-gray-100/60 transition-colors text-left"
                                >
                                    <Download size={14} className="text-emerald-600" />
                                    Exportar CSV
                                    {selectedIds.size > 0 && (
                                        <span className="ml-auto text-[10px] font-bold text-suprema-burgundy bg-suprema-burgundy/10 px-1.5 py-0.5 rounded-full">
                                            {selectedIds.size} sel.
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={exportPdf}
                                    disabled={exportingPdf}
                                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-suprema-gray-900 hover:bg-suprema-gray-100/60 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {exportingPdf
                                        ? <span className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                        : <Download size={14} className="text-red-500" />}
                                    {exportingPdf ? 'Generando PDF…' : 'Exportar PDF'}
                                </button>
                                {/* Importar section */}
                                <div className="px-3 py-1.5 text-[10px] font-bold text-suprema-gray-800/40 uppercase tracking-widest border-t-2 border-b border-suprema-gray-100 mt-1">
                                    Importar
                                </div>
                                <button
                                    onClick={() => { setExportMenuOpen(false); setIsImportModalOpen(true); }}
                                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-suprema-gray-900 hover:bg-suprema-gray-100/60 transition-colors text-left"
                                >
                                    <Upload size={14} className="text-blue-500" />
                                    Importar CSV
                                </button>
                                {/* Columnas section */}
                                <div className="px-3 py-1.5 text-[10px] font-bold text-suprema-gray-800/40 uppercase tracking-widest border-t-2 border-b border-suprema-gray-100 mt-1 flex items-center gap-1.5">
                                    <Columns3 size={11} />
                                    Columnas visibles
                                </div>
                                {COLUMNS.map(col => (
                                    <label
                                        key={col.id}
                                        className={`flex items-center gap-2.5 px-4 py-1.5 text-sm text-suprema-gray-900 transition-colors ${
                                            col.alwaysVisible
                                                ? 'opacity-40 cursor-not-allowed'
                                                : 'cursor-pointer hover:bg-suprema-gray-100/60'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={visibleColumns.has(col.id)}
                                            onChange={() => !col.alwaysVisible && toggleColumn(col.id)}
                                            disabled={col.alwaysVisible}
                                            className="w-3.5 h-3.5 rounded accent-suprema-burgundy flex-shrink-0"
                                        />
                                        <span className="flex-1">{col.label}</span>
                                        {col.alwaysVisible && <Lock size={10} className="text-suprema-gray-800/30" />}
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Overtime banner ── */}
            {overtimeCount > 0 && (
                <div className="flex items-center gap-3 p-3 bg-red-50 border-2 border-red-300 rounded-xl">
                    <TriangleAlert size={18} className="text-red-600 flex-shrink-0" />
                    <p className="text-sm font-semibold text-red-800">
                        {overtimeCount} visitante{overtimeCount > 1 ? 's' : ''} ha{overtimeCount > 1 ? 'n' : ''} excedido el tiempo máximo de estadía
                    </p>
                    <button
                        onClick={() => setActiveTab('CHECKED_IN')}
                        className="ml-auto text-xs font-bold text-red-600 hover:text-red-800 underline whitespace-nowrap"
                    >
                        Ver en tabla
                    </button>
                </div>
            )}

            {/* ── Action error ── */}
            {actionError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-semibold">
                    <AlertCircle size={16} /> {actionError}
                </div>
            )}

            <div className="flex-1 min-h-0">

                {/* ── Visit table panel ── */}
                <div className="h-full bg-white rounded-2xl border border-suprema-gray-100 shadow-sm flex flex-col overflow-hidden">

                    {/* ── Toolbar ── */}
                    <div className="border-b border-suprema-gray-100 px-4 py-3 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Tabs */}
                            <div className="flex space-x-1 p-1 bg-suprema-gray-100/80 rounded-lg">
                                {(['ALL', 'CHECKED_IN', 'EXPECTED', 'NO_SHOW'] as const).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => handleTabChange(tab)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                                            activeTab === tab
                                                ? tab === 'NO_SHOW'
                                                    ? 'bg-purple-600 text-white shadow-sm'
                                                    : 'bg-white text-suprema-gray-900 shadow-sm'
                                                : 'text-suprema-gray-800/60 hover:text-suprema-gray-900'
                                        }`}
                                    >
                                        {tab === 'EXPECTED'
                                            ? t('visitors.tabExpected')
                                            : tab === 'CHECKED_IN'
                                            ? t('visitors.tabInBuilding')
                                            : tab === 'NO_SHOW'
                                            ? 'No-Show'
                                            : t('visitors.tabAll')}
                                        {tab === 'EXPECTED' && (
                                            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-suprema-gray-900/10 rounded-full font-bold">
                                                {visits.filter(v => ['SCHEDULED','PRE_REGISTERED'].includes(v.status)).length}
                                            </span>
                                        )}
                                        {tab === 'CHECKED_IN' && (
                                            <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${overtimeCount > 0 ? 'bg-red-500 text-white' : 'bg-suprema-gray-900/10'}`}>
                                                {visits.filter(v => v.status === 'CHECKED_IN').length}
                                            </span>
                                        )}
                                        {tab === 'NO_SHOW' && activeTab === 'NO_SHOW' && (
                                            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-white/20 rounded-full font-bold">
                                                {visits.filter(v => v.status === 'NO_SHOW').length}
                                            </span>
                                        )}
                                    </button>
                                ))}
                                {falseExitCount > 0 && (
                                    <button
                                        onClick={() => handleTabChange('FALSE_EXIT')}
                                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                                            activeTab === 'FALSE_EXIT'
                                                ? 'bg-red-600 text-white shadow-sm'
                                                : 'text-red-600 hover:bg-red-50'
                                        }`}
                                    >
                                        <AlertTriangle size={12} className={activeTab === 'FALSE_EXIT' ? '' : 'animate-pulse'} />
                                        Falsa Salida
                                        <span className={`ml-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'FALSE_EXIT' ? 'bg-white/25 text-white' : 'bg-red-600 text-white'}`}>
                                            {falseExitCount}
                                        </span>
                                    </button>
                                )}
                            </div>
                            {/* ── Visitantes Frecuentes — extremo derecho ── */}
                            <button
                                onClick={() => handleTabChange('FREQUENT')}
                                className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 ${
                                    activeTab === 'FREQUENT'
                                        ? 'bg-amber-500 border-amber-500 text-white shadow-sm shadow-amber-200'
                                        : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-50'
                                }`}
                            >
                                <span>⭐</span>
                                Visitantes Frecuentes
                                {frequentTotal > 0 && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === 'FREQUENT' ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}>
                                        {frequentTotal}
                                    </span>
                                )}
                            </button>

                            {/* Global search */}
                            <div className="relative flex-1 min-w-[160px]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-suprema-gray-800/40" />
                                <input
                                    type="text"
                                    placeholder="Buscar nombre, cédula, empresa..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-8 py-2 bg-suprema-gray-100/30 border border-suprema-gray-100 rounded-lg text-xs focus:bg-white focus:border-suprema-burgundy/50 focus:ring-2 focus:ring-suprema-burgundy/10 transition-all outline-none"
                                />
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-suprema-gray-800/40 hover:text-suprema-gray-900">
                                        <X size={12} />
                                    </button>
                                )}
                            </div>

                            {/* Refresh */}
                            <button
                                onClick={() => fetchVisits()}
                                disabled={isLoading}
                                className="p-2 rounded-xl border border-suprema-gray-200 text-suprema-gray-800/60 hover:text-suprema-gray-900 hover:border-suprema-gray-300 transition-colors"
                            >
                                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                            </button>

                            {/* Pagination controls */}
                            {activeTab !== 'FREQUENT' && filteredVisits.length > 0 && (
                                <>
                                    {/* Page size selector */}
                                    <div className="relative" ref={pageSizeMenuRef}>
                                        <button
                                            onClick={() => setPageSizeMenuOpen(o => !o)}
                                            className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-suprema-gray-200 bg-white text-[11px] font-semibold text-suprema-gray-700 hover:border-suprema-gray-300 transition-colors"
                                            title="Visitantes por página"
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
                                            className="p-2 rounded-xl border border-suprema-gray-200 bg-white text-suprema-gray-700 hover:border-suprema-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            title="Página anterior"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                        <span className="px-2 text-[11px] font-semibold text-suprema-gray-700 whitespace-nowrap">
                                            Página {safeCurrentPage} de {totalPages}
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={safeCurrentPage >= totalPages}
                                            className="p-2 rounded-xl border border-suprema-gray-200 bg-white text-suprema-gray-700 hover:border-suprema-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            title="Página siguiente"
                                        >
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Active filter chips */}
                        {activeFilterCount > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] font-bold text-suprema-gray-800/40 uppercase tracking-wider">Filtros activos:</span>
                                {Array.from(columnFilters.entries()).map(([colId, filter]) => {
                                    const col = COLUMNS.find(c => c.id === colId);
                                    const opLabel: Record<string, string> = {
                                        contains: 'contiene', not_contains: 'no contiene',
                                        equals: '=', not_equals: '≠', starts_with: 'empieza',
                                        empty: 'vacío', not_empty: 'no vacío',
                                        before: 'antes', after: 'después',
                                    };
                                    return (
                                        <span key={colId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-suprema-burgundy/10 text-suprema-burgundy rounded-full text-[10px] font-bold">
                                            {col?.label} {opLabel[filter.operator] ?? filter.operator}
                                            {filter.value && ` "${filter.value}"`}
                                            <button onClick={() => removeColumnFilter(colId)} className="ml-0.5 hover:text-red-600">
                                                <X size={9} />
                                            </button>
                                        </span>
                                    );
                                })}
                                <button onClick={() => setColumnFilters(new Map())} className="text-[10px] font-semibold text-suprema-gray-800/40 hover:text-red-500 transition-colors ml-1">
                                    Limpiar todos
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Frequent Visitors Panel ── */}
                    {activeTab === 'FREQUENT' && (
                        <div className="flex-1 overflow-auto p-4 space-y-4">
                            {/* Header + controls */}
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                    <span className="text-amber-500 text-lg">⭐</span>
                                    <div>
                                        <p className="text-sm font-bold text-suprema-gray-900">
                                            {isFrequentLoading ? 'Cargando...' : `${frequentTotal} visitante${frequentTotal !== 1 ? 's' : ''} frecuente${frequentTotal !== 1 ? 's' : ''}`}
                                        </p>
                                        <p className="text-[10px] text-suprema-gray-800/50">Visitantes con ≥ {frequentMinVisits} visitas en los últimos 180 días</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-[10px] font-bold text-suprema-gray-800/50 uppercase tracking-wider whitespace-nowrap">Umbral mín.:</label>
                                    <select
                                        value={frequentMinVisits}
                                        onChange={e => { const v = Number(e.target.value); setFrequentMinVisits(v); fetchFrequentVisitors(v); }}
                                        className="text-xs border border-suprema-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-amber-400"
                                    >
                                        {[2,3,4,5,7,10].map(n => <option key={n} value={n}>{n} visitas</option>)}
                                    </select>
                                    <button
                                        onClick={() => fetchFrequentVisitors()}
                                        disabled={isFrequentLoading}
                                        className="p-1.5 rounded-lg border border-suprema-gray-200 text-suprema-gray-800/60 hover:text-suprema-gray-900 hover:border-suprema-gray-300 transition-colors"
                                    >
                                        <RefreshCw size={13} className={isFrequentLoading ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                                <div className="relative min-w-[180px]">
                                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-suprema-gray-800/40" />
                                    <input
                                        value={frequentSearch}
                                        onChange={e => setFrequentSearch(e.target.value)}
                                        placeholder="Buscar nombre o empresa..."
                                        className="w-full pl-7 pr-3 py-1.5 text-xs border border-suprema-gray-200 rounded-lg outline-none focus:border-amber-400 bg-white"
                                    />
                                </div>
                            </div>

                            {/* Card grid */}
                            {isFrequentLoading ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                                    <p className="text-sm text-suprema-gray-800/50">Cargando visitantes frecuentes...</p>
                                </div>
                            ) : (() => {
                                const q = frequentSearch.toLowerCase();
                                const filtered = frequentSearch
                                    ? frequentVisitors.filter(fv =>
                                        fv.fullName.toLowerCase().includes(q) ||
                                        (fv.company ?? '').toLowerCase().includes(q)
                                    )
                                    : frequentVisitors;

                                if (filtered.length === 0) return (
                                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                                        <Users size={32} className="text-suprema-gray-800/20" />
                                        <p className="text-sm font-semibold text-suprema-gray-800/40">
                                            {frequentSearch ? 'Sin resultados para la búsqueda' : 'No hay visitantes frecuentes aún'}
                                        </p>
                                        <p className="text-xs text-suprema-gray-800/30">
                                            {!frequentSearch && `Se muestran visitantes con ${frequentMinVisits} o más visitas en los últimos 180 días`}
                                        </p>
                                    </div>
                                );

                                return (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                        {filtered.map(fv => {
                                            const initials = `${fv.firstName[0] ?? ''}${fv.lastName[0] ?? ''}`.toUpperCase();
                                            const lastVisit = fv.lastVisitDate ? new Date(fv.lastVisitDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                                            const rankColor = fv.visitCount >= 10 ? 'text-amber-600' : fv.visitCount >= 5 ? 'text-amber-500' : 'text-amber-400';
                                            return (
                                                <div
                                                    key={fv.id}
                                                    onClick={async () => {
                                                        try {
                                                            const { data } = await api.get(`/visitors/${fv.id}/history`, { params: { limit: 1 } });
                                                            const visitId = data.visits?.[0]?.id ?? null;
                                                            if (visitId) setDetailVisitId(visitId);
                                                        } catch { /* silent */ }
                                                    }}
                                                    className="bg-white border border-suprema-gray-100 rounded-2xl p-4 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
                                                >
                                                    <div className="flex items-start gap-3 mb-3">
                                                        <div className="relative flex-shrink-0">
                                                            {fv.photoPath ? (
                                                                <AuthImage
                                                                    src={`/visitors/${fv.id}/photo`}
                                                                    alt={fv.fullName}
                                                                    className="w-12 h-12 rounded-full object-cover border-2 border-amber-200"
                                                                />
                                                            ) : (
                                                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm border-2 border-amber-200">
                                                                    {initials}
                                                                </div>
                                                            )}
                                                            <span className={`absolute -top-1 -right-1 text-sm ${rankColor}`}>⭐</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-bold text-suprema-gray-900 truncate group-hover:text-amber-700 transition-colors">
                                                                {fv.fullName}
                                                            </p>
                                                            <p className="text-xs text-suprema-gray-800/50 truncate">{fv.company ?? '—'}</p>
                                                        </div>
                                                        <div className="flex-shrink-0 text-right">
                                                            <p className={`text-xl font-black ${rankColor}`}>{fv.visitCount}</p>
                                                            <p className="text-[9px] text-suprema-gray-800/40 uppercase tracking-wider leading-none">visitas</p>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] text-suprema-gray-800/40 uppercase tracking-wider">Última visita</span>
                                                            <span className="text-[11px] font-semibold text-suprema-gray-700">{lastVisit}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] text-suprema-gray-800/40 uppercase tracking-wider">Doc.</span>
                                                            <span className="text-[11px] font-mono text-suprema-gray-700">{fv.documentType} {fv.documentNumber}</span>
                                                        </div>
                                                        {fv.visitorType && (
                                                            <div className="pt-1">
                                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${visitorTypeLabels[fv.visitorType]?.color ?? 'bg-gray-100 text-gray-600'}`}>
                                                                    {visitorTypeLabels[fv.visitorType]?.label ?? fv.visitorType}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* ── Table ── */}
                    {activeTab !== 'FREQUENT' && (
                    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-scroll">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr className="bg-suprema-gray-50/80">
                                    {/* Checkbox select-all */}
                                    <th className="pl-4 pr-2 py-2.5 border-b border-suprema-gray-100 sticky top-0 bg-suprema-gray-50/95 backdrop-blur-sm w-8">
                                        <button
                                            onClick={toggleSelectAll}
                                            className="w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                                            style={{
                                                borderColor: allFilteredSelected ? 'rgb(161,41,68)' : someSelected ? 'rgb(161,41,68)' : 'rgb(209,213,219)',
                                                backgroundColor: allFilteredSelected ? 'rgb(161,41,68)' : 'transparent',
                                            }}
                                            title={allFilteredSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                                        >
                                            {allFilteredSelected && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                                            {someSelected && !allFilteredSelected && <span className="text-suprema-burgundy text-[9px] font-bold leading-none">—</span>}
                                        </button>
                                    </th>
                                    {visibleColIds.map(col => (
                                        <th
                                            key={col.id}
                                            className={`px-3 py-2.5 border-b border-suprema-gray-100 text-[10px] font-bold text-suprema-gray-800/50 uppercase tracking-wider sticky top-0 bg-suprema-gray-50/95 backdrop-blur-sm whitespace-nowrap${col.id === 'actions' ? ' right-0 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] text-right' : ''}`}
                                        >
                                            <span className="flex items-center gap-1">
                                                {col.label}
                                                {col.id !== 'actions' && (col as any).getValue && (
                                                    <button
                                                        onClick={() => handleSort(col.id)}
                                                        className={`flex-shrink-0 transition-colors rounded p-0.5 ${sortBy === col.id ? 'text-suprema-burgundy' : 'text-suprema-gray-800/30 hover:text-suprema-gray-800/60'}`}
                                                        title={sortBy === col.id ? (sortDir === 'asc' ? 'Orden ascendente — clic para invertir' : 'Orden descendente — clic para invertir') : 'Ordenar por esta columna'}
                                                    >
                                                        {sortBy === col.id
                                                            ? sortDir === 'asc'
                                                                ? <ArrowUp size={10} strokeWidth={2.5} />
                                                                : <ArrowDown size={10} strokeWidth={2.5} />
                                                            : <ArrowUpDown size={10} strokeWidth={2} />
                                                        }
                                                    </button>
                                                )}
                                                {col.filterType && (
                                                    <ColumnFilterPopover
                                                        columnId={col.id}
                                                        columnLabel={col.label}
                                                        filterType={col.filterType}
                                                        filterOptions={(col as any).filterOptions}
                                                        activeFilter={columnFilters.get(col.id)}
                                                        onFilterChange={f => f ? setColumnFilter(f) : removeColumnFilter(col.id)}
                                                    />
                                                )}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-suprema-gray-100/50">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={visibleColIds.length + 1} className="px-4 py-12 text-center text-suprema-gray-600">
                                            <div className="flex flex-col items-center gap-2">
                                                <Loader2 className="w-6 h-6 animate-spin text-suprema-burgundy" />
                                                <span className="text-sm">{t('visitors.loadingVisitors')}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredVisits.length === 0 ? (
                                    <tr>
                                        <td colSpan={visibleColIds.length + 1} className="px-4 py-12 text-center">
                                            {activeTab === 'NO_SHOW' ? (
                                                <div className="flex flex-col items-center gap-2">
                                                    <div className="p-3 rounded-full bg-purple-50 inline-flex">
                                                        <UserX size={22} className="text-purple-400" />
                                                    </div>
                                                    <p className="text-sm font-semibold text-suprema-gray-700">Sin registros No-Show</p>
                                                    <p className="text-xs text-suprema-gray-800/40">No hay visitas marcadas como No-Show en este momento</p>
                                                </div>
                                            ) : (
                                                <span className="text-suprema-gray-600 text-sm">{t('visitors.noVisitorsFound')}</span>
                                            )}
                                        </td>
                                    </tr>
                                ) : paginatedVisits.map(visit => {
                                    const loading = actionLoading[visit.id];
                                    const overtime = isOvertime(visit);
                                    const isSelected = selectedIds.has(visit.id);
                                    return (
                                        <tr
                                            key={visit.id}
                                            className={`hover:bg-suprema-gray-100/30 transition-colors group cursor-pointer ${isSelected ? 'bg-suprema-burgundy/5 hover:bg-suprema-burgundy/8' : ''}`}
                                            onClick={() => setDetailVisitId(visit.id)}
                                        >
                                            {/* Checkbox cell */}
                                            <td className="pl-4 pr-2 py-3 w-8" onClick={e => toggleSelect(visit.id, e)}>
                                                <div
                                                    className="w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer"
                                                    style={{
                                                        borderColor: isSelected ? 'rgb(161,41,68)' : 'rgb(209,213,219)',
                                                        backgroundColor: isSelected ? 'rgb(161,41,68)' : 'transparent',
                                                    }}
                                                >
                                                    {isSelected && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                                                </div>
                                            </td>

                                            {/* Visitante */}
                                            {visibleColumns.has('name') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <div className="flex items-center gap-3">
                                                        {visit.visitor?.photoPath ? (
                                                            <AuthImage
                                                                src={`/visitors/${visit.visitor.id}/photo?v=${visit.visitor.updatedAt ? new Date(visit.visitor.updatedAt).getTime() : 1}`}
                                                                alt={`${visit.visitor.firstName} ${visit.visitor.lastName}`}
                                                                className="h-8 w-8 rounded-full object-cover border border-suprema-gray-200 flex-shrink-0"
                                                                fallback={
                                                                    <div className="h-8 w-8 rounded-full bg-suprema-gray-100 flex items-center justify-center font-bold text-suprema-gray-800/50 text-xs flex-shrink-0">
                                                                        {visit.visitor?.firstName?.[0] ?? 'V'}
                                                                    </div>
                                                                }
                                                            />
                                                        ) : (
                                                            <div className="h-8 w-8 rounded-full bg-suprema-gray-100 flex items-center justify-center font-bold text-suprema-gray-800/50 text-xs flex-shrink-0">
                                                                {visit.visitor?.firstName?.[0] ?? 'V'}
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="text-sm text-suprema-gray-900 leading-tight font-normal">
                                                                {visit.visitor?.firstName} {visit.visitor?.lastName}
                                                            </div>
                                                            <div className="text-[10px] text-suprema-gray-800/50 font-medium">
                                                                {visit.visitor?.documentType ?? ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            )}

                                            {/* Cédula */}
                                            {visibleColumns.has('document') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <span className="font-mono text-xs font-semibold text-suprema-gray-900 bg-suprema-gray-100 px-2 py-0.5 rounded">
                                                        {visit.visitor?.documentNumber ?? '—'}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Empresa */}
                                            {visibleColumns.has('company') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <span className="text-xs text-suprema-gray-800/70">
                                                        {visit.visitor?.company ?? <span className="text-suprema-gray-800/30">—</span>}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Anfitrión */}
                                            {visibleColumns.has('host') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <div className="text-xs font-semibold text-suprema-gray-900">{visit.host?.fullName ?? visit.hostUser?.fullName ?? '—'}</div>
                                                </td>
                                            )}

                                            {/* Hora agendada */}
                                            {visibleColumns.has('scheduledAt') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <span className="text-xs text-suprema-gray-800/70">{fmtTime(visit.scheduledAt)}</span>
                                                </td>
                                            )}

                                            {/* Estado */}
                                            {visibleColumns.has('status') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    {statusBadge(visit)}
                                                    {visit.status === 'CHECKED_IN' && visit.checkedInAt && (
                                                        <div className="text-[10px] text-suprema-gray-800/40 mt-0.5">
                                                            ingreso {fmtTime(visit.checkedInAt)}
                                                        </div>
                                                    )}
                                                </td>
                                            )}

                                            {/* Check-in hora */}
                                            {visibleColumns.has('checkedInAt') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <span className="text-xs text-suprema-gray-800/70">{fmtTime(visit.checkedInAt)}</span>
                                                </td>
                                            )}

                                            {/* Método acceso */}
                                            {visibleColumns.has('accessMethod') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <span className="text-[10px] font-bold tracking-wider text-suprema-gray-800/50">
                                                        {visit.accessMethod ?? '—'}
                                                    </span>
                                                </td>
                                            )}

                                            {/* Sync */}
                                            {visibleColumns.has('sync') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    <SyncStatusBadge syncStatus={visit.syncStatus} />
                                                </td>
                                            )}

                                            {/* Tipo de Visitante */}
                                            {visibleColumns.has('visitorType') && (
                                                <td className="px-3 py-2.5 whitespace-nowrap">
                                                    {(() => {
                                                        const meta = visitorTypeLabels[visit.visitorType ?? 'WALK_IN'] ?? visitorTypeLabels.WALK_IN;
                                                        return (
                                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap ${meta.color}`}>
                                                                <span>{meta.icon}</span> {meta.label}
                                                            </span>
                                                        );
                                                    })()}
                                                </td>
                                            )}

                                            {/* Grupos de Acceso */}
                                            {visibleColumns.has('accessGroups') && (
                                                <td className="px-3 py-2.5">
                                                    {visit.accessGroups?.length ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {visit.accessGroups.map((g) => (
                                                                <span
                                                                    key={g.id}
                                                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold rounded-full whitespace-nowrap"
                                                                >
                                                                    <Shield size={9} />
                                                                    {g.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-suprema-gray-800/30 italic">Sin acceso</span>
                                                    )}
                                                </td>
                                            )}

                                            {/* Acciones */}
                                            <td
                                                className="px-3 py-3 whitespace-nowrap text-right sticky right-0 bg-white shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {/* Print badge */}
                                                    <button
                                                        onClick={() => setPrintVisitId(visit.id)}
                                                        className="p-1.5 rounded-lg border border-suprema-gray-300 text-suprema-gray-700 hover:bg-suprema-gray-100 hover:border-suprema-gray-300 hover:text-suprema-gray-900 transition-colors"
                                                        title="Imprimir gafete (Sewoo LK-B30IIE)"
                                                    >
                                                        <Printer size={14} />
                                                    </button>

                                                    {/* Fingerprint enrollment */}
                                                    <button
                                                        onClick={() => setFingerprintVisit({ id: visit.id, name: visit.visitor?.firstName ?? '' })}
                                                        className="p-1.5 rounded-lg border border-suprema-gray-300 text-red-600 hover:bg-suprema-gray-100 hover:border-suprema-gray-300 hover:text-red-600 transition-colors"
                                                        title="Enrolar huellas dactilares (BioMini Slim 2)"
                                                    >
                                                        <Fingerprint size={14} />
                                                    </button>

                                                    {/* Check-in */}
                                                    {(visit.status === 'SCHEDULED' || visit.status === 'PRE_REGISTERED') && (
                                                        <button
                                                            onClick={() => handleAction(visit.id, 'checkin', visit)}
                                                            disabled={!!loading}
                                                            className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                                            title="Check-in"
                                                        >
                                                            {loading === 'checkin'
                                                                ? <Loader2 size={14} className="animate-spin" />
                                                                : <UserCheck size={14} />
                                                            }
                                                        </button>
                                                    )}

                                                    {/* No-Show */}
                                                    {(visit.status === 'SCHEDULED' || visit.status === 'PRE_REGISTERED') && (
                                                        <button
                                                            onClick={() => handleAction(visit.id, 'noshow')}
                                                            disabled={!!loading}
                                                            className="p-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
                                                            title="Marcar como No-Show (nunca llegó)"
                                                        >
                                                            {loading === 'noshow'
                                                                ? <Loader2 size={14} className="animate-spin" />
                                                                : <XCircle size={14} />
                                                            }
                                                        </button>
                                                    )}

                                                    {/* Checkout */}
                                                    {visit.status === 'CHECKED_IN' && (
                                                        <button
                                                            onClick={() => handleAction(visit.id, 'checkout')}
                                                            disabled={!!loading}
                                                            className={`p-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors relative ${overtime ? 'ring-2 ring-red-300 animate-pulse' : ''}`}
                                                            title={overtime ? 'Checkout (¡tiempo excedido!)' : 'Checkout'}
                                                        >
                                                            {loading === 'checkout'
                                                                ? <Loader2 size={14} className="animate-spin" />
                                                                : <ArrowRight size={14} />
                                                            }
                                                        </button>
                                                    )}

                                                    {/* Falsa salida reportada — resolver (reactivar o descartar) */}
                                                    {visit.status === 'FALSE_EXIT_REPORTED' && (
                                                        <button
                                                            onClick={() => {
                                                                const name = visit.visitor
                                                                    ? `${visit.visitor.firstName} ${visit.visitor.lastName}`.trim()
                                                                    : 'Visitante';
                                                                setFalseExitModal({ visitId: visit.id, visitorName: name });
                                                            }}
                                                            className="p-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors animate-pulse"
                                                            title="Resolver reporte de falsa salida"
                                                        >
                                                            <TriangleAlert size={14} />
                                                        </button>
                                                    )}

                                                    {/* Quick actions para visitas ya finalizadas: reagendar / re-ingreso */}
                                                    {visit.status === 'CHECKED_OUT' && (
                                                        <>
                                                            <button
                                                                onClick={() => {
                                                                    setRegisterPrefillDoc(
                                                                        visit.visitor?.documentType && visit.visitor?.documentNumber
                                                                            ? { documentType: visit.visitor.documentType, documentNumber: visit.visitor.documentNumber }
                                                                            : null
                                                                    );
                                                                    setIsRegisterModalOpen(true);
                                                                }}
                                                                className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                                                title="Agendar nueva visita"
                                                            >
                                                                <CalendarPlus size={14} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleAction(visit.id, 'checkin', visit)}
                                                                disabled={!!loading}
                                                                className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                                                title="Check-in (reingreso)"
                                                            >
                                                                {loading === 'checkin'
                                                                    ? <Loader2 size={14} className="animate-spin" />
                                                                    : <UserCheck size={14} />
                                                                }
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    )}

                    {/* ── Bulk action bar (visible when items selected) ── */}
                    {selectedIds.size > 0 && (
                        <div className="px-4 py-2.5 bg-suprema-burgundy/5 border-t-2 border-suprema-burgundy/20 flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-suprema-burgundy/10">
                                    <Users size={13} className="text-suprema-burgundy" />
                                </div>
                                <span className="text-xs font-bold text-suprema-burgundy">
                                    {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
                                </span>
                            </div>

                            {bulkCheckinIds.length > 0 && (
                                <button
                                    onClick={() => setBulkConfirm({ action: 'checkin', ids: bulkCheckinIds, count: bulkCheckinIds.length })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors shadow-sm"
                                >
                                    <UserCheck size={13} />
                                    Check-In masivo ({bulkCheckinIds.length})
                                </button>
                            )}

                            {bulkCheckoutIds.length > 0 && (
                                <button
                                    onClick={() => setBulkConfirm({ action: 'checkout', ids: bulkCheckoutIds, count: bulkCheckoutIds.length })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-suprema-burgundy text-white rounded-lg text-xs font-bold hover:bg-suprema-burgundy-dark transition-colors shadow-sm"
                                >
                                    <ArrowRight size={13} />
                                    Checkout masivo ({bulkCheckoutIds.length})
                                </button>
                            )}

                            <button
                                onClick={exportCsv}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-suprema-gray-200 text-suprema-gray-800 rounded-lg text-xs font-semibold hover:border-suprema-gray-300 transition-colors"
                            >
                                <Download size={13} className="text-emerald-600" />
                                Exportar selección
                            </button>

                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="ml-auto text-xs font-semibold text-suprema-gray-800/50 hover:text-suprema-gray-900 flex items-center gap-1 transition-colors"
                            >
                                <X size={12} />
                                Limpiar selección
                            </button>
                        </div>
                    )}

                    {/* ── Footer count ── */}
                    <div className="px-4 py-2.5 border-t border-suprema-gray-100 bg-suprema-gray-50/50 flex items-center justify-between gap-4 flex-wrap">
                        <span className="text-[11px] text-suprema-gray-800/40 font-medium">
                            {filteredVisits.length} de {visits.length} visita{visits.length !== 1 ? 's' : ''}
                            {activeFilterCount > 0 && ` · ${activeFilterCount} filtro${activeFilterCount > 1 ? 's' : ''} activo${activeFilterCount > 1 ? 's' : ''}`}
                            {selectedIds.size > 0 && ` · ${selectedIds.size} seleccionado${selectedIds.size !== 1 ? 's' : ''}`}
                        </span>
                        {(activeFilterCount > 0 || searchQuery) && (
                            <button
                                onClick={() => { setColumnFilters(new Map()); setSearchQuery(''); }}
                                className="text-[11px] font-semibold text-suprema-gray-800/40 hover:text-red-500 transition-colors"
                            >
                                Limpiar filtros
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Modals ── */}
            <PrintBadgeModal isOpen={!!printVisitId} onClose={() => setPrintVisitId(null)} visitId={printVisitId} />
            <FingerprintEnrollModal
                isOpen={!!fingerprintVisit}
                onClose={() => setFingerprintVisit(null)}
                visitId={fingerprintVisit?.id ?? null}
                visitorName={fingerprintVisit?.name}
            />
            <RegisterWalkInModal
                isOpen={isRegisterModalOpen}
                onClose={() => { setIsRegisterModalOpen(false); setRegisterPrefillDoc(null); }}
                onSuccess={() => { setIsRegisterModalOpen(false); setRegisterPrefillDoc(null); setRefreshKey(k => k + 1); }}
                prefillDocument={registerPrefillDoc}
            />
            <VisitorDetailModal
                isOpen={!!detailVisitId}
                visitId={detailVisitId}
                onClose={() => setDetailVisitId(null)}
                onUpdated={fetchVisits}
            />
            <CsvImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSuccess={() => { setRefreshKey(k => k + 1); showSuccess('Importación completada. Tabla actualizada.'); }}
            />

            {/* ── Falsa salida — modal de resolución ── */}
            {falseExitModal && (
                <FalseExitAlertModal
                    visitId={falseExitModal.visitId}
                    visitorName={falseExitModal.visitorName}
                    onClose={() => setFalseExitModal(null)}
                    onResolved={() => {
                        setFalseExitModal(null);
                        if (falseExitBanner?.visitId === falseExitModal.visitId) setFalseExitBanner(null);
                        fetchVisits();
                        showSuccess('Reporte de falsa salida resuelto correctamente.');
                    }}
                />
            )}

            {/* ── CheckIn modal (single) ── */}
            {checkInModal && (
                <CheckInModal
                    visitId={checkInModal.visitId}
                    visitorName={checkInModal.visitorName}
                    initialAutoCheckoutEnabled={checkInModal.autoCheckoutEnabled}
                    onClose={() => setCheckInModal(null)}
                    onSuccess={() => { fetchVisits(); showSuccess('Check-in registrado correctamente.'); }}
                />
            )}

            {/* ── Bulk confirm modal ── */}
            {bulkConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`p-2.5 rounded-xl ${bulkConfirm.action === 'checkin' ? 'bg-emerald-100' : 'bg-suprema-burgundy/10'}`}>
                                {bulkConfirm.action === 'checkin'
                                    ? <UserCheck size={20} className="text-emerald-700" />
                                    : <ArrowRight size={20} className="text-suprema-burgundy" />
                                }
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-gray-900">Confirmar acción masiva</h3>
                                <p className="text-xs text-gray-500">Esta acción no se puede deshacer</p>
                            </div>
                        </div>
                        <p className="text-sm text-gray-700 mb-4">
                            ¿Realizar{' '}
                            <strong>{bulkConfirm.action === 'checkin' ? 'check-in' : 'check-out'}</strong>{' '}
                            a <strong>{bulkConfirm.count} visitante{bulkConfirm.count !== 1 ? 's' : ''}</strong>?
                        </p>

                        {/* Validity pickers — only for bulk check-in */}
                        {bulkConfirm.action === 'checkin' && (() => {
                            const pad = (n: number) => String(n).padStart(2, '0');
                            const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                            const nowLocal = fmtLocal(new Date());
                            const minExpiry = bulkConfirm.startsAt
                                ? fmtLocal(new Date(new Date(bulkConfirm.startsAt).getTime() + 60000))
                                : fmtLocal(new Date(Date.now() + 60000));
                            return (
                                <div className="space-y-3 mb-5">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Entrada programada
                                        </label>
                                        <input
                                            type="datetime-local"
                                            value={bulkConfirm.startsAt ?? nowLocal}
                                            min={nowLocal}
                                            onChange={e => setBulkConfirm(prev => prev ? { ...prev, startsAt: e.target.value, expiresAt: undefined } : null)}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                                        />
                                        <p className="text-xs text-slate-400 mt-0.5">Auto-configurada al momento actual. Puede adelantarse.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Salida programada <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="datetime-local"
                                            value={bulkConfirm.expiresAt ?? ''}
                                            min={minExpiry}
                                            onChange={e => setBulkConfirm(prev => prev ? { ...prev, expiresAt: e.target.value } : null)}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
                                        />
                                        <p className="text-xs text-slate-400 mt-0.5">Se aplicará la misma vigencia a todos los visitantes seleccionados.</p>
                                    </div>
                                </div>
                            );
                        })()}

                        {actionError && bulkConfirm.action === 'checkin' && (
                            <p className="text-xs text-red-600 mb-3 flex items-center gap-1">
                                <AlertCircle size={11} /> {actionError}
                            </p>
                        )}

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setBulkConfirm(null)}
                                disabled={isBulkLoading}
                                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleBulkConfirm}
                                disabled={isBulkLoading || (bulkConfirm.action === 'checkin' && !bulkConfirm.expiresAt)}
                                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-white font-bold text-sm disabled:opacity-50 transition-colors ${
                                    bulkConfirm.action === 'checkin'
                                        ? 'bg-emerald-600 hover:bg-emerald-700'
                                        : 'bg-suprema-burgundy hover:bg-suprema-burgundy-dark'
                                }`}
                            >
                                {isBulkLoading && <Loader2 size={14} className="animate-spin" />}
                                {isBulkLoading ? 'Procesando...' : 'Confirmar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Success toast ── */}
            {successToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center gap-2 px-5 py-3 bg-emerald-700 text-white rounded-xl shadow-lg text-sm font-semibold">
                        <CheckCircle2 size={16} />
                        {successToast}
                    </div>
                </div>
            )}

            {/* ── Coming soon toast ── */}
            {comingSoonToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="flex items-center gap-2 px-5 py-3 bg-suprema-gray-900 text-white rounded-xl shadow-lg text-sm font-semibold">
                        <span className="text-amber-400">⏳</span>
                        {t('visitors.comingSoon', { feature: comingSoonToast })}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─────────────── SyncStatusBadge ─────────────── */

function SyncStatusBadge({ syncStatus }: { syncStatus: string | null | undefined }) {
    if (!syncStatus) return null;
    const configs: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
        SYNCED: { icon: <CheckCircle2 size={10} />, label: 'BioStar OK', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
        PENDING: { icon: <Clock size={10} />, label: 'Sync pendiente', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
        FAILED: { icon: <AlertCircle size={10} />, label: 'Sync fallido', className: 'bg-red-50 text-red-700 border border-red-200' },
        OFFLINE: { icon: <WifiOff size={10} />, label: 'Sin BioStar', className: 'bg-gray-50 text-gray-500 border border-gray-200' },
        NOT_CONFIGURED: { icon: <WifiOff size={10} />, label: 'No configurado', className: 'bg-gray-50 text-gray-400 border border-gray-200' },
    };
    const c = configs[syncStatus];
    if (!c) return null;
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.className}`}>
            {c.icon} {c.label}
        </span>
    );
}
