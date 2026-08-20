'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Cpu,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  Wifi,
  WifiOff,
  Camera,
  AlertCircle,
  CheckCircle2,
  Fingerprint,
  CreditCard,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';

interface BioStarDevice {
  id: string;
  name: string;
  typeName: string;
  ipAddress: string;
  status: 'connected' | 'disconnected' | 'unknown';
  faceSupported: boolean;
  fingerprintSupported: boolean;
  cardSupported: boolean;
}

interface EnrollerDevice {
  deviceId: string;
  deviceName: string;
  typeName: string;
  type: 'face' | 'fingerprint' | 'card';
  addedAt: string;
}

export default function EnrollersPage() {
  const { t } = useI18n();
  const [devices, setDevices] = useState<BioStarDevice[]>([]);
  const [enrollers, setEnrollers] = useState<EnrollerDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [enrollersLoading, setEnrollersLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [addType, setAddType] = useState<'face' | 'fingerprint' | 'card'>('face');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const TYPE_COLORS: Record<string, string> = {
    face: 'bg-violet-50 text-violet-700 border-violet-200',
    fingerprint: 'bg-blue-50 text-blue-700 border-blue-200',
    card: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  const TYPE_ICONS: Record<string, React.ReactNode> = {
    face: <Camera className="w-4 h-4" />,
    fingerprint: <Fingerprint className="w-4 h-4" />,
    card: <CreditCard className="w-4 h-4" />,
  };

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const res = await api.get('/devices');
      setDevices(res.data || []);
    } catch (err: any) {
      const msg =
        err.response?.data?.message || t('enrollers.noConnection');
      setDevicesError(msg);
    } finally {
      setDevicesLoading(false);
    }
  }, [t]);

  const fetchEnrollers = useCallback(async () => {
    setEnrollersLoading(true);
    try {
      const res = await api.get('/settings/enrollers');
      setEnrollers(res.data || []);
    } catch {
      setEnrollers([]);
    } finally {
      setEnrollersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnrollers();
    fetchDevices();
  }, [fetchEnrollers, fetchDevices]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleAddEnroller = async (deviceId: string) => {
    setAdding(`${deviceId}:${addType}`);
    try {
      const res = await api.post('/settings/enrollers', { deviceId, type: addType });
      setEnrollers(res.data || []);
      const deviceName = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
      showSuccess(t('enrollers.addedSuccess', { name: deviceName }));
    } catch (err: any) {
      alert(err.response?.data?.message || t('enrollers.noConnection'));
    } finally {
      setAdding(null);
    }
  };

  const handleRemoveEnroller = async (deviceId: string, type: string) => {
    setRemoving(`${deviceId}:${type}`);
    try {
      const res = await api.delete(`/settings/enrollers/${deviceId}?type=${type}`);
      setEnrollers(res.data || []);
      showSuccess(t('enrollers.removedSuccess'));
    } catch (err: any) {
      alert(err.response?.data?.message || t('enrollers.noConnection'));
    } finally {
      setRemoving(null);
    }
  };

  const handleRefreshDevices = async () => {
    try {
      await api.delete('/devices/cache');
    } catch {
    }
    await fetchDevices();
  };

  const isAlreadyEnroller = (deviceId: string, type: string) =>
    enrollers.some((e) => e.deviceId === deviceId && e.type === type);

  const canAddDevice = (device: BioStarDevice, type: 'face' | 'fingerprint' | 'card') => {
    if (type === 'face') return device.faceSupported;
    if (type === 'fingerprint') return device.fingerprintSupported;
    // cardSupported may be undefined on cached entries from before this field was added;
    // treat undefined as true (most Suprema devices have a card reader, and the backend
    // also defaults to card=true for unknown models).
    if (type === 'card') return device.cardSupported !== false;
    return true;
  };

  const noSupportLabel = (device: BioStarDevice, type: 'face' | 'fingerprint' | 'card') => {
    if (type === 'face' && !device.faceSupported) return t('enrollers.noFaceSupport');
    if (type === 'fingerprint' && !device.fingerprintSupported) return t('enrollers.noFingerprintSupport');
    // Only show "no card support" when explicitly false — undefined means "not yet determined"
    if (type === 'card' && device.cardSupported === false) return t('enrollers.noCardSupport');
    return null;
  };

  const enrollerCount = enrollers.length;
  const plural = enrollerCount !== 1 ? 's' : '';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/dashboard/settings"
          className="p-1.5 text-suprema-gray-800/50 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-suprema-gray-900">{t('enrollers.title')}</h1>
            <p className="text-sm text-suprema-gray-800/60">{t('enrollers.subtitle')}</p>
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <Cpu className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">{t('enrollers.whatAre')}</p>
            <p className="text-blue-700/80 leading-relaxed">{t('enrollers.whatAreDesc')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-suprema-gray-100/80 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-suprema-gray-100">
            <div>
              <h2 className="text-sm font-bold text-suprema-gray-900">{t('enrollers.availableTitle')}</h2>
              <p className="text-xs text-suprema-gray-800/50 mt-0.5">{t('enrollers.availableSubtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {([
                  { value: 'face',        Icon: Camera,      label: 'Facial'  },
                  { value: 'fingerprint', Icon: Fingerprint, label: 'Huella'  },
                  { value: 'card',        Icon: CreditCard,  label: 'Tarjeta' },
                ] as const).map(({ value: typeOption, Icon, label }) => (
                  <button
                    key={typeOption}
                    onClick={() => setAddType(typeOption)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      addType === typeOption
                        ? 'bg-suprema-burgundy text-white border-suprema-burgundy'
                        : 'text-suprema-gray-700 border-suprema-gray-200 hover:border-suprema-burgundy hover:text-suprema-burgundy'
                    }`}
                  >
                    <Icon className="w-3 h-3" /> {label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleRefreshDevices}
                disabled={devicesLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-suprema-gray-700 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-lg transition-colors disabled:opacity-50 border border-suprema-gray-200"
                title={t('enrollers.reloadTitle')}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${devicesLoading ? 'animate-spin' : ''}`} />
                {t('enrollers.refreshCapabilities')}
              </button>
            </div>
          </div>

          <div className="divide-y divide-suprema-gray-100 max-h-[420px] overflow-y-auto">
            {devicesLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-suprema-gray-800/50">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">{t('enrollers.loading')}</span>
              </div>
            ) : devicesError ? (
              <div className="flex flex-col items-center gap-2 py-10 px-5 text-center">
                <AlertCircle className="w-8 h-8 text-amber-400" />
                <p className="text-sm text-suprema-gray-800/70 font-medium">{t('enrollers.noConnection')}</p>
                <p className="text-xs text-suprema-gray-800/50">{devicesError}</p>
                <Link
                  href="/dashboard/settings/suprema"
                  className="mt-1 text-xs text-suprema-burgundy hover:underline"
                >
                  {t('enrollers.configureConnection')}
                </Link>
              </div>
            ) : devices.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Cpu className="w-8 h-8 text-suprema-gray-800/20" />
                <p className="text-sm text-suprema-gray-800/50">{t('enrollers.noDevices')}</p>
              </div>
            ) : (
              devices.map((device) => {
                const alreadyAdded = isAlreadyEnroller(device.id, addType);
                const key = `${device.id}:${addType}`;
                const isAdding = adding === key;
                const canAdd = canAddDevice(device, addType);
                const supportLabel = noSupportLabel(device, addType);

                return (
                  <div
                    key={device.id}
                    className={`flex items-center gap-3 px-5 py-3.5 ${alreadyAdded ? 'bg-emerald-50/50' : ''}`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-suprema-gray-100 flex items-center justify-center">
                      {device.status === 'connected' ? (
                        <Wifi className="w-4 h-4 text-emerald-500" />
                      ) : device.status === 'disconnected' ? (
                        <WifiOff className="w-4 h-4 text-red-400" />
                      ) : (
                        <Cpu className="w-4 h-4 text-suprema-gray-800/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-suprema-gray-900 truncate">{device.name}</p>
                      <p className="text-xs text-suprema-gray-800/50">
                        {device.typeName}
                        {device.ipAddress ? ` · ${device.ipAddress}` : ''}
                      </p>
                      {supportLabel && (
                        <p className="text-[10px] text-amber-600 mt-0.5">{supportLabel}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleAddEnroller(device.id)}
                      disabled={alreadyAdded || isAdding || !canAdd}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        alreadyAdded
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                          : !canAdd
                          ? 'bg-suprema-gray-100 text-suprema-gray-800/30 cursor-not-allowed'
                          : 'bg-suprema-burgundy/10 text-suprema-burgundy hover:bg-suprema-burgundy hover:text-white border border-suprema-burgundy/20'
                      }`}
                    >
                      {isAdding ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : alreadyAdded ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      {alreadyAdded ? t('enrollers.added') : t('enrollers.add')}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {devices.length > 0 && (
            <div className="px-5 py-3 border-t border-suprema-gray-100 bg-suprema-gray-50/50">
              <p className="text-xs text-suprema-gray-800/40">
                {t('enrollers.addingAs')}{' '}
                <span className="font-semibold">{t(`enrollers.typeLabels.${addType}`)}</span> — {t('enrollers.changeTypeHint')}
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-suprema-gray-100/80 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-suprema-gray-100">
            <div>
              <h2 className="text-sm font-bold text-suprema-gray-900">{t('enrollers.configuredTitle')}</h2>
              <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                {t('enrollers.configuredCount', { count: enrollerCount, plural })}
              </p>
            </div>
            {enrollersLoading && (
              <Loader2 className="w-4 h-4 animate-spin text-suprema-gray-800/40" />
            )}
          </div>

          <div className="divide-y divide-suprema-gray-100 max-h-[420px] overflow-y-auto">
            {enrollers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center px-5">
                <Cpu className="w-8 h-8 text-suprema-gray-800/20" />
                <p className="text-sm font-medium text-suprema-gray-800/50">{t('enrollers.empty')}</p>
                <p className="text-xs text-suprema-gray-800/40">{t('enrollers.emptyHint')}</p>
              </div>
            ) : (
              enrollers.map((enroller) => {
                const key = `${enroller.deviceId}:${enroller.type}`;
                const isRemoving = removing === key;
                return (
                  <div key={key} className="flex items-center gap-3 px-5 py-3.5">
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border ${
                        TYPE_COLORS[enroller.type]
                      }`}
                    >
                      {TYPE_ICONS[enroller.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-suprema-gray-900 truncate">
                          {enroller.deviceName}
                        </p>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                            TYPE_COLORS[enroller.type]
                          }`}
                        >
                          {t(`enrollers.typeLabels.${enroller.type}`)}
                        </span>
                      </div>
                      <p className="text-xs text-suprema-gray-800/50">
                        ID {enroller.deviceId} · {enroller.typeName} ·{' '}
                        {new Date(enroller.addedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveEnroller(enroller.deviceId, enroller.type)}
                      disabled={isRemoving}
                      className="flex-shrink-0 p-1.5 text-suprema-gray-800/30 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title={t('enrollers.deleteTitle')}
                    >
                      {isRemoving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {enrollers.length > 0 && (
            <div className="px-5 py-3 border-t border-suprema-gray-100 bg-suprema-gray-50/50">
              <p className="text-xs text-suprema-gray-800/40">{t('enrollers.faceHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
