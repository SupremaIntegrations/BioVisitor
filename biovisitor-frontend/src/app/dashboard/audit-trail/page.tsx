'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import {
  Shield, Search, X, ChevronDown, ChevronRight,
  RefreshCw, AlertTriangle, CheckCircle,
  User, Clock, Activity, Filter,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';
import { usePermissions } from '@/hooks/usePermissions';

interface AuditLogEntry {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  userId: string;
  userName: string | null;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  details: Record<string, unknown> | null;
}

interface AuditLogsResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  AUDIT_EVENT: { label: 'Auditoría', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  USER_ACTION: { label: 'Acción Usuario', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  OPERATIONAL: { label: 'Operacional', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
};

function isFailure(action: string): boolean {
  return /fail|error|block|denied|reject|invalid/i.test(action);
}

function deriveStatus(action: string): 'success' | 'failure' {
  return isFailure(action) ? 'failure' : 'success';
}

function formatLocalTime(utcString: string): string {
  try {
    return new Date(utcString).toLocaleString(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return utcString;
  }
}

function ActionBadge({ action, label }: { action: string; label: string }) {
  const status = deriveStatus(action);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border
      ${status === 'success'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-red-50 text-red-700 border-red-200'}`}>
      {status === 'success'
        ? <CheckCircle size={10} />
        : <AlertTriangle size={10} />}
      {label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? { label: category, color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' };
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full border ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function JsonDiffViewer({ details }: { details: Record<string, unknown> | null }) {
  if (!details || Object.keys(details).length === 0) {
    return <p className="text-xs text-suprema-gray-800/50 italic">Sin detalles adicionales</p>;
  }

  const { previousValue, newValue } = details as Record<string, unknown>;

  if (previousValue === undefined || newValue === undefined) {
    return <p className="text-xs text-suprema-gray-800/50 italic">Sin detalles adicionales</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-1">Valor Anterior</p>
          <pre className="text-xs bg-red-50 text-red-800 rounded-lg p-3 overflow-auto max-h-40 border border-red-100">
            {typeof previousValue === 'object'
              ? JSON.stringify(previousValue, null, 2)
              : String(previousValue)}
          </pre>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-1">Valor Nuevo</p>
          <pre className="text-xs bg-emerald-50 text-emerald-800 rounded-lg p-3 overflow-auto max-h-40 border border-emerald-100">
            {typeof newValue === 'object'
              ? JSON.stringify(newValue, null, 2)
              : String(newValue)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-suprema-gray-100">
      {[1, 2, 3, 4, 5].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-suprema-gray-100 rounded animate-pulse" style={{ width: `${60 + i * 8}%` }} />
        </td>
      ))}
    </tr>
  );
}

const DATE_PRESETS = [
  { label: 'Hoy', days: 0 },
  { label: 'Ayer', days: 1 },
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
];

export default function AuditTrailPage() {
  const { t } = useI18n();
  const { canViewPage } = usePermissions();
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
    if (stored.role === 'OPERATOR' && !canViewPage('auditTrail')) window.location.href = '/dashboard';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
  const pageSizeMenuRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
      setCurrentUser({ role: stored.role || 'OPERATOR' });
    } catch { /* ignore */ }
  }, []);

  const fetchLogs = useCallback(async (pg = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startDate: new Date(startDate + 'T00:00:00').toISOString(),
        endDate: new Date(endDate + 'T23:59:59').toISOString(),
        page: String(pg),
        limit: String(pageSize),
      });
      if (category) params.set('category', category);
      if (search) params.set('search', search);

      const res = await api.get<AuditLogsResponse>(`/audit/logs?${params}`);
      setLogs(res.data.data);
      setTotal(res.data.total);
      setPage(res.data.page);
      setTotalPages(res.data.totalPages);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al cargar el registro de auditoría');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, category, search, pageSize]);

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pageSizeMenuRef.current && !pageSizeMenuRef.current.contains(e.target as Node)) {
        setPageSizeMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date();
    if (days === 1) {
      start.setDate(end.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else {
      start.setDate(end.getDate() - days);
    }
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  }

  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(val), 400);
  }

  if (currentUser?.role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <Shield size={48} className="text-red-400" />
        <p className="text-lg font-semibold text-suprema-gray-900">Acceso restringido</p>
        <p className="text-sm text-suprema-gray-800/60">Solo los administradores pueden ver el Registro de Auditoría.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-suprema-gray-900">{t('audit.title')}</h1>
          <p className="text-sm text-suprema-gray-800/60 mt-1">{t('audit.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-suprema-gray-800/50 bg-suprema-gray-100 px-3 py-1.5 rounded-full font-medium">
            {total.toLocaleString()} {t('audit.records')}
          </span>

          {/* Page size selector */}
          <div className="relative" ref={pageSizeMenuRef}>
            <button
              onClick={() => setPageSizeMenuOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-suprema-gray-200 bg-white text-xs font-semibold text-suprema-gray-700 hover:bg-suprema-gray-50 transition-colors"
              title="Registros por página"
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
              onClick={() => fetchLogs(page - 1)}
              disabled={page <= 1}
              className="p-2 rounded-xl border border-suprema-gray-200 bg-white text-suprema-gray-700 hover:bg-suprema-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Página anterior"
            >
              <ChevronRight size={14} className="rotate-180" />
            </button>
            <span className="px-2 text-[11px] font-semibold text-suprema-gray-700 whitespace-nowrap">
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => fetchLogs(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded-xl border border-suprema-gray-200 bg-white text-suprema-gray-700 hover:bg-suprema-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Página siguiente"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <button
            onClick={() => fetchLogs(page)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-suprema-gray-800 bg-white border border-suprema-gray-200 rounded-xl hover:bg-suprema-gray-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('audit.refresh')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-suprema-gray-100 p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider flex items-center gap-1">
            <Filter size={12} /> {t('audit.quickFilter')}
          </span>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.days)}
              className="text-xs px-3 py-1.5 rounded-lg border border-suprema-gray-200 hover:bg-suprema-gray-50 text-suprema-gray-700 font-medium transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-suprema-gray-800/60">{t('audit.from')}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-sm border border-suprema-gray-200 rounded-lg px-3 py-1.5 text-suprema-gray-900 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-suprema-gray-800/60">{t('audit.to')}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-sm border border-suprema-gray-200 rounded-lg px-3 py-1.5 text-suprema-gray-900 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30"
            />
          </div>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="text-sm border border-suprema-gray-200 rounded-lg px-3 py-1.5 text-suprema-gray-900 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 bg-white"
          >
            <option value="">{t('audit.allCategories')}</option>
            <option value="AUDIT_EVENT">Auditoría</option>
            <option value="USER_ACTION">Acción Usuario</option>
            <option value="OPERATIONAL">Operacional</option>
          </select>

          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-suprema-gray-800/30" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t('audit.searchPlaceholder')}
              className="w-full pl-9 pr-8 py-1.5 text-sm border border-suprema-gray-200 rounded-lg text-suprema-gray-900 placeholder-suprema-gray-800/40 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30"
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-suprema-gray-800/40 hover:text-suprema-gray-900">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-700">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full min-w-[900px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-suprema-gray-100 bg-suprema-gray-100/95 backdrop-blur-sm">
                <th className="text-left px-4 py-3 text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider w-8"></th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><Clock size={11} /> {t('audit.colWhen')}</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><User size={11} /> {t('audit.colWho')}</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider">
                  <span className="flex items-center gap-1"><Activity size={11} /> {t('audit.colCategory')}</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider">
                  {t('audit.colAction')}
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-suprema-gray-800/50 uppercase tracking-wider">
                  {t('audit.colResource')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-20">
                    <Shield size={40} className="mx-auto text-suprema-gray-200 mb-3" />
                    <p className="text-sm font-medium text-suprema-gray-800/50">{t('audit.noRecords')}</p>
                    <p className="text-xs text-suprema-gray-800/30 mt-1">{t('audit.noRecordsHint')}</p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className={`border-b border-suprema-gray-100 hover:bg-suprema-gray-100/30 transition-colors cursor-pointer
                        ${expandedId === log.id ? 'bg-suprema-gray-100/40' : ''}`}
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-3">
                        <span className="text-suprema-gray-800/30">
                          {expandedId === log.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-suprema-gray-900 font-mono whitespace-nowrap">
                          {formatLocalTime(log.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-suprema-gray-900">
                            {log.userName || 'Sistema'}
                          </span>
                          <span className="text-[10px] font-mono text-suprema-gray-800/40 truncate max-w-[160px]">
                            {log.userId}
                          </span>
                          {log.ipAddress && (
                            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-suprema-gray-100 text-suprema-gray-800/60 w-fit">
                              {log.ipAddress}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <CategoryBadge category={log.category} />
                      </td>
                      <td className="px-4 py-3 max-w-[280px]">
                        <ActionBadge
                          action={log.action}
                          label={t(`auditAction.${log.action}`) !== `auditAction.${log.action}` ? t(`auditAction.${log.action}`) : log.action.replace(/\./g, ' › ')}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          {log.entityType && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-suprema-gray-800/40">
                              {log.entityType === 'bulk_visit' ? 'MASIVO' : log.entityType}
                            </span>
                          )}
                          {/* Bulk action: show count badge + first 3 visitor names */}
                          {Array.isArray((log.details as any)?.visitors) ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded bg-suprema-burgundy/10 text-suprema-burgundy w-fit">
                                {(log.details as any).count} visitante{(log.details as any).count !== 1 ? 's' : ''}
                              </span>
                              {((log.details as any).visitors as { visitorName: string }[]).slice(0, 3).map((v, i) => (
                                <span key={i} className="text-[10px] text-suprema-gray-800/60 truncate max-w-[160px]">
                                  · {v.visitorName}
                                </span>
                              ))}
                              {(log.details as any).visitors.length > 3 && (
                                <span className="text-[10px] text-suprema-gray-800/40 italic">
                                  +{(log.details as any).visitors.length - 3} más
                                </span>
                              )}
                            </div>
                          ) : (
                            <>
                              {(log.details as any)?.visitorName && (
                                <span className="text-xs font-semibold text-suprema-gray-900">
                                  {(log.details as any).visitorName}
                                </span>
                              )}
                              {(log.details as any)?.visitorDocument && (
                                <span className="text-[10px] font-mono text-suprema-gray-800/50">
                                  {(log.details as any).visitorDocument}
                                </span>
                              )}
                              {log.entityId && !(log.details as any)?.visitorName && (
                                <span className="text-[10px] font-mono text-suprema-gray-800/40 truncate max-w-[140px]">
                                  {log.entityId}
                                </span>
                              )}
                            </>
                          )}
                          {!log.entityType && !log.entityId && !Array.isArray((log.details as any)?.visitors) && (
                            <span className="text-suprema-gray-800/20 text-xs">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === log.id && (
                      <tr className="bg-suprema-gray-100/20">
                        <td colSpan={6} className="px-6 py-4">
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-4 text-xs text-suprema-gray-800/60">
                              <span><span className="font-semibold">Operador:</span> {log.userName || 'Sistema'} <span className="font-mono text-suprema-gray-800/40">({log.userId})</span></span>
                              <span><span className="font-semibold">ID evento:</span> <span className="font-mono">{log.id}</span></span>
                              {log.ipAddress && (
                                <span><span className="font-semibold">IP:</span> {log.ipAddress}</span>
                              )}
                              {log.correlationId && (
                                <span><span className="font-semibold">Correlación:</span> <span className="font-mono">{log.correlationId}</span></span>
                              )}
                              {log.userAgent && (
                                <span className="truncate max-w-xs">
                                  <span className="font-semibold">User-Agent:</span> {log.userAgent}
                                </span>
                              )}
                            </div>
                            <JsonDiffViewer details={log.details} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
