'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronLeft,
  Loader2,
  Eye,
  EyeOff,
  Shield,
  Wifi,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import {
  settingsApi,
  type SupremaConnection,
  type CreateConnectionPayload,
  type UpdateConnectionPayload,
  type ConnectionTestResult,
  type BioStarPlatform,
} from '@/lib/settings.api';
import { useI18n } from '@/i18n/I18nContext';

type FormMode = 'create' | 'edit';

const PLATFORM_LABELS: Record<BioStarPlatform, string> = {
  BIOSTAR_2: 'BioStar 2',
  BIOSTAR_X: 'BioStar X',
};

const STATUS_CONFIG = {
  NEVER_TESTED: { icon: Clock,        color: 'text-gray-400',  bg: 'bg-gray-50',  labelKey: 'suprema.statusNeverTested' },
  SUCCESS:      { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', labelKey: 'suprema.statusSuccess' },
  FAILED:       { icon: XCircle,      color: 'text-red-500',   bg: 'bg-red-50',   labelKey: 'suprema.statusFailed' },
  PENDING:      { icon: Loader2,      color: 'text-blue-500',  bg: 'bg-blue-50',  labelKey: 'suprema.testing' },
};

interface ConnectionFormData {
  name: string;
  description: string;
  platform: BioStarPlatform;
  apiUrl: string;
  loginId: string;
  password: string;
  caCertPath: string;
  isActive: boolean;
}

const EMPTY_FORM: ConnectionFormData = {
  name: '',
  description: '',
  platform: 'BIOSTAR_X',
  apiUrl: 'https://',
  loginId: '',
  password: '',
  caCertPath: '',
  isActive: true,
};

export default function SupremaConnectionsPage() {
  const { t } = useI18n();

  const [connections, setConnections] = useState<SupremaConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ConnectionFormData>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; result: ConnectionTestResult } | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await settingsApi.listConnections();
      setConnections(data);
    } catch (err: any) {
      setError(err.response?.data?.message || t('suprema.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const openCreateModal = () => {
    setFormMode('create');
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setShowPassword(false);
    setShowModal(true);
  };

  const openEditModal = (conn: SupremaConnection) => {
    setFormMode('edit');
    setEditingId(conn.id);
    setFormData({
      name: conn.name,
      description: conn.description || '',
      platform: conn.platform,
      apiUrl: conn.apiUrl,
      loginId: '',
      password: '',
      caCertPath: conn.hasCaCert ? '(configurado)' : '',
      isActive: conn.isActive,
    });
    setFormError(null);
    setShowPassword(false);
    setShowModal(true);
  };

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSave = async () => {
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError(t('suprema.nameRequired'));
      return;
    }
    if (!formData.apiUrl.startsWith('https://')) {
      setFormError(t('suprema.urlRequired'));
      return;
    }
    if (formMode === 'create' && !formData.loginId.trim()) {
      setFormError(t('suprema.loginRequired'));
      return;
    }
    if (formMode === 'create' && !formData.password.trim()) {
      setFormError(t('suprema.passwordRequired'));
      return;
    }

    setSaving(true);
    try {
      if (formMode === 'create') {
        const payload: CreateConnectionPayload = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          platform: formData.platform,
          apiUrl: formData.apiUrl.trim(),
          loginId: formData.loginId,
          password: formData.password,
          caCertPath: formData.caCertPath.trim() || undefined,
          isActive: formData.isActive,
        };
        await settingsApi.createConnection(payload);
      } else if (editingId) {
        const payload: UpdateConnectionPayload = {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          platform: formData.platform,
          apiUrl: formData.apiUrl.trim(),
          caCertPath: formData.caCertPath.trim() || undefined,
          isActive: formData.isActive,
        };
        if (formData.loginId.trim()) payload.loginId = formData.loginId;
        if (formData.password.trim()) payload.password = formData.password;
        await settingsApi.updateConnection(editingId, payload);
      }
      setShowModal(false);
      await loadConnections();
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        (Array.isArray(err.response?.data?.message)
          ? err.response.data.message.join(', ')
          : null) ||
        t('suprema.saveConnError');
      setFormError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await settingsApi.testConnection(id);
      setTestResult({ id, result });
      await loadConnections();
    } catch (err: any) {
      setTestResult({
        id,
        result: {
          success: false,
          message: err.response?.data?.message || t('suprema.loadError'),
          testedAt: new Date().toISOString(),
        },
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await settingsApi.deleteConnection(id);
      setDeleteConfirmId(null);
      if (testResult?.id === id) setTestResult(null);
      await loadConnections();
    } catch (err: any) {
      alert(err.response?.data?.message || t('suprema.deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t('suprema.never');
    return new Date(dateStr).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-1 text-sm text-suprema-gray-800/60 hover:text-suprema-burgundy transition-colors"
        >
          <ChevronLeft size={16} />
          {t('suprema.breadcrumbSettings')}
        </Link>
        <span className="text-suprema-gray-800/30">/</span>
        <span className="text-sm font-medium text-suprema-gray-900">
          {t('suprema.breadcrumbApi')}
        </span>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center flex-shrink-0">
            <Server className="w-5 h-5 text-suprema-burgundy" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-suprema-gray-900">
              {t('suprema.title')}
            </h1>
            <p className="text-xs text-suprema-gray-800/60 mt-0.5">
              {t('suprema.subtitle')}
            </p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-suprema-burgundy text-white text-sm font-semibold rounded-xl hover:bg-suprema-burgundy-dark active:scale-95 transition-all shadow-sm shadow-suprema-burgundy/20 flex-shrink-0"
        >
          <Plus size={16} />
          {t('suprema.newConnection')}
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-suprema-burgundy animate-spin" />
          <span className="ml-2 text-sm text-suprema-gray-800/60">{t('suprema.loadingConnections')}</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm">
          <AlertCircle size={18} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && connections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-suprema-gray-100 flex items-center justify-center mb-4">
            <Server className="w-8 h-8 text-suprema-gray-800/30" />
          </div>
          <p className="text-base font-semibold text-suprema-gray-900 mb-1">
            {t('suprema.noConnectionsTitle')}
          </p>
          <p className="text-sm text-suprema-gray-800/50 max-w-sm mb-6">
            {t('suprema.noConnectionsDesc')}
          </p>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-suprema-burgundy text-white text-sm font-semibold rounded-xl hover:bg-suprema-burgundy-dark transition-colors"
          >
            <Plus size={16} />
            {t('suprema.addFirstConnection')}
          </button>
        </div>
      )}

      {!loading && connections.length > 0 && (
        <div className="space-y-3">
          {connections.map((conn) => {
            const status = STATUS_CONFIG[conn.lastTestStatus];
            const StatusIcon = status.icon;
            const isTestingThis = testingId === conn.id;
            const thisTestResult = testResult?.id === conn.id ? testResult.result : null;

            return (
              <div
                key={conn.id}
                className="bg-white rounded-2xl border border-suprema-gray-100/80 overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`mt-0.5 flex-shrink-0 w-9 h-9 rounded-lg ${status.bg} flex items-center justify-center`}>
                        {isTestingThis ? (
                          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                        ) : conn.isActive ? (
                          <Wifi className="w-4 h-4 text-suprema-burgundy/70" />
                        ) : (
                          <WifiOff className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-suprema-gray-900 truncate">
                            {conn.name}
                          </h3>
                          <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            {PLATFORM_LABELS[conn.platform]}
                          </span>
                          {!conn.isActive && (
                            <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                              {t('suprema.connInactive')}
                            </span>
                          )}
                          {conn.hasCaCert && (
                            <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700 flex items-center gap-1">
                              <Shield size={9} />
                              CA Cert
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-suprema-gray-800/50 mt-0.5 font-mono truncate">
                          {conn.apiUrl}
                        </p>
                        {conn.description && (
                          <p className="text-xs text-suprema-gray-800/50 mt-1">
                            {conn.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-2">
                          <StatusIcon
                            className={`w-3.5 h-3.5 flex-shrink-0 ${isTestingThis ? 'animate-spin text-blue-500' : status.color}`}
                          />
                          <span className={`text-xs font-medium ${status.color}`}>
                            {isTestingThis ? t('suprema.testing') : t(status.labelKey)}
                          </span>
                          <span className="text-xs text-suprema-gray-800/40">
                            {t('suprema.lastTest', { date: formatDate(conn.lastTestedAt) })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleTest(conn.id)}
                        disabled={isTestingThis || !conn.isActive}
                        title={t('suprema.testBtn')}
                        className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isTestingThis ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Play size={16} />
                        )}
                      </button>
                      <button
                        onClick={() => openEditModal(conn)}
                        title={t('suprema.editBtn')}
                        className="p-2 rounded-lg text-suprema-gray-800/60 hover:bg-suprema-gray-100 transition-colors"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(conn.id)}
                        title={t('suprema.deleteBtn')}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {thisTestResult && (
                    <div
                      className={`mt-4 p-3 rounded-xl text-sm border ${
                        thisTestResult.success
                          ? 'bg-green-50 border-green-100 text-green-800'
                          : 'bg-red-50 border-red-100 text-red-800'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {thisTestResult.success ? (
                          <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-green-600" />
                        ) : (
                          <XCircle size={16} className="flex-shrink-0 mt-0.5 text-red-500" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium">{thisTestResult.message}</p>
                          {thisTestResult.serverInfo && (
                            <div className="mt-2 space-y-1 text-xs opacity-80">
                              {thisTestResult.serverInfo.version && (
                                <p>{t('suprema.serverVersion', { v: String(thisTestResult.serverInfo.version) })}</p>
                              )}
                              {thisTestResult.latencyMs !== undefined && (
                                <p>{t('suprema.latency', { ms: String(thisTestResult.latencyMs) })}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {!thisTestResult && conn.lastTestMessage && conn.lastTestStatus !== 'NEVER_TESTED' && (
                    <div className={`mt-3 px-3 py-2 rounded-lg text-xs ${
                      conn.lastTestStatus === 'SUCCESS'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}>
                      {conn.lastTestMessage}
                    </div>
                  )}
                </div>

                {deleteConfirmId === conn.id && (
                  <div className="border-t border-red-100 bg-red-50 px-5 py-4">
                    <p className="text-sm font-semibold text-red-700 mb-1">
                      {t('suprema.deleteConfirmTitle', { name: conn.name })}
                    </p>
                    <p className="text-xs text-red-600/80 mb-3">
                      {t('suprema.deleteConfirmDesc')}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(conn.id)}
                        disabled={deleting}
                        className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deleting ? t('suprema.deleting') : t('suprema.deleteYes')}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-3 py-1.5 bg-white text-red-600 text-xs font-semibold rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                      >
                        {t('suprema.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-suprema-gray-900/60 backdrop-blur-sm"
            onClick={() => !saving && setShowModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-suprema-gray-100">
              <div>
                <h2 className="text-base font-bold text-suprema-gray-900">
                  {formMode === 'create' ? t('suprema.modalCreateTitle') : t('suprema.modalEditTitle')}
                </h2>
                <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                  {t('suprema.modalSubtitle')}
                </p>
              </div>
              <button
                onClick={() => !saving && setShowModal(false)}
                className="p-1.5 rounded-lg text-suprema-gray-800/40 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.nameLabel')}
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleFormChange}
                    placeholder="Ej: Servidor Principal Edificio A"
                    className="w-full px-3 py-2.5 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.platformLabel')}
                  </label>
                  <select
                    name="platform"
                    value={formData.platform}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2.5 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors"
                  >
                    <option value="BIOSTAR_X">BioStar X</option>
                    <option value="BIOSTAR_2">BioStar 2</option>
                  </select>
                </div>

                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="isActive"
                      checked={formData.isActive}
                      onChange={handleFormChange}
                      className="w-4 h-4 rounded accent-suprema-burgundy"
                    />
                    <span className="text-sm font-medium text-suprema-gray-800/80">
                      {t('suprema.activeLabel')}
                    </span>
                  </label>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.urlLabel')}
                  </label>
                  <input
                    type="text"
                    name="apiUrl"
                    value={formData.apiUrl}
                    onChange={handleFormChange}
                    placeholder="https://192.168.1.10:443"
                    className="w-full px-3 py-2.5 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors font-mono"
                  />
                  <p className="text-[11px] text-suprema-gray-800/40 mt-1">
                    {t('suprema.urlHint')}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.loginIdLabel')}
                    {formMode === 'edit' && <span className="font-normal text-suprema-gray-800/40"> {t('suprema.loginIdEditHint')}</span>}
                  </label>
                  <input
                    type="text"
                    name="loginId"
                    value={formData.loginId}
                    onChange={handleFormChange}
                    placeholder="admin"
                    autoComplete="off"
                    className="w-full px-3 py-2.5 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.passwordLabel')}
                    {formMode === 'edit' && <span className="font-normal text-suprema-gray-800/40"> {t('suprema.passwordEditHint')}</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleFormChange}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="w-full px-3 py-2.5 pr-9 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-suprema-gray-800/40 hover:text-suprema-gray-800/70 transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.caCertLabel')}
                  </label>
                  <input
                    type="text"
                    name="caCertPath"
                    value={formData.caCertPath}
                    onChange={handleFormChange}
                    placeholder="/etc/biovisitor/certs/biostar-ca.pem"
                    className="w-full px-3 py-2.5 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors font-mono"
                  />
                  <p className="text-[11px] text-suprema-gray-800/40 mt-1">
                    {t('suprema.caCertHint')}
                  </p>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5">
                    {t('suprema.descriptionLabel')}
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleFormChange}
                    rows={2}
                    placeholder="Ej: Servidor BioStar X del edificio principal, zona norte"
                    className="w-full px-3 py-2.5 text-sm text-suprema-gray-900 bg-suprema-gray-100/50 border border-transparent focus:border-suprema-burgundy/40 focus:bg-white rounded-xl outline-none transition-colors resize-none"
                  />
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  {formError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-suprema-gray-100 bg-suprema-gray-100/30">
              <button
                onClick={() => !saving && setShowModal(false)}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-suprema-gray-800/70 hover:text-suprema-gray-900 transition-colors disabled:opacity-40"
              >
                {t('suprema.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-suprema-burgundy text-white text-sm font-semibold rounded-xl hover:bg-suprema-burgundy-dark disabled:opacity-50 transition-colors"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving
                  ? t('suprema.saving')
                  : formMode === 'create'
                  ? t('suprema.createConnection')
                  : t('suprema.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
