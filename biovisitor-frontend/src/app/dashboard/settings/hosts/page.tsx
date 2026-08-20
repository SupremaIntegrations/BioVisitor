'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Loader2,
  Search,
  Download,
  Mail,
  Send,
  CalendarIcon,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  UserPlus,
  UserX,
  ShieldCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/I18nContext';

interface Host {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  jobTitle: string | null;
  source: string;
  isActive: boolean;
  supremaUserId: string | null;
  syncStatus: string | null;
  lastSyncAt: string | null;
  userId: string | null;
  createdAt: string;
}

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  LOCAL:     { label: 'Local',      color: 'bg-gray-100 text-gray-600' },
  BIOSTAR2:  { label: 'BioStar 2',  color: 'bg-blue-100 text-blue-700' },
  BIOSTAR_X: { label: 'BioStar X',  color: 'bg-indigo-100 text-indigo-700' },
};

const emptyForm = { fullName: '', email: '', phone: '', department: '', jobTitle: '' };

// ─── Invite Modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  hosts: Host[];
  onClose: () => void;
}

function InviteModal({ hosts, onClose }: InviteModalProps) {
  const { t } = useI18n();
  const [emails, setEmails] = useState<string[]>(['']);
  const [hostId, setHostId] = useState<string>('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [expectedEndAt, setExpectedEndAt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ invited: number; skipped: number } | null>(null);
  const [error, setError] = useState('');

  const addEmail = () => setEmails((p) => [...p, '']);
  const removeEmail = (i: number) => setEmails((p) => p.filter((_, idx) => idx !== i));
  const updateEmail = (i: number, val: string) => {
    setEmails((p) => { const n = [...p]; n[i] = val; return n; });
  };

  const validEmails = emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()));

  const handleSend = async () => {
    if (!scheduledAt) { setError('Selecciona la fecha y hora de la visita.'); return; }
    if (validEmails.length === 0) { setError('Agrega al menos un correo válido.'); return; }
    setError('');
    setSending(true);
    try {
      const res = await api.post('/visitors/invite', {
        emails: validEmails,
        scheduledAt: new Date(scheduledAt).toISOString(),
        expectedEndAt: expectedEndAt ? new Date(expectedEndAt).toISOString() : undefined,
        hostId: hostId || undefined,
        purpose: purpose.trim() || undefined,
      });
      setResult({ invited: res.data.invited, skipped: res.data.skipped });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al enviar las invitaciones.');
    } finally {
      setSending(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/60 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-suprema-gray-900 mb-2">¡Invitaciones enviadas!</h3>
          <p className="text-sm text-suprema-gray-500 mb-1">
            <span className="font-bold text-emerald-600">{result.invited}</span> invitación{result.invited !== 1 ? 'es' : ''} enviada{result.invited !== 1 ? 's' : ''} correctamente.
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-amber-600">{result.skipped} no pudieron enviarse.</p>
          )}
          <p className="text-xs text-suprema-gray-400 mt-3">
            Los visitantes recibirán un enlace para completar su registro antes de la visita.
          </p>
          <button
            onClick={onClose}
            className="mt-6 w-full py-2.5 px-6 bg-suprema-burgundy text-white font-bold text-sm rounded-xl hover:bg-suprema-burgundy-dark transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-suprema-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
              <Mail size={18} className="text-suprema-burgundy" />
            </div>
            <div>
              <h3 className="font-bold text-suprema-gray-900">Invitar Visitantes</h3>
              <p className="text-xs text-suprema-gray-500">El visitante recibirá un enlace para completar su registro</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-400">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Emails */}
          <div>
            <label className="block text-xs font-bold text-suprema-gray-700 mb-2">
              Correos electrónicos <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {emails.map((email, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => updateEmail(i, e.target.value)}
                      placeholder="visitante@empresa.com"
                      className="w-full pl-9 pr-3 py-2.5 text-sm border border-suprema-gray-200 rounded-xl focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
                    />
                  </div>
                  {emails.length > 1 && (
                    <button
                      onClick={() => removeEmail(i)}
                      className="p-2 rounded-lg hover:bg-red-50 text-suprema-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {emails.length < 20 && (
              <button
                onClick={addEmail}
                className="mt-2 text-xs text-suprema-burgundy font-semibold flex items-center gap-1 hover:underline"
              >
                <Plus size={13} /> Agregar otro correo
              </button>
            )}
          </div>

          {/* Host selector */}
          <div>
            <label className="block text-xs font-bold text-suprema-gray-700 mb-2">Anfitrión</label>
            <select
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-suprema-gray-200 rounded-xl focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
            >
              <option value="">— Sin anfitrión específico —</option>
              {hosts.filter(h => h.isActive).map(h => (
                <option key={h.id} value={h.id}>{h.fullName}{h.department ? ` (${h.department})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Date / time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-suprema-gray-700 mb-2">
                <CalendarIcon size={11} className="inline mr-1" />
                Inicio de visita <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-suprema-gray-200 rounded-xl focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-suprema-gray-700 mb-2">
                <CalendarIcon size={11} className="inline mr-1" />
                Fin de visita (opcional)
              </label>
              <input
                type="datetime-local"
                value={expectedEndAt}
                onChange={(e) => setExpectedEndAt(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-suprema-gray-200 rounded-xl focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
              />
            </div>
          </div>

          {/* Purpose */}
          <div>
            <label className="block text-xs font-bold text-suprema-gray-700 mb-2">Motivo de la visita (opcional)</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Ej: Reunión comercial, Entrevista, Visita técnica…"
              className="w-full px-3 py-2.5 text-sm border border-suprema-gray-200 rounded-xl focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-suprema-gray-100 bg-suprema-gray-50">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-5 py-2.5 text-sm font-semibold text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending || validEmails.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-5 bg-suprema-burgundy text-white font-bold text-sm rounded-xl hover:bg-suprema-burgundy-dark disabled:opacity-50 transition-colors shadow-md shadow-suprema-burgundy/20"
          >
            {sending ? (
              <><Loader2 size={14} className="animate-spin" /> Enviando…</>
            ) : (
              <><Send size={14} /> Enviar {validEmails.length > 0 ? `${validEmails.length} invitación${validEmails.length !== 1 ? 'es' : ''}` : 'invitaciones'}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Account Management Modal ─────────────────────────────────────────────────

type AccountModalMode = 'create' | 'manage';

interface AccountModalProps {
  host: Host;
  mode: AccountModalMode;
  onClose: () => void;
  onSuccess: () => void;
}

function AccountModal({ host, mode, onClose, onSuccess }: AccountModalProps) {
  const [tab, setTab] = useState<'reset' | 'revoke'>('reset');
  const [email, setEmail] = useState(host.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleCreate = async () => {
    if (!email.trim()) { setError('El correo es requerido.'); return; }
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (password !== confirmPwd) { setError('Las contraseñas no coinciden.'); return; }
    setSaving(true); setError('');
    try {
      await api.post(`/hosts/${host.id}/create-user`, { email: email.trim(), password });
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al crear la cuenta.');
    } finally { setSaving(false); }
  };

  const handleResetPassword = async () => {
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (password !== confirmPwd) { setError('Las contraseñas no coinciden.'); return; }
    setSaving(true); setError('');
    try {
      await api.post(`/hosts/${host.id}/reset-password`, { newPassword: password });
      setDone(true);
      setTimeout(() => { onClose(); }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al restablecer la contraseña.');
    } finally { setSaving(false); }
  };

  const handleRevoke = async () => {
    if (!confirm(`¿Revocar el acceso de ${host.fullName} al sistema? Podrás crear una nueva cuenta más adelante.`)) return;
    setSaving(true); setError('');
    try {
      await api.delete(`/hosts/${host.id}/user-account`);
      onSuccess(); onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al revocar la cuenta.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-suprema-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${mode === 'create' ? 'bg-emerald-100' : 'bg-blue-100'}`}>
              {mode === 'create' ? <UserPlus size={18} className="text-emerald-700" /> : <KeyRound size={18} className="text-blue-700" />}
            </div>
            <div>
              <h3 className="font-bold text-suprema-gray-900">
                {mode === 'create' ? 'Crear cuenta de acceso' : 'Gestionar cuenta de acceso'}
              </h3>
              <p className="text-xs text-suprema-gray-500">{host.fullName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-400"><X size={18} /></button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
            <p className="font-bold text-suprema-gray-900">¡Listo!</p>
          </div>
        ) : mode === 'create' ? (
          /* Create mode */
          <div className="p-5 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
              <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
              El anfitrión podrá iniciar sesión y ver únicamente sus propias visitas agendadas.
            </div>
            <div>
              <label className="block text-xs font-bold text-suprema-gray-700 mb-1.5">Correo de acceso <span className="text-red-500">*</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="anfitrion@empresa.com"
                className="w-full px-3 py-2.5 border border-suprema-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-bold text-suprema-gray-700 mb-1.5">Contraseña temporal <span className="text-red-500">*</span></label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full px-3 py-2.5 pr-10 border border-suprema-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900" />
                <button type="button" onClick={() => setShowPwd(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-400 hover:text-suprema-gray-700">
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-suprema-gray-700 mb-1.5">Confirmar contraseña <span className="text-red-500">*</span></label>
              <input type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                placeholder="Repetir contraseña"
                className="w-full px-3 py-2.5 border border-suprema-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900" />
            </div>
            {error && <p className="text-xs text-red-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} />{error}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2.5 text-sm text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl transition-colors">Cancelar</button>
              <button onClick={handleCreate} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Crear cuenta
              </button>
            </div>
          </div>
        ) : (
          /* Manage mode */
          <div className="p-5">
            <div className="flex border border-suprema-gray-200 rounded-xl overflow-hidden mb-4">
              <button onClick={() => setTab('reset')}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${tab === 'reset' ? 'bg-suprema-gray-900 text-white' : 'text-suprema-gray-600 hover:bg-suprema-gray-50'}`}>
                Cambiar contraseña
              </button>
              <button onClick={() => setTab('revoke')}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${tab === 'revoke' ? 'bg-red-600 text-white' : 'text-suprema-gray-600 hover:bg-suprema-gray-50'}`}>
                Revocar acceso
              </button>
            </div>
            {tab === 'reset' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-suprema-gray-700 mb-1.5">Nueva contraseña</label>
                  <div className="relative">
                    <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="w-full px-3 py-2.5 pr-10 border border-suprema-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900" />
                    <button type="button" onClick={() => setShowPwd(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-400 hover:text-suprema-gray-700">
                      {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-suprema-gray-700 mb-1.5">Confirmar contraseña</label>
                  <input type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                    placeholder="Repetir contraseña"
                    className="w-full px-3 py-2.5 border border-suprema-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900" />
                </div>
                {error && <p className="text-xs text-red-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} />{error}</p>}
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2.5 text-sm text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl">Cancelar</button>
                  <button onClick={handleResetPassword} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-suprema-gray-900 text-white font-bold text-sm rounded-xl hover:bg-black disabled:opacity-50 transition-colors">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    Restablecer contraseña
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 flex gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  Al revocar el acceso, el anfitrión no podrá iniciar sesión. Puedes crear una nueva cuenta más adelante.
                </div>
                {error && <p className="text-xs text-red-600 font-semibold flex items-center gap-1"><AlertTriangle size={13} />{error}</p>}
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2.5 text-sm text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl">Cancelar</button>
                  <button onClick={handleRevoke} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-red-600 text-white font-bold text-sm rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
                    Revocar acceso
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HostsPage() {
  const { t } = useI18n();

  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; updated: number; errors: number } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [showInvite, setShowInvite] = useState(false);

  const [accountModal, setAccountModal] = useState<{ host: Host; mode: AccountModalMode } | null>(null);

  const loadHosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hosts');
      setHosts(res.data);
    } catch {
      setHosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHosts(); }, [loadHosts]);

  const handleSyncFromSuprema = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post('/hosts/sync-from-suprema', {});
      setSyncResult(res.data);
      await loadHosts();
    } catch {
      setSyncResult({ imported: 0, updated: 0, errors: 1 });
    } finally {
      setSyncing(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (h: Host) => {
    setEditingId(h.id);
    setForm({ fullName: h.fullName, email: h.email ?? '', phone: h.phone ?? '', department: h.department ?? '', jobTitle: h.jobTitle ?? '' });
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) { setFormError(t('hosts.nameRequired')); return; }
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        fullName: form.fullName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        department: form.department.trim() || undefined,
        jobTitle: form.jobTitle.trim() || undefined,
      };
      if (editingId) {
        await api.patch(`/hosts/${editingId}`, payload);
      } else {
        await api.post('/hosts', payload);
      }
      setShowForm(false);
      await loadHosts();
    } catch (err: any) {
      setFormError(err.response?.data?.message || t('hosts.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (h: Host) => {
    if (!confirm(t('hosts.deactivateConfirm', { name: h.fullName }))) return;
    try {
      await api.delete(`/hosts/${h.id}`);
      await loadHosts();
    } catch {
      alert(t('hosts.deactivateError'));
    }
  };

  const filtered = hosts.filter(h =>
    h.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (h.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (h.department ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/dashboard/settings" className="p-2 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-800/50 hover:text-suprema-gray-900 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Users className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-suprema-gray-900">{t('hosts.title')}</h1>
            <p className="text-sm text-suprema-gray-800/60">
              {t('hosts.activeCount', { count: String(hosts.filter(h => h.isActive).length) })}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-suprema-burgundy to-[#8a1530] text-white font-semibold text-sm rounded-xl hover:shadow-md hover:shadow-suprema-burgundy/30 transition-all"
          >
            <Mail size={15} /> Invitar Visitantes
          </button>
          <button
            onClick={handleSyncFromSuprema}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-semibold text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            title={t('hosts.importTooltip')}
          >
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {t('hosts.syncFromBiostar')}
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-suprema-gray-800 text-white font-semibold text-sm rounded-xl hover:bg-suprema-gray-900 transition-colors"
          >
            <Plus size={15} /> {t('hosts.newHost')}
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm flex items-center justify-between ${
          syncResult.errors > 0 ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
        }`}>
          <span>
            {t('hosts.syncCompleted', { imported: String(syncResult.imported), updated: String(syncResult.updated) })}
            {syncResult.errors > 0 && t('hosts.syncErrors', { errors: String(syncResult.errors) })}
          </span>
          <button onClick={() => setSyncResult(null)} className="opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Host form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-suprema-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-suprema-gray-100">
              <h3 className="font-bold text-suprema-gray-900">
                {editingId ? t('hosts.editHost') : t('hosts.newHostTitle')}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-400">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-suprema-gray-700 mb-1">{t('hosts.fullName')}</label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-suprema-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
                  placeholder="Ej: María González"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-suprema-gray-700 mb-1">{t('hosts.email')}</label>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-suprema-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
                    placeholder="email@empresa.com" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-suprema-gray-700 mb-1">{t('hosts.phone')}</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-suprema-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
                    placeholder="+1 555 000 0000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-suprema-gray-700 mb-1">{t('hosts.department')}</label>
                  <input type="text" value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-suprema-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
                    placeholder="TI, Ventas, RR.HH." />
                </div>
                <div>
                  <label className="block text-xs font-bold text-suprema-gray-700 mb-1">{t('hosts.jobTitle')}</label>
                  <input type="text" value={form.jobTitle} onChange={e => setForm(p => ({ ...p, jobTitle: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-suprema-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
                    placeholder="Gerente, Analista..." />
                </div>
              </div>
              {formError && <p className="text-xs text-red-600 font-semibold">{formError}</p>}
            </div>
            <div className="flex gap-2 justify-end px-5 pb-5">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-suprema-gray-700 hover:bg-suprema-gray-100 rounded-xl transition-colors">
                {t('hosts.cancel')}
              </button>
              <button onClick={handleSave} disabled={saving || !form.fullName.trim()}
                className="px-4 py-2 text-sm bg-suprema-burgundy text-white font-bold rounded-xl hover:bg-suprema-burgundy-dark disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? t('hosts.saving') : t('hosts.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <InviteModal
          hosts={hosts}
          onClose={() => setShowInvite(false)}
        />
      )}

      {/* Account modal */}
      {accountModal && (
        <AccountModal
          host={accountModal.host}
          mode={accountModal.mode}
          onClose={() => setAccountModal(null)}
          onSuccess={loadHosts}
        />
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-suprema-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('hosts.searchPlaceholder')}
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-suprema-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy outline-none text-suprema-gray-900"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-suprema-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-suprema-gray-300" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users size={40} className="mx-auto text-suprema-gray-200 mb-4" />
            <p className="text-suprema-gray-800/40 font-semibold">
              {search ? t('hosts.noResults') : t('hosts.empty')}
            </p>
            {!search && (
              <p className="text-sm text-suprema-gray-800/30 mt-1">{t('hosts.emptyHint')}</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-suprema-gray-50 border-b border-suprema-gray-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">{t('hosts.colHost')}</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden md:table-cell">{t('hosts.colDeptJob')}</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden sm:table-cell">{t('hosts.colContact')}</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider">{t('hosts.colSource')}</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-suprema-gray-800/50 uppercase tracking-wider hidden lg:table-cell">Acceso VMS</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-suprema-gray-50">
              {filtered.map(h => {
                const src = SOURCE_BADGE[h.source] ?? SOURCE_BADGE.LOCAL;
                return (
                  <tr key={h.id} className={`hover:bg-suprema-gray-50 transition-colors ${!h.isActive ? 'opacity-40' : ''}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-suprema-burgundy/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-suprema-burgundy">{h.fullName.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-suprema-gray-900">{h.fullName}</p>
                          {!h.isActive && <span className="text-[10px] text-red-500 font-bold">{t('hosts.inactive')}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <div className="space-y-0.5">
                        {h.department && <p className="text-suprema-gray-700 font-medium">{h.department}</p>}
                        {h.jobTitle && <p className="text-suprema-gray-800/40 text-xs">{h.jobTitle}</p>}
                        {!h.department && !h.jobTitle && <span className="text-suprema-gray-800/25">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden sm:table-cell">
                      <div className="space-y-0.5">
                        {h.email && <p className="text-suprema-gray-700">{h.email}</p>}
                        {h.phone && <p className="text-suprema-gray-800/40 text-xs">{h.phone}</p>}
                        {!h.email && !h.phone && <span className="text-suprema-gray-800/25">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${src.color}`}>{src.label}</span>
                      {h.supremaUserId && <p className="text-[10px] text-suprema-gray-800/30 mt-0.5 font-mono">#{h.supremaUserId}</p>}
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      {h.userId ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          <ShieldCheck size={10} /> Cuenta activa
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          Sin acceso
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setShowInvite(true)}
                          className="p-1.5 rounded-lg hover:bg-suprema-burgundy/10 text-suprema-gray-400 hover:text-suprema-burgundy transition-colors"
                          title="Invitar visitante"
                        >
                          <Mail size={14} />
                        </button>
                        {h.isActive && !h.userId && (
                          <button
                            onClick={() => setAccountModal({ host: h, mode: 'create' })}
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-suprema-gray-400 hover:text-emerald-700 transition-colors"
                            title="Crear cuenta de acceso"
                          >
                            <UserPlus size={14} />
                          </button>
                        )}
                        {h.userId && (
                          <button
                            onClick={() => setAccountModal({ host: h, mode: 'manage' })}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-suprema-gray-400 hover:text-blue-600 transition-colors"
                            title="Gestionar cuenta de acceso"
                          >
                            <KeyRound size={14} />
                          </button>
                        )}
                        {h.source === 'LOCAL' && (
                          <button onClick={() => openEdit(h)}
                            className="p-1.5 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-400 hover:text-suprema-gray-900 transition-colors"
                            title={t('hosts.editHost')}>
                            <Pencil size={14} />
                          </button>
                        )}
                        {h.isActive && (
                          <button onClick={() => handleDeactivate(h)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-suprema-gray-400 hover:text-red-600 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-suprema-gray-800/30 mt-4 text-center">{t('hosts.footer')}</p>
    </div>
  );
}
