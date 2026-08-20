'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TimerOff, CheckCircle2, Loader2, AlertCircle, ArrowLeft, Printer, ListChecks, Plus, Trash2, Tag, DoorOpen, Timer, RefreshCw, Wifi, WifiOff, Cpu } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useVisitorTypeCatalog } from '@/lib/visitor-types';

interface AutoCheckoutConfig {
    enabled: boolean;
    hour: number;
    minute: number;
    defaultMaxStayMinutes: number;
}

interface BioStarDevice {
    id: string;
    name: string;
    typeName: string;
    ipAddress: string;
    status: 'connected' | 'disconnected' | 'unknown';
    faceSupported: boolean;
    fingerprintSupported: boolean;
}

interface ExitDevice {
    deviceId: string;
    deviceName: string;
    typeName: string;
    addedAt: string;
}

export default function AutoCheckoutSettingsPage() {
    const [config, setConfig] = useState<AutoCheckoutConfig>({
        enabled: false,
        hour: 23,
        minute: 0,
        defaultMaxStayMinutes: 480,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [triggerResult, setTriggerResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Auto-print state
    const [autoPrint, setAutoPrint] = useState(false);
    const [savingPrint, setSavingPrint] = useState(false);
    const [savedPrint, setSavedPrint] = useState(false);

    // Defaults de auto-checkout por tipo de visitante
    const [typeDefaults, setTypeDefaults] = useState<Record<string, boolean>>({});
    const [savingTypeDefaults, setSavingTypeDefaults] = useState(false);
    const [savedTypeDefaults, setSavedTypeDefaults] = useState(false);
    const [typeDefaultsError, setTypeDefaultsError] = useState<string | null>(null);

    // Catálogo de tipos de visitante (predefinidos + personalizados del tenant)
    const {
        labels: typeLabels,
        keys: typeKeys,
        custom: customTypes,
        createCustomType,
        deleteCustomType,
    } = useVisitorTypeCatalog();
    const [newTypeLabel, setNewTypeLabel] = useState('');
    const [newTypeIcon, setNewTypeIcon] = useState('🏷️');
    const [creatingType, setCreatingType] = useState(false);
    const [deletingTypeKey, setDeletingTypeKey] = useState<string | null>(null);
    const [customTypeError, setCustomTypeError] = useState<string | null>(null);

    // Dispositivos de salida (auto-checkout por evento en tiempo real)
    const [devices, setDevices] = useState<BioStarDevice[]>([]);
    const [exitDevices, setExitDevices] = useState<ExitDevice[]>([]);
    const [devicesLoading, setDevicesLoading] = useState(false);
    const [exitDevicesLoading, setExitDevicesLoading] = useState(false);
    const [devicesError, setDevicesError] = useState<string | null>(null);
    const [addingExitDevice, setAddingExitDevice] = useState<string | null>(null);
    const [removingExitDevice, setRemovingExitDevice] = useState<string | null>(null);
    const [exitDeviceMsg, setExitDeviceMsg] = useState<string | null>(null);
    const [exitDeviceErrorMsg, setExitDeviceErrorMsg] = useState<string | null>(null);

    const [delaySeconds, setDelaySeconds] = useState<number>(0);
    const [delayInput, setDelayInput] = useState<string>('0');
    const [delayLoading, setDelayLoading] = useState(false);
    const [savingDelay, setSavingDelay] = useState(false);
    const [savedDelay, setSavedDelay] = useState(false);

    // Encuesta de salida + aviso de falsa salida
    const [exitSurveyEnabled, setExitSurveyEnabled] = useState(false);
    const [savingExitSurvey, setSavingExitSurvey] = useState(false);
    const [savedExitSurvey, setSavedExitSurvey] = useState(false);

    useEffect(() => {
        api.get('/visitors/settings/auto-checkout')
            .then(res => setConfig(res.data))
            .catch(() => setError('No se pudo cargar la configuración.'))
            .finally(() => setLoading(false));

        api.get<{ enabled: boolean }>('/visitors/settings/auto-print')
            .then(res => setAutoPrint(res.data.enabled))
            .catch(() => {});

        api.get('/visitors/settings/auto-checkout/visitor-types')
            .then(res => setTypeDefaults(res.data && typeof res.data === 'object' ? res.data : {}))
            .catch(() => {});

        api.get<{ enabled: boolean }>('/visitors/settings/exit-survey')
            .then(res => setExitSurveyEnabled(!!res.data?.enabled))
            .catch(() => {});
    }, []);

    const handleToggleExitSurvey = async () => {
        const next = !exitSurveyEnabled;
        setSavingExitSurvey(true);
        setSavedExitSurvey(false);
        try {
            await api.put('/visitors/settings/exit-survey', { enabled: next });
            setExitSurveyEnabled(next);
            setSavedExitSurvey(true);
            setTimeout(() => setSavedExitSurvey(false), 2000);
        } catch {
            setError('No se pudo actualizar la configuración de encuesta de salida.');
        } finally {
            setSavingExitSurvey(false);
        }
    };

    const fetchDevices = useCallback(async () => {
        setDevicesLoading(true);
        setDevicesError(null);
        try {
            const res = await api.get('/devices');
            setDevices(res.data || []);
        } catch (err: any) {
            const msg =
                err.response?.data?.message ||
                'No se pudo conectar con BioStar. Verifique la conexión configurada.';
            setDevicesError(msg);
        } finally {
            setDevicesLoading(false);
        }
    }, []);

    const fetchExitDevices = useCallback(async () => {
        setExitDevicesLoading(true);
        try {
            const res = await api.get('/settings/exit-devices');
            setExitDevices(res.data || []);
        } catch {
            setExitDevices([]);
        } finally {
            setExitDevicesLoading(false);
        }
    }, []);

    const fetchDelay = useCallback(async () => {
        setDelayLoading(true);
        try {
            const res = await api.get('/settings/exit-devices/delay');
            const seconds = res.data?.delaySeconds ?? 0;
            setDelaySeconds(seconds);
            setDelayInput(String(seconds));
        } catch {
            setDelaySeconds(0);
            setDelayInput('0');
        } finally {
            setDelayLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchExitDevices();
        fetchDevices();
        fetchDelay();
    }, [fetchExitDevices, fetchDevices, fetchDelay]);

    const showExitDeviceSuccess = (msg: string) => {
        setExitDeviceMsg(msg);
        setTimeout(() => setExitDeviceMsg(null), 3000);
    };

    const showExitDeviceError = (msg: string) => {
        setExitDeviceErrorMsg(msg);
        setTimeout(() => setExitDeviceErrorMsg(null), 5000);
    };

    const handleAddExitDevice = async (deviceId: string) => {
        setAddingExitDevice(deviceId);
        try {
            const res = await api.post('/settings/exit-devices', { deviceId });
            setExitDevices(res.data || []);
            const deviceName = devices.find((d) => d.id === deviceId)?.name ?? deviceId;
            showExitDeviceSuccess(`"${deviceName}" marcado como dispositivo de salida.`);
        } catch (err: any) {
            showExitDeviceError(err.response?.data?.message || 'No se pudo agregar el dispositivo.');
        } finally {
            setAddingExitDevice(null);
        }
    };

    const handleRemoveExitDevice = async (deviceId: string) => {
        setRemovingExitDevice(deviceId);
        try {
            const res = await api.delete(`/settings/exit-devices/${deviceId}`);
            setExitDevices(res.data || []);
            showExitDeviceSuccess('Dispositivo de salida eliminado.');
        } catch (err: any) {
            showExitDeviceError(err.response?.data?.message || 'No se pudo eliminar el dispositivo.');
        } finally {
            setRemovingExitDevice(null);
        }
    };

    const handleRefreshDevices = async () => {
        try {
            await api.delete('/devices/cache');
        } catch {
            /* noop */
        }
        await fetchDevices();
    };

    const handleSaveDelay = async () => {
        const parsed = Math.round(Number(delayInput));
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3600) {
            showExitDeviceError('Ingrese un valor entre 0 y 3600 segundos.');
            return;
        }
        setSavingDelay(true);
        try {
            const res = await api.put('/settings/exit-devices/delay', { delaySeconds: parsed });
            const seconds = res.data?.delaySeconds ?? parsed;
            setDelaySeconds(seconds);
            setDelayInput(String(seconds));
            setSavedDelay(true);
            setTimeout(() => setSavedDelay(false), 2500);
        } catch (err: any) {
            showExitDeviceError(err.response?.data?.message || 'No se pudo guardar el retraso.');
        } finally {
            setSavingDelay(false);
        }
    };

    const isExitDevice = (deviceId: string) =>
        exitDevices.some((d) => d.deviceId === deviceId);

    const exitDeviceCount = exitDevices.length;
    const exitPlural = exitDeviceCount !== 1 ? 's' : '';

    const handleCreateCustomType = async () => {
        const label = newTypeLabel.trim();
        if (!label) return;
        setCreatingType(true);
        setCustomTypeError(null);
        try {
            await createCustomType({ label, icon: newTypeIcon.trim() || '🏷️' });
            setNewTypeLabel('');
            setNewTypeIcon('🏷️');
        } catch (err: any) {
            setCustomTypeError(err?.response?.data?.message ?? 'Error al crear el tipo de visitante.');
        } finally {
            setCreatingType(false);
        }
    };

    const handleDeleteCustomType = async (key: string) => {
        setDeletingTypeKey(key);
        setCustomTypeError(null);
        try {
            await deleteCustomType(key);
            setTypeDefaults(prev => {
                const { [key]: _removed, ...rest } = prev;
                return rest;
            });
        } catch (err: any) {
            setCustomTypeError(err?.response?.data?.message ?? 'Error al eliminar el tipo de visitante.');
        } finally {
            setDeletingTypeKey(null);
        }
    };

    const handleToggleTypeDefault = async (type: string) => {
        const newVal = !typeDefaults[type];
        const previous = typeDefaults;
        const updated = { ...typeDefaults, [type]: newVal };
        setTypeDefaults(updated);
        setSavingTypeDefaults(true);
        setTypeDefaultsError(null);
        try {
            const res = await api.put('/visitors/settings/auto-checkout/visitor-types', { [type]: newVal });
            setTypeDefaults(res.data && typeof res.data === 'object' ? res.data : updated);
            setSavedTypeDefaults(true);
            setTimeout(() => setSavedTypeDefaults(false), 2500);
        } catch {
            setTypeDefaults(previous);
            setTypeDefaultsError('Error al guardar el default para este tipo de visitante.');
        } finally {
            setSavingTypeDefaults(false);
        }
    };

    const handleSavePrint = async (newVal: boolean) => {
        setAutoPrint(newVal);
        setSavingPrint(true);
        try {
            await api.put('/visitors/settings/auto-print', { enabled: newVal });
            setSavedPrint(true);
            setTimeout(() => setSavedPrint(false), 2500);
        } catch {
            setAutoPrint(!newVal);
        } finally {
            setSavingPrint(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await api.put('/visitors/settings/auto-checkout', config);
            setConfig(res.data);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError('Error al guardar la configuración.');
        } finally {
            setSaving(false);
        }
    };

    const handleTrigger = async () => {
        setTriggering(true);
        setTriggerResult(null);
        setError(null);
        try {
            const res = await api.post('/visitors/settings/auto-checkout/trigger');
            setTriggerResult(`Auto-checkout ejecutado: ${res.data.checkedOutCount} visita(s) cerrada(s).`);
            setTimeout(() => setTriggerResult(null), 5000);
        } catch {
            setError('Error al ejecutar el auto-checkout.');
        } finally {
            setTriggering(false);
        }
    };

    const inputClass = 'w-full px-3 py-2.5 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none transition-colors bg-white';

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
                        <TimerOff className="w-5 h-5 text-suprema-burgundy" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-suprema-gray-900">Autocheckout</h1>
                        <p className="text-sm text-suprema-gray-800/60">
                            Cierre automático nocturno de visitas y defaults por tipo de visitante
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

            {/* ── Config card ── */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">

                    {/* Toggle activado */}
                    <div className="flex items-center justify-between px-6 py-5 border-b border-suprema-gray-100">
                        <div>
                            <p className="text-sm font-bold text-suprema-gray-900">Estado del auto-checkout</p>
                            <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                Cuando está activo, el cron se ejecuta cada minuto y cierra todas las visitas activas a la hora configurada.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 ${config.enabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}
                            aria-label={config.enabled ? 'Desactivar' : 'Activar'}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-6' : ''}`} />
                        </button>
                    </div>

                    {/* Horario */}
                    <div className="px-6 py-5 border-b border-suprema-gray-100">
                        <p className="text-sm font-bold text-suprema-gray-900 mb-1">Horario de ejecución</p>
                        <p className="text-xs text-suprema-gray-800/50 mb-4">
                            El cron verifica cada minuto si la hora actual coincide con la configurada aquí.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-suprema-gray-800/60 mb-1.5">
                                    Hora <span className="font-normal">(0 – 23)</span>
                                </label>
                                <input
                                    type="number" min={0} max={23}
                                    value={config.hour}
                                    onChange={e => setConfig(c => ({ ...c, hour: Math.min(23, Math.max(0, +e.target.value)) }))}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-suprema-gray-800/60 mb-1.5">
                                    Minuto <span className="font-normal">(0 – 59)</span>
                                </label>
                                <input
                                    type="number" min={0} max={59}
                                    value={config.minute}
                                    onChange={e => setConfig(c => ({ ...c, minute: Math.min(59, Math.max(0, +e.target.value)) }))}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                        <p className="text-xs text-suprema-gray-800/40 mt-3">
                            Ejecución programada: <strong className="text-suprema-gray-900">{String(config.hour).padStart(2, '0')}:{String(config.minute).padStart(2, '0')}</strong> cada día
                        </p>
                    </div>

                    {/* Estadía máxima */}
                    <div className="px-6 py-5 border-b border-suprema-gray-100">
                        <p className="text-sm font-bold text-suprema-gray-900 mb-1">Estadía máxima por defecto</p>
                        <p className="text-xs text-suprema-gray-800/50 mb-4">
                            Tiempo en minutos antes de que una visita CHECKED_IN sea marcada como "overtime" en el dashboard. <strong>0</strong> = sin límite.
                        </p>
                        <div className="flex items-center gap-4">
                            <div className="w-48">
                                <input
                                    type="number" min={0} max={1440}
                                    value={config.defaultMaxStayMinutes}
                                    onChange={e => setConfig(c => ({ ...c, defaultMaxStayMinutes: Math.max(0, +e.target.value) }))}
                                    className={inputClass}
                                />
                            </div>
                            <span className="text-sm text-suprema-gray-800/60">minutos</span>
                            {config.defaultMaxStayMinutes > 0 && (
                                <span className="text-xs text-suprema-gray-800/40">
                                    = {Math.floor(config.defaultMaxStayMinutes / 60)}h {config.defaultMaxStayMinutes % 60}m
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Acciones */}
                    <div className="px-6 py-5 bg-suprema-gray-50/50 flex flex-wrap items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2.5 bg-suprema-gray-900 text-white rounded-xl font-bold text-sm hover:bg-black disabled:opacity-40 transition-colors"
                        >
                            {saving
                                ? <Loader2 size={14} className="animate-spin" />
                                : <CheckCircle2 size={14} />
                            }
                            {saved ? '¡Guardado!' : 'Guardar configuración'}
                        </button>

                        <button
                            onClick={handleTrigger}
                            disabled={triggering}
                            className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-xl font-bold text-sm hover:bg-amber-700 disabled:opacity-40 transition-colors"
                        >
                            {triggering
                                ? <Loader2 size={14} className="animate-spin" />
                                : <TimerOff size={14} />
                            }
                            Ejecutar checkout ahora
                        </button>
                    </div>
                </div>
            )}

            {/* ── Dispositivos de salida (auto-checkout por evento en tiempo real) ── */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-suprema-gray-100 bg-suprema-gray-50/50">
                        <div className="w-8 h-8 rounded-lg bg-suprema-burgundy/10 flex items-center justify-center">
                            <DoorOpen className="w-4 h-4 text-suprema-burgundy" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-suprema-gray-900">Dispositivos de salida</p>
                            <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                Selecciona los lectores o torniquetes de BioStar ubicados en la salida. Al autenticarse
                                un visitante con auto-checkout habilitado en ellos, BioVisitor realiza el check-out
                                automático de su visita en tiempo real.
                            </p>
                        </div>
                    </div>

                    {(exitDeviceMsg || exitDeviceErrorMsg) && (
                        <div className="px-6 pt-4">
                            {exitDeviceMsg && (
                                <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium mb-2">
                                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                                    {exitDeviceMsg}
                                </div>
                            )}
                            {exitDeviceErrorMsg && (
                                <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-medium mb-2">
                                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                    {exitDeviceErrorMsg}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Retraso del checkout automático */}
                    <div className="px-6 py-5 border-b border-suprema-gray-100">
                        <p className="text-sm font-bold text-suprema-gray-900 mb-1 flex items-center gap-1.5">
                            <Timer className="w-3.5 h-3.5 text-suprema-burgundy" /> Retraso del checkout automático
                        </p>
                        <p className="text-xs text-suprema-gray-800/50 mb-3">
                            Segundos de espera tras detectar el evento de salida antes de marcar al visitante como checked-out.
                        </p>
                        {delayLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-suprema-gray-800/40" />
                        ) : (
                            <div className="flex flex-wrap items-center gap-3">
                                <input
                                    type="number"
                                    min={0}
                                    max={3600}
                                    value={delayInput}
                                    onChange={(e) => setDelayInput(e.target.value)}
                                    className="w-28 px-3 py-2 border border-suprema-gray-200 rounded-lg text-sm text-suprema-gray-900 focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none transition-colors bg-white"
                                />
                                <span className="text-sm text-suprema-gray-800/60">segundos (0 = inmediato)</span>
                                <button
                                    onClick={handleSaveDelay}
                                    disabled={savingDelay || Number(delayInput) === delaySeconds}
                                    className="flex items-center gap-2 px-4 py-2 bg-suprema-gray-900 text-white rounded-lg font-semibold text-xs hover:bg-black disabled:opacity-40 transition-colors"
                                >
                                    {savingDelay ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <CheckCircle2 size={12} />
                                    )}
                                    {savedDelay ? '¡Guardado!' : 'Guardar'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Encuesta de salida + aviso de falsa salida */}
                    <div className="px-6 py-5 border-b border-suprema-gray-100 flex items-start justify-between gap-4">
                        <div>
                            <p className="text-sm font-bold text-suprema-gray-900 mb-1">Encuesta de salida por correo</p>
                            <p className="text-xs text-suprema-gray-800/50">
                                Al ocurrir un auto-checkout por dispositivo de salida, envía al visitante un correo con
                                una breve encuesta de satisfacción y la opción de reportar &quot;sigo dentro&quot; si el
                                checkout fue erróneo.
                            </p>
                            {savedExitSurvey && (
                                <p className="text-xs text-emerald-600 font-semibold mt-1.5 flex items-center gap-1">
                                    <CheckCircle2 size={12} /> ¡Guardado!
                                </p>
                            )}
                        </div>
                        <button
                            onClick={handleToggleExitSurvey}
                            disabled={savingExitSurvey}
                            className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
                                exitSurveyEnabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'
                            }`}
                        >
                            <span
                                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                    exitSurveyEnabled ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Dispositivos disponibles */}
                    <div className="border-b border-suprema-gray-100">
                        <div className="flex items-center justify-between px-6 py-3.5 bg-suprema-gray-50/30">
                            <p className="text-xs font-bold text-suprema-gray-900 uppercase tracking-wide">Dispositivos disponibles</p>
                            <button
                                onClick={handleRefreshDevices}
                                disabled={devicesLoading}
                                className="p-1.5 text-suprema-gray-800/50 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-lg transition-colors disabled:opacity-50"
                                title="Recargar lista de dispositivos"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${devicesLoading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                        <div className="divide-y divide-suprema-gray-100 max-h-[320px] overflow-y-auto">
                            {devicesLoading ? (
                                <div className="flex items-center justify-center gap-2 py-8 text-suprema-gray-800/50">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span className="text-sm">Cargando dispositivos…</span>
                                </div>
                            ) : devicesError ? (
                                <div className="flex flex-col items-center gap-2 py-8 px-5 text-center">
                                    <AlertCircle className="w-7 h-7 text-amber-400" />
                                    <p className="text-sm text-suprema-gray-800/70 font-medium">Sin conexión a BioStar</p>
                                    <p className="text-xs text-suprema-gray-800/50">{devicesError}</p>
                                    <Link
                                        href="/dashboard/settings/suprema"
                                        className="mt-1 text-xs text-suprema-burgundy hover:underline"
                                    >
                                        Configurar conexión
                                    </Link>
                                </div>
                            ) : devices.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 py-8 text-center">
                                    <Cpu className="w-7 h-7 text-suprema-gray-800/20" />
                                    <p className="text-sm text-suprema-gray-800/50">No hay dispositivos disponibles</p>
                                </div>
                            ) : (
                                devices.map((device) => {
                                    const alreadyAdded = isExitDevice(device.id);
                                    const isAdding = addingExitDevice === device.id;
                                    return (
                                        <div
                                            key={device.id}
                                            className={`flex items-center gap-3 px-6 py-3 ${alreadyAdded ? 'bg-emerald-50/50' : ''}`}
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
                                            </div>
                                            <button
                                                onClick={() => handleAddExitDevice(device.id)}
                                                disabled={alreadyAdded || isAdding}
                                                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                                    alreadyAdded
                                                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
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
                                                {alreadyAdded ? 'Agregado' : 'Marcar como salida'}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Dispositivos de salida configurados */}
                    <div>
                        <div className="flex items-center justify-between px-6 py-3.5 bg-suprema-gray-50/30 border-b border-suprema-gray-100">
                            <p className="text-xs font-bold text-suprema-gray-900 uppercase tracking-wide">
                                Configurados ({exitDeviceCount})
                            </p>
                            {exitDevicesLoading && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-suprema-gray-800/40" />
                            )}
                        </div>
                        <div className="divide-y divide-suprema-gray-100 max-h-[320px] overflow-y-auto">
                            {exitDevices.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 py-8 text-center px-5">
                                    <DoorOpen className="w-7 h-7 text-suprema-gray-800/20" />
                                    <p className="text-sm font-medium text-suprema-gray-800/50">Sin dispositivos de salida</p>
                                    <p className="text-xs text-suprema-gray-800/40">
                                        Agréguelos desde la lista de arriba
                                    </p>
                                </div>
                            ) : (
                                exitDevices.map((device) => {
                                    const isRemoving = removingExitDevice === device.deviceId;
                                    return (
                                        <div key={device.deviceId} className="flex items-center gap-3 px-6 py-3">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border bg-suprema-burgundy/10 text-suprema-burgundy border-suprema-burgundy/20">
                                                <DoorOpen className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-suprema-gray-900 truncate">
                                                    {device.deviceName}
                                                </p>
                                                <p className="text-xs text-suprema-gray-800/50">
                                                    ID {device.deviceId} · {device.typeName} ·{' '}
                                                    {new Date(device.addedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveExitDevice(device.deviceId)}
                                                disabled={isRemoving}
                                                className="flex-shrink-0 p-1.5 text-suprema-gray-800/30 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                title="Eliminar"
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
                        {exitDevices.length > 0 && (
                            <div className="px-6 py-3 border-t border-suprema-gray-100 bg-suprema-gray-50/50">
                                <p className="text-xs text-suprema-gray-800/40">
                                    El check-out se aplica solo a visitas actualmente en estado CHECKED_IN.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Feedback ── */}
            {saved && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-semibold text-emerald-800">
                    <CheckCircle2 size={16} /> Configuración guardada correctamente.
                </div>
            )}
            {triggerResult && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-semibold text-emerald-800">
                    <CheckCircle2 size={16} /> {triggerResult}
                </div>
            )}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-semibold text-red-800">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* ── Auto-print card ── */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-suprema-gray-100 bg-suprema-gray-50/50">
                        <div className="w-8 h-8 rounded-lg bg-suprema-burgundy/10 flex items-center justify-center">
                            <Printer className="w-4 h-4 text-suprema-burgundy" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-suprema-gray-900">Auto-impresión de gafetes</p>
                            <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                Abre automáticamente el diálogo de impresión al hacer check-in
                            </p>
                        </div>
                    </div>

                    {/* Toggle */}
                    <div className="flex items-center justify-between px-6 py-5">
                        <div>
                            <p className="text-sm font-semibold text-suprema-gray-900">Imprimir gafete al registrar check-in</p>
                            <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                Cuando está activo, al confirmar el check-in de un visitante se abre el modal de impresión del gafete físico (62 × 100 mm).
                            </p>
                            {savedPrint && (
                                <p className="text-xs text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                                    <CheckCircle2 size={11} /> Configuración guardada
                                </p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => !savingPrint && handleSavePrint(!autoPrint)}
                            disabled={savingPrint}
                            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 disabled:opacity-50 ${autoPrint ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}
                            aria-label={autoPrint ? 'Desactivar auto-impresión' : 'Activar auto-impresión'}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${autoPrint ? 'translate-x-6' : ''}`} />
                        </button>
                    </div>
                </div>
            )}

            {/* ── Defaults por tipo de visitante ── */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-suprema-gray-100 bg-suprema-gray-50/50">
                        <div className="w-8 h-8 rounded-lg bg-suprema-burgundy/10 flex items-center justify-center">
                            <ListChecks className="w-4 h-4 text-suprema-burgundy" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-suprema-gray-900">Auto-checkout por tipo de visitante</p>
                            <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                Define si el toggle de auto-checkout viene activado por defecto al registrar cada tipo de visitante. El operador aún puede cambiarlo manualmente en cada visita.
                            </p>
                            {savedTypeDefaults && (
                                <p className="text-xs text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                                    <CheckCircle2 size={11} /> Configuración guardada
                                </p>
                            )}
                            {typeDefaultsError && (
                                <p className="text-xs text-red-600 font-semibold mt-1 flex items-center gap-1">
                                    <AlertCircle size={11} /> {typeDefaultsError}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Lista de tipos */}
                    <div className="divide-y divide-suprema-gray-100">
                        {typeKeys.map(type => {
                            const meta = typeLabels[type];
                            const enabled = !!typeDefaults[type];
                            return (
                                <div key={type} className="flex items-center justify-between px-6 py-4">
                                    <div className="flex items-center gap-2.5">
                                        <span className="text-lg leading-none">{meta.icon}</span>
                                        <span className="text-sm font-semibold text-suprema-gray-900">{meta.label}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => !savingTypeDefaults && handleToggleTypeDefault(type)}
                                        disabled={savingTypeDefaults}
                                        className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 disabled:opacity-50 ${enabled ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'}`}
                                        aria-label={enabled ? `Desactivar default para ${meta.label}` : `Activar default para ${meta.label}`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-6' : ''}`} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Tipos de visitante personalizados ── */}
            {!loading && (
                <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-suprema-gray-100 bg-suprema-gray-50/50">
                        <div className="w-8 h-8 rounded-lg bg-suprema-burgundy/10 flex items-center justify-center">
                            <Tag className="w-4 h-4 text-suprema-burgundy" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-suprema-gray-900">Tipos de visitante personalizados</p>
                            <p className="text-xs text-suprema-gray-800/50 mt-0.5">
                                Crea tipos adicionales a los predefinidos (ej. Auditor, Practicante). Quedan disponibles de inmediato al registrar visitantes y en las reglas de auto-checkout de arriba.
                            </p>
                            {customTypeError && (
                                <p className="text-xs text-red-600 font-semibold mt-1 flex items-center gap-1">
                                    <AlertCircle size={11} /> {customTypeError}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Formulario de creación */}
                    <div className="flex items-center gap-2 px-6 py-4 border-b border-suprema-gray-100">
                        <input
                            type="text"
                            value={newTypeIcon}
                            onChange={e => setNewTypeIcon(e.target.value)}
                            maxLength={4}
                            placeholder="🏷️"
                            className="w-14 px-2 py-2.5 border border-suprema-gray-200 rounded-lg text-center text-lg focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none transition-colors bg-white"
                        />
                        <input
                            type="text"
                            value={newTypeLabel}
                            onChange={e => setNewTypeLabel(e.target.value)}
                            maxLength={50}
                            placeholder="Nombre del tipo, ej: Auditor"
                            onKeyDown={e => e.key === 'Enter' && handleCreateCustomType()}
                            className={`flex-1 ${inputClass}`}
                        />
                        <button
                            type="button"
                            onClick={handleCreateCustomType}
                            disabled={creatingType || !newTypeLabel.trim()}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-suprema-burgundy text-white rounded-lg font-bold text-sm hover:bg-suprema-burgundy/90 disabled:opacity-40 transition-colors flex-shrink-0"
                        >
                            {creatingType ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Agregar
                        </button>
                    </div>

                    {/* Lista de tipos personalizados */}
                    {customTypes.length === 0 ? (
                        <p className="px-6 py-5 text-sm text-suprema-gray-800/50">Aún no has creado tipos de visitante personalizados.</p>
                    ) : (
                        <div className="divide-y divide-suprema-gray-100">
                            {customTypes.map(ct => (
                                <div key={ct.key} className="flex items-center justify-between px-6 py-3.5">
                                    <div className="flex items-center gap-2.5">
                                        <span className="text-lg leading-none">{ct.icon}</span>
                                        <span className="text-sm font-semibold text-suprema-gray-900">{ct.label}</span>
                                        <span className="text-[10px] font-mono text-suprema-gray-800/40">{ct.key}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteCustomType(ct.key)}
                                        disabled={deletingTypeKey === ct.key}
                                        className="p-2 rounded-lg text-suprema-gray-800/40 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                                        aria-label={`Eliminar ${ct.label}`}
                                    >
                                        {deletingTypeKey === ct.key ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Info box ── */}
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <p className="text-xs font-semibold text-blue-800 mb-1">¿Cómo funciona el cron?</p>
                <p className="text-xs text-blue-700 leading-relaxed">
                    Un proceso interno verifica cada minuto si la hora del sistema coincide con la hora configurada. Cuando coincide, cierra automáticamente todas las visitas con estado <strong>SCHEDULED</strong>, <strong>PRE_REGISTERED</strong> o <strong>CHECKED_IN</strong> del tenant. Los eventos de checkout se emiten en tiempo real por WebSocket al dashboard.
                </p>
            </div>
        </div>
    );
}
