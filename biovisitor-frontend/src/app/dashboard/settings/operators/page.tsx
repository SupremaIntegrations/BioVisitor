'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ShieldCheck, Plus, Pencil, Trash2, X,
  Loader2, Search, CheckCircle2, AlertCircle, KeyRound,
  UserCheck, UserX, Eye, EyeOff, Shield, Settings2,
  Lock, Globe, Clock, Users, RefreshCw, ChevronDown,
  ChevronUp, Building2,
} from 'lucide-react';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperatorPermissions {
  visitors:   { view: boolean; checkin: boolean; checkout: boolean; preregister: boolean; editVisitor: boolean };
  reports:    { view: boolean };
  accessLogs: { view: boolean };
  auditTrail: { view: boolean };
  settings:   { view: boolean };
}

interface SecurityConfig {
  mfaRequired:           boolean;
  ssoRequired:           boolean;
  passwordComplexity:    boolean;
  passwordExpiryDays:    number | null;
  maxFailedAttempts:     number | null;
  sessionTimeoutMinutes: number | null;
  maxConcurrentSessions: number | null;
  ipAllowlist:           string[];
}

interface Operator {
  id: string;
  fullName: string;
  email: string;
  role: 'ADMIN' | 'OPERATOR';
  department: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  permissions: OperatorPermissions | null;
  allowedSites: string[];
  securityConfig: SecurityConfig | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PERMISSIONS: OperatorPermissions = {
  visitors:   { view: true, checkin: true, checkout: true, preregister: true, editVisitor: false },
  reports:    { view: false },
  accessLogs: { view: true },
  auditTrail: { view: false },
  settings:   { view: false },
};

const DEFAULT_SECURITY: SecurityConfig = {
  mfaRequired:           false,
  ssoRequired:           false,
  passwordComplexity:    false,
  passwordExpiryDays:    null,
  maxFailedAttempts:     null,
  sessionTimeoutMinutes: null,
  maxConcurrentSessions: null,
  ipAllowlist:           [],
};

const inputBase = 'w-full border border-suprema-gray-200 rounded-xl px-3 py-2.5 text-sm text-suprema-gray-900 bg-white outline-none transition';
const inputFocus = 'focus:border-suprema-burgundy focus:ring-2 focus:ring-suprema-burgundy/10';

const Toggle = ({ value, onChange, disabled = false }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button
    type="button"
    onClick={() => !disabled && onChange(!value)}
    className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 ${value ? 'bg-suprema-burgundy' : 'bg-suprema-gray-200'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : ''}`} />
  </button>
);

// ─── Operator Modal ────────────────────────────────────────────────────────────

interface OperatorModalProps {
  operator: Operator | null;
  onClose: () => void;
  onSaved: () => void;
}

function OperatorModal({ operator, onClose, onSaved }: OperatorModalProps) {
  const isEdit = !!operator;
  const [tab, setTab] = useState<'basic' | 'permissions' | 'security'>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [ipInput, setIpInput] = useState('');

  const [form, setForm] = useState({
    fullName: operator?.fullName ?? '',
    email:    operator?.email ?? '',
    role:     operator?.role ?? 'OPERATOR' as 'ADMIN' | 'OPERATOR',
    department: operator?.department ?? '',
    phone:    operator?.phone ?? '',
    notes:    operator?.notes ?? '',
    temporaryPassword: '',
    mustChangePassword: true,
  });

  const [perms, setPerms] = useState<OperatorPermissions>(
    operator?.permissions ?? DEFAULT_PERMISSIONS,
  );

  const [sec, setSec] = useState<SecurityConfig>(
    operator?.securityConfig ?? DEFAULT_SECURITY,
  );

  const setField = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const setSecField = (k: keyof SecurityConfig, v: any) =>
    setSec(p => ({ ...p, [k]: v }));

  const addIp = () => {
    const ip = ipInput.trim();
    if (!ip) return;
    setSec(p => ({ ...p, ipAllowlist: [...p.ipAllowlist.filter(x => x !== ip), ip] }));
    setIpInput('');
  };

  const removeIp = (ip: string) =>
    setSec(p => ({ ...p, ipAllowlist: p.ipAllowlist.filter(x => x !== ip) }));

  const handleSave = async () => {
    setError('');
    if (!form.fullName.trim()) return setError('El nombre completo es obligatorio.');
    if (!form.email.trim())    return setError('El email es obligatorio.');
    if (!isEdit && form.temporaryPassword.length < 8)
      return setError('La contraseña temporal debe tener al menos 8 caracteres.');

    setSaving(true);
    try {
      const payload: any = {
        fullName:    form.fullName.trim(),
        email:       form.email.trim().toLowerCase(),
        role:        form.role,
        department:  form.department.trim() || undefined,
        phone:       form.phone.trim() || undefined,
        notes:       form.notes.trim() || undefined,
        permissions: form.role === 'OPERATOR' ? perms : undefined,
        securityConfig: sec,
        allowedSites: operator?.allowedSites ?? [],
      };
      if (!isEdit) payload.temporaryPassword = form.temporaryPassword;

      if (isEdit) {
        await api.patch(`/operators/${operator!.id}`, payload);
      } else {
        await api.post('/operators', payload);
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Error al guardar el operador.');
    } finally {
      setSaving(false);
    }
  };

  const TABS = [
    { key: 'basic',       label: 'Datos Básicos',     icon: Users },
    { key: 'permissions', label: 'Permisos',           icon: Shield },
    { key: 'security',    label: 'Seguridad Avanzada', icon: Lock },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 bg-suprema-gray-900/70 backdrop-blur-sm flex items-start justify-center p-4 pt-8 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-suprema-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
              <ShieldCheck size={18} className="text-suprema-burgundy" />
            </div>
            <div>
              <h2 className="text-base font-bold text-suprema-gray-900">
                {isEdit ? 'Editar Operador' : 'Nuevo Operador'}
              </h2>
              <p className="text-xs text-suprema-gray-800/50">
                {isEdit ? operator!.email : 'Completa los datos del nuevo operador del sistema'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-suprema-gray-800/40 hover:text-suprema-gray-900 p-1.5 rounded-lg hover:bg-suprema-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-suprema-gray-100 px-6">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-3.5 text-xs font-bold border-b-2 transition-colors -mb-px ${
                tab === t.key
                  ? 'border-suprema-burgundy text-suprema-burgundy'
                  : 'border-transparent text-suprema-gray-800/50 hover:text-suprema-gray-800'
              }`}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">

          {/* ── Tab: Datos Básicos ── */}
          {tab === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Nombre Completo *</label>
                  <input
                    value={form.fullName}
                    onChange={e => setField('fullName', e.target.value)}
                    placeholder="Ej: María García López"
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Email Corporativo *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setField('email', e.target.value)}
                    placeholder="Ej: mgarcia@empresa.com"
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Rol *</label>
                  <select
                    value={form.role}
                    onChange={e => setField('role', e.target.value)}
                    className={`${inputBase} ${inputFocus} appearance-none`}
                  >
                    <option value="OPERATOR">Operador</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Departamento</label>
                  <input
                    value={form.department}
                    onChange={e => setField('department', e.target.value)}
                    placeholder="Ej: Recepción"
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Teléfono</label>
                  <input
                    value={form.phone}
                    onChange={e => setField('phone', e.target.value)}
                    placeholder="Ej: +57 300 000 0000"
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
                {!isEdit && (
                  <div>
                    <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Contraseña Temporal *</label>
                    <div className="relative">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={form.temporaryPassword}
                        onChange={e => setField('temporaryPassword', e.target.value)}
                        placeholder="Mín. 8 caracteres"
                        className={`${inputBase} ${inputFocus} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-800/40"
                      >
                        {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <p className="text-xs text-suprema-gray-800/40 mt-1">El operador deberá cambiarla en el primer inicio de sesión.</p>
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Notas internas</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setField('notes', e.target.value)}
                    placeholder="Observaciones del administrador sobre este operador..."
                    rows={2}
                    className={`${inputBase} ${inputFocus} resize-none`}
                  />
                </div>
              </div>

              {form.role === 'ADMIN' && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertCircle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    Los usuarios <strong>ADMIN</strong> tienen acceso total al sistema. Los permisos granulares no aplican para este rol.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Permisos ── */}
          {tab === 'permissions' && (
            <div className="space-y-4">
              {form.role === 'ADMIN' ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <ShieldCheck size={40} className="text-suprema-burgundy opacity-40" />
                  <p className="text-sm font-semibold text-suprema-gray-800/60">Los administradores tienen acceso total</p>
                  <p className="text-xs text-suprema-gray-800/40">Los permisos granulares solo aplican a usuarios con rol <strong>OPERATOR</strong>.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-suprema-gray-800/50">Define exactamente qué puede ver y hacer este operador en cada módulo del sistema.</p>

                  {/* Visitantes */}
                  <div className="border border-suprema-gray-100 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-bold text-suprema-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Users size={13} className="text-suprema-burgundy" /> Gestión de Visitantes
                    </p>
                    {[
                      { key: 'view',        label: 'Ver lista de visitantes' },
                      { key: 'checkin',     label: 'Realizar check-in' },
                      { key: 'checkout',    label: 'Realizar check-out' },
                      { key: 'preregister', label: 'Pre-registrar visitantes' },
                      { key: 'editVisitor', label: 'Editar datos del visitante' },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-sm text-suprema-gray-800">{label}</span>
                        <Toggle
                          value={(perms.visitors as any)[key]}
                          onChange={v => setPerms(p => ({ ...p, visitors: { ...p.visitors, [key]: v } }))}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Otros módulos */}
                  {[
                    { module: 'reports',    label: 'Reportes y Estadísticas',   icon: '📊' },
                    { module: 'accessLogs', label: 'Logs de Acceso BioStar',    icon: '🔐' },
                    { module: 'auditTrail', label: 'Pista de Auditoría',        icon: '📋' },
                    { module: 'settings',   label: 'Configuración del Sistema', icon: '⚙️' },
                  ].map(({ module, label, icon }) => (
                    <div key={module} className="border border-suprema-gray-100 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-suprema-gray-800">{icon} {label}</p>
                        <Toggle
                          value={(perms as any)[module].view}
                          onChange={v => setPerms(p => ({ ...p, [module]: { view: v } }))}
                        />
                      </div>
                      <p className="text-xs text-suprema-gray-800/40 mt-1">
                        {(perms as any)[module].view ? 'Acceso habilitado' : 'Sin acceso'}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Tab: Seguridad Avanzada ── */}
          {tab === 'security' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200">
                <Lock size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                  Todas las opciones están <strong>deshabilitadas por defecto</strong>. Actívalas solo si necesitas mayor control sobre este operador.
                </p>
              </div>

              {/* Autenticación Fuerte */}
              <div className="border border-suprema-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-suprema-gray-700 uppercase tracking-wider">Autenticación Fuerte</p>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-suprema-gray-800">Requerir MFA</p>
                    <p className="text-xs text-suprema-gray-800/40">El operador deberá configurar y usar autenticación multifactor.</p>
                  </div>
                  <Toggle value={sec.mfaRequired} onChange={v => setSecField('mfaRequired', v)} />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-suprema-gray-800">Forzar SSO (SAML 2.0 / OAuth2)</p>
                    <p className="text-xs text-suprema-gray-800/40">Solo puede iniciar sesión a través del proveedor de identidad corporativo.</p>
                  </div>
                  <Toggle value={sec.ssoRequired} onChange={v => setSecField('ssoRequired', v)} />
                </div>
              </div>

              {/* Políticas de Contraseña */}
              <div className="border border-suprema-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-suprema-gray-700 uppercase tracking-wider">Políticas de Contraseña</p>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-suprema-gray-800">Complejidad Alta</p>
                    <p className="text-xs text-suprema-gray-800/40">Mayúsculas, números y caracteres especiales obligatorios.</p>
                  </div>
                  <Toggle value={sec.passwordComplexity} onChange={v => setSecField('passwordComplexity', v)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Expiración de contraseña (días)</label>
                  <input
                    type="number"
                    min={1} max={365}
                    value={sec.passwordExpiryDays ?? ''}
                    placeholder="Sin expiración"
                    onChange={e => setSecField('passwordExpiryDays', e.target.value ? parseInt(e.target.value) : null)}
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Intentos fallidos antes del bloqueo</label>
                  <input
                    type="number"
                    min={3} max={20}
                    value={sec.maxFailedAttempts ?? ''}
                    placeholder="Sin límite personalizado"
                    onChange={e => setSecField('maxFailedAttempts', e.target.value ? parseInt(e.target.value) : null)}
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
              </div>

              {/* Gestión de Sesión */}
              <div className="border border-suprema-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-suprema-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock size={13} /> Gestión de Sesión
                </p>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Timeout de inactividad (minutos)</label>
                  <input
                    type="number"
                    min={5} max={480}
                    value={sec.sessionTimeoutMinutes ?? ''}
                    placeholder="Sin timeout personalizado"
                    onChange={e => setSecField('sessionTimeoutMinutes', e.target.value ? parseInt(e.target.value) : null)}
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Sesiones concurrentes máximas</label>
                  <input
                    type="number"
                    min={1} max={10}
                    value={sec.maxConcurrentSessions ?? ''}
                    placeholder="Sin límite"
                    onChange={e => setSecField('maxConcurrentSessions', e.target.value ? parseInt(e.target.value) : null)}
                    className={`${inputBase} ${inputFocus}`}
                  />
                </div>
              </div>

              {/* Restricciones de Red */}
              <div className="border border-suprema-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-suprema-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe size={13} /> Restricciones de Red (IP Allowlist)
                </p>
                <p className="text-xs text-suprema-gray-800/40">Solo se permitirá el inicio de sesión desde estas IPs (corporativas o VPN). Vacío = sin restricción.</p>
                <div className="flex gap-2">
                  <input
                    value={ipInput}
                    onChange={e => setIpInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addIp())}
                    placeholder="Ej: 192.168.1.0/24"
                    className={`${inputBase} ${inputFocus} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={addIp}
                    className="px-3 py-2 bg-suprema-gray-100 text-suprema-gray-700 rounded-xl text-sm font-semibold hover:bg-suprema-gray-200 transition-colors"
                  >
                    Agregar
                  </button>
                </div>
                {sec.ipAllowlist.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sec.ipAllowlist.map(ip => (
                      <span key={ip} className="flex items-center gap-1 text-xs font-mono bg-suprema-gray-100 px-2 py-1 rounded-lg">
                        {ip}
                        <button type="button" onClick={() => removeIp(ip)} className="text-red-400 hover:text-red-600 ml-0.5">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {error && (
          <div className="mx-6 mb-2 flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-200">
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-suprema-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-suprema-burgundy text-white rounded-xl hover:bg-suprema-burgundy-dark transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {isEdit ? 'Guardar Cambios' : 'Crear Operador'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ──────────────────────────────────────────────────────

function ResetPasswordModal({ operator, onClose, onSaved }: { operator: Operator; onClose: () => void; onSaved: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [mustChange, setMustChange]   = useState(true);
  const [showPwd, setShowPwd]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const handleSave = async () => {
    if (newPassword.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    setSaving(true);
    try {
      await api.patch(`/operators/${operator.id}/reset-password`, {
        newPassword,
        mustChangePassword: mustChange,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Error al resetear la contraseña.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-suprema-gray-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-suprema-gray-100">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-suprema-burgundy" />
            <h2 className="text-base font-bold text-suprema-gray-900">Resetear Contraseña</h2>
          </div>
          <button onClick={onClose} className="text-suprema-gray-800/40 hover:text-suprema-gray-900 p-1 rounded-lg hover:bg-suprema-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-suprema-gray-800/60">
            Establecer nueva contraseña para <strong>{operator.fullName}</strong> ({operator.email})
          </p>
          <div>
            <label className="block text-xs font-semibold text-suprema-gray-700 mb-1">Nueva Contraseña *</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mín. 8 caracteres"
                className={`${inputBase} ${inputFocus} pr-10`}
              />
              <button type="button" onClick={() => setShowPwd(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-800/40">
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-suprema-gray-800">Forzar cambio en próximo login</p>
              <p className="text-xs text-suprema-gray-800/40">El operador deberá cambiarla al iniciar sesión.</p>
            </div>
            <Toggle value={mustChange} onChange={setMustChange} />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-200">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-suprema-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-suprema-burgundy text-white rounded-xl hover:bg-suprema-burgundy-dark transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Establecer Contraseña
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ──────────────────────────────────────────────────────

function DeleteModal({ operator, onClose, onDeleted }: { operator: Operator; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleDelete = async () => {
    setLoading(true);
    try {
      await api.delete(`/operators/${operator.id}`);
      onDeleted();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Error al eliminar el operador.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-suprema-gray-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-suprema-gray-900">Eliminar Operador</h2>
            <p className="text-xs text-suprema-gray-800/50">Esta acción es permanente</p>
          </div>
        </div>
        <p className="text-sm text-suprema-gray-800/70">
          ¿Seguro que deseas eliminar a <strong>{operator.fullName}</strong>? Su cuenta quedará eliminada y no podrá iniciar sesión.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm font-semibold text-suprema-gray-700 border border-suprema-gray-200 rounded-xl hover:bg-suprema-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function OperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [toast, setToast]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [currentUserRole, setCurrentUserRole] = useState<string>('OPERATOR');
  const [currentUserId, setCurrentUserId]     = useState<string>('');

  const [modalOp, setModalOp]       = useState<Operator | null | 'new'>(null);
  const [resetOp, setResetOp]       = useState<Operator | null>(null);
  const [deleteOp, setDeleteOp]     = useState<Operator | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
      setCurrentUserRole(stored.role || 'OPERATOR');
      setCurrentUserId(stored.id || '');
    } catch { /* ignore */ }
  }, []);

  const isAdmin = currentUserRole === 'ADMIN';

  const fetchOperators = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/operators');
      setOperators(res.data);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        setError('Solo los administradores pueden acceder a esta sección.');
      } else {
        setError(e?.response?.data?.message || 'Error al cargar los operadores.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) fetchOperators(); else setLoading(false); }, [isAdmin, fetchOperators]);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleToggleActive = async (op: Operator) => {
    setTogglingId(op.id);
    try {
      await api.patch(`/operators/${op.id}/toggle-active`);
      await fetchOperators();
      showToast('success', `Cuenta ${op.isActive ? 'desactivada' : 'activada'} correctamente.`);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || 'Error al cambiar estado.');
    } finally {
      setTogglingId(null);
    }
  };

  // El "super admin" es el ADMIN con el createdAt más temprano (creado por el wizard de instalación)
  const primaryAdminId = operators
    .filter(op => op.role === 'ADMIN')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0]?.id ?? '';

  const isProtected = (op: Operator) =>
    op.id === primaryAdminId || op.id === currentUserId;

  const filtered = operators.filter(op =>
    `${op.fullName} ${op.email} ${op.role} ${op.department ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  const roleBadge = (role: string) => role === 'ADMIN'
    ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-suprema-burgundy/10 text-suprema-burgundy"><ShieldCheck size={9} /> Admin</span>
    : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"><UserCheck size={9} /> Operador</span>;

  const statusBadge = (op: Operator) => op.isActive
    ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 size={9} /> Activo</span>
    : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600"><X size={9} /> Inactivo</span>;

  const formatDate = (d: string | null) => d
    ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  // ── Guard: Solo ADMIN ──
  if (!isAdmin && !loading) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
          <Lock size={28} className="text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-suprema-gray-900 mb-2">Acceso Restringido</h1>
        <p className="text-sm text-suprema-gray-800/60 mb-6">Solo los administradores pueden gestionar operadores del sistema.</p>
        <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-sm font-semibold text-suprema-burgundy hover:underline">
          <ArrowLeft size={14} /> Volver a Configuración
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold transition-all ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="p-2 rounded-xl hover:bg-suprema-gray-100 text-suprema-gray-800/60 hover:text-suprema-gray-900 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-suprema-gray-900 flex items-center gap-2">
              <ShieldCheck size={22} className="text-suprema-burgundy" />
              Operadores del Sistema
            </h1>
            <p className="text-sm text-suprema-gray-800/60">Gestiona quién puede operar BioVisitor X y con qué nivel de acceso</p>
          </div>
        </div>
        <button
          onClick={() => setModalOp('new')}
          className="flex items-center gap-2 px-4 py-2.5 bg-suprema-burgundy text-white text-sm font-bold rounded-xl hover:bg-suprema-burgundy-dark transition-colors shadow-sm shadow-suprema-burgundy/20"
        >
          <Plus size={16} /> Nuevo Operador
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-suprema-gray-800/30" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email, rol o departamento..."
          className={`${inputBase} ${inputFocus} pl-10`}
        />
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-suprema-burgundy" />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertCircle size={36} className="text-red-400" />
          <p className="text-sm font-semibold text-suprema-gray-800/70">{error}</p>
          <button onClick={fetchOperators} className="text-sm text-suprema-burgundy font-semibold hover:underline flex items-center gap-1">
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Users size={40} className="text-suprema-gray-800/20" />
          <p className="text-sm font-semibold text-suprema-gray-800/60">
            {search ? 'No hay operadores que coincidan con la búsqueda' : 'No hay operadores registrados aún'}
          </p>
          {!search && (
            <button onClick={() => setModalOp('new')} className="text-sm text-suprema-burgundy font-semibold hover:underline flex items-center gap-1">
              <Plus size={13} /> Crear el primer operador
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="bg-white rounded-2xl border border-suprema-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-suprema-gray-50/80 border-b border-suprema-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">Operador</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden md:table-cell">Rol</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden lg:table-cell">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden xl:table-cell">Último acceso</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden xl:table-cell">Seguridad</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-suprema-gray-50">
              {filtered.map(op => (
                <tr key={op.id} className="hover:bg-suprema-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-inner flex-shrink-0 ${op.role === 'ADMIN' ? 'bg-gradient-to-tr from-suprema-burgundy to-suprema-burgundy-dark' : 'bg-gradient-to-tr from-blue-600 to-blue-700'}`}>
                        {op.fullName.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-suprema-gray-900 truncate">{op.fullName}</p>
                        <p className="text-xs text-suprema-gray-800/50 truncate">{op.email}</p>
                        {op.department && <p className="text-xs text-suprema-gray-800/40">{op.department}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">{roleBadge(op.role)}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-col gap-1">
                      {statusBadge(op)}
                      {op.mustChangePassword && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          <KeyRound size={9} /> Debe cambiar pwd
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <span className="text-xs text-suprema-gray-800/50">{formatDate(op.lastLoginAt)}</span>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex flex-col gap-0.5">
                      {op.securityConfig?.mfaRequired && (
                        <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">MFA</span>
                      )}
                      {op.securityConfig?.ipAllowlist && op.securityConfig.ipAllowlist.length > 0 && (
                        <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">IP Allowlist</span>
                      )}
                      {op.securityConfig?.passwordComplexity && (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Pwd Compleja</span>
                      )}
                      {!op.securityConfig?.mfaRequired && !op.securityConfig?.ipAllowlist?.length && !op.securityConfig?.passwordComplexity && (
                        <span className="text-xs text-suprema-gray-800/30">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Edit — always visible */}
                      <button
                        onClick={() => setModalOp(op)}
                        className="p-1.5 rounded-lg text-suprema-gray-800/40 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      {/* Resetear contraseña: visible siempre, EXCEPTO operadores no-admin viendo su propia fila */}
                      {(!isProtected(op) || op.id === primaryAdminId || currentUserRole === 'ADMIN') && (
                        <button
                          onClick={() => setResetOp(op)}
                          className="p-1.5 rounded-lg text-suprema-gray-800/40 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 transition-colors"
                          title="Resetear contraseña"
                        >
                          <KeyRound size={14} />
                        </button>
                      )}
                      {/* Desactivar y Eliminar: NUNCA visibles para el super admin primario ni para uno mismo */}
                      {!isProtected(op) && (
                        <>
                          {/* Toggle active */}
                          <button
                            onClick={() => handleToggleActive(op)}
                            disabled={togglingId === op.id}
                            className={`p-1.5 rounded-lg transition-colors ${op.isActive ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                            title={op.isActive ? 'Desactivar' : 'Activar'}
                          >
                            {togglingId === op.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : op.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => setDeleteOp(op)}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-suprema-gray-50 text-xs text-suprema-gray-800/40">
            {filtered.length} operador{filtered.length !== 1 ? 'es' : ''} {search ? `encontrado${filtered.length !== 1 ? 's' : ''}` : 'en total'}
          </div>
        </div>
      )}

      {/* Modals */}
      {(modalOp === 'new' || (modalOp && typeof modalOp === 'object')) && (
        <OperatorModal
          operator={modalOp === 'new' ? null : modalOp as Operator}
          onClose={() => setModalOp(null)}
          onSaved={() => { setModalOp(null); fetchOperators(); showToast('success', `Operador ${modalOp === 'new' ? 'creado' : 'actualizado'} correctamente.`); }}
        />
      )}
      {resetOp && (
        <ResetPasswordModal
          operator={resetOp}
          onClose={() => setResetOp(null)}
          onSaved={() => { setResetOp(null); showToast('success', 'Contraseña establecida correctamente.'); }}
        />
      )}
      {deleteOp && (
        <DeleteModal
          operator={deleteOp}
          onClose={() => setDeleteOp(null)}
          onDeleted={() => { setDeleteOp(null); fetchOperators(); showToast('success', 'Operador eliminado.'); }}
        />
      )}
    </div>
  );
}
