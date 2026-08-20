'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Lock, Mail, ArrowRight, AlertCircle, CheckCircle,
  ArrowLeft, Loader2, ShieldAlert, Eye, EyeOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/I18nContext';

type View = 'login' | 'forgot' | 'forgot-sent';
type SetupStep = 'warning' | 'form' | 'confirm' | 'done';

function getPasswordStrength(pwd: string): { level: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pwd.length === 0) return { level: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd) && /[0-9]/.test(pwd)) score++;
  if (pwd.length >= 12 && /[^A-Za-z0-9]/.test(pwd)) score++;
  const map = [
    { level: 1, label: 'Débil', color: 'bg-red-500' },
    { level: 2, label: 'Media', color: 'bg-yellow-500' },
    { level: 3, label: 'Fuerte', color: 'bg-emerald-500' },
  ] as const;
  return map[Math.min(score, 2)];
}

function SetupModal({ onComplete }: { onComplete: (email: string) => void }) {
  const [step, setStep] = useState<SetupStep>('warning');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const strength = getPasswordStrength(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail);
  const canSubmit =
    adminName.trim().length >= 2 &&
    emailValid &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    passwordsMatch;

  const handleApply = async () => {
    setIsLoading(true);
    setError('');
    try {
      await api.post('/auth/setup', { name: adminName.trim(), email: adminEmail.trim(), password, confirmPassword });
      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ocurrió un error al configurar el sistema.');
      setStep('form');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-suprema-gray-100">

        {/* ── Header ── */}
        <div className="px-8 pt-8 pb-5 text-center border-b border-suprema-gray-100">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 ring-4 ring-amber-100 mb-4">
            <ShieldAlert size={28} className="text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-suprema-gray-900">
            Configuración del Administrador
          </h2>
          <p className="text-sm text-suprema-gray-800/55 mt-1">Instalación inicial del sistema</p>
        </div>

        {/* ── Step: Warning ── */}
        {step === 'warning' && (
          <div className="px-8 py-7 space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-amber-800 leading-relaxed">
                Bienvenido a Biovisitor, Powered by Suprema LATAM<br />
                <span className="font-normal">Muchas gracias por usar nuestros servicios</span>
              </p>
              <p className="text-sm text-amber-800">
                Esta es la configuración inicial del usuario administrador del sistema
              </p>
              <ul className="text-sm text-amber-700 space-y-1.5 list-disc list-inside">
                <li>Este usuario tiene los <strong>permisos más elevados</strong> sobre todo el sistema.</li>
                <li>Guarde la contraseña en un lugar seguro.</li>
                <li>
                  <strong>NO es posible recuperarla</strong> si la pierde, requeriría reinstalar todo el sistema y perdería todos los datos.
                </li>
              </ul>
            </div>

            <button
              onClick={() => setStep('form')}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white
                       bg-suprema-burgundy hover:bg-suprema-burgundy-dark transition-all duration-200 shadow-md"
            >
              Entendido, continuar <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* ── Step: Form ── */}
        {step === 'form' && (
          <div className="px-8 py-7 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
                <AlertCircle size={16} className="flex-shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Name field */}
            <div>
              <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5">
                Nombre completo
              </label>
              <input
                type="text"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                autoComplete="name"
                className="block w-full px-3 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                         focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                         transition-all duration-200 outline-none text-suprema-gray-900 font-medium"
                placeholder="Ej: Juan Pérez"
              />
            </div>

            {/* Email field */}
            <div>
              <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                  <Mail size={16} />
                </div>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  autoComplete="email"
                  className="block w-full pl-9 pr-3 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                           focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                           transition-all duration-200 outline-none text-suprema-gray-900 font-medium"
                  placeholder="admin@empresa.com"
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                  <Lock size={16} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="block w-full pl-9 pr-10 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                           focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                           transition-all duration-200 outline-none text-suprema-gray-900 font-medium"
                  placeholder="Mínimo 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-suprema-gray-800/40 hover:text-suprema-gray-900 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          strength.level >= i ? strength.color : 'bg-suprema-gray-100'
                        }`}
                      />
                    ))}
                  </div>
                  {strength.label && (
                    <p className={`text-xs font-medium ${
                      strength.level === 1 ? 'text-red-600' :
                      strength.level === 2 ? 'text-yellow-600' : 'text-emerald-600'
                    }`}>
                      Contraseña {strength.label}
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-suprema-gray-800/40 mt-1.5">
                Mínimo 8 caracteres, una mayúscula y un número.
              </p>
            </div>

            {/* Confirm password field */}
            <div>
              <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5">
                Confirmar contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                  <Lock size={16} />
                </div>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className={`block w-full pl-9 pr-10 py-2.5 border rounded-xl bg-suprema-gray-100/50
                           focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20
                           transition-all duration-200 outline-none text-suprema-gray-900 font-medium ${
                    confirmPassword.length > 0
                      ? passwordsMatch
                        ? 'border-emerald-400 focus:border-emerald-500'
                        : 'border-red-400 focus:border-red-500'
                      : 'border-suprema-gray-100 focus:border-suprema-burgundy'
                  }`}
                  placeholder="Repite la contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-suprema-gray-800/40 hover:text-suprema-gray-900 transition-colors"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-600 mt-1">Las contraseñas no coinciden.</p>
              )}
              {passwordsMatch && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <CheckCircle size={12} /> Las contraseñas coinciden.
                </p>
              )}
            </div>

            <button
              onClick={() => setStep('confirm')}
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white
                       bg-suprema-burgundy hover:bg-suprema-burgundy-dark disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200 shadow-md"
            >
              Aplicar configuración
            </button>
          </div>
        )}

        {/* ── Step: Confirm ── */}
        {step === 'confirm' && (
          <div className="px-8 py-7 space-y-5">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                <ShieldAlert size={28} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-suprema-gray-900 text-lg">¿Confirmar configuración?</h3>
                <p className="text-sm text-suprema-gray-800/60 mt-1 leading-relaxed">
                  Se creará el usuario administrador <strong className="text-suprema-gray-900">{adminName}</strong> con el correo{' '}
                  <strong className="text-suprema-gray-900">{adminEmail}</strong>.
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('form')}
                disabled={isLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-suprema-gray-900
                         border border-suprema-gray-100 hover:bg-suprema-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleApply}
                disabled={isLoading}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white
                         bg-suprema-burgundy hover:bg-suprema-burgundy-dark disabled:opacity-70 transition-all duration-200 shadow-md"
              >
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                {isLoading ? 'Configurando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <div className="px-8 py-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle size={32} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-suprema-gray-900 text-lg">¡Sistema configurado!</h3>
              <p className="text-sm text-suprema-gray-800/60 mt-2 leading-relaxed">
                El administrador fue creado exitosamente. Anote sus credenciales:
              </p>
              <div className="mt-3 bg-suprema-gray-100/60 rounded-xl px-4 py-3 text-left border border-suprema-gray-100 space-y-2">
                <div>
                  <p className="text-xs text-suprema-gray-800/50">Nombre</p>
                  <p className="text-sm font-bold text-suprema-gray-900">{adminName}</p>
                </div>
                <div>
                  <p className="text-xs text-suprema-gray-800/50">Correo</p>
                  <p className="text-sm font-bold font-mono text-suprema-gray-900">{adminEmail}</p>
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3">
                Guarde esta contraseña en un lugar seguro. No se puede recuperar si la pierde.
              </p>
            </div>
            <button
              onClick={() => onComplete(adminEmail)}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white
                       bg-suprema-burgundy hover:bg-suprema-burgundy-dark transition-all duration-200 shadow-md"
            >
              Ir al inicio de sesión <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [setupSuccess, setSetupSuccess] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Setup detection
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupCheckDone, setSetupCheckDone] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');

  useEffect(() => {
    const savedEmail = localStorage.getItem('biovisitor_remember_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
    // Check if first-run setup is needed
    api.get('/auth/system-status')
      .then((res) => {
        if (res.data?.needsSetup === true) setNeedsSetup(true);
      })
      .catch(() => { /* fail-safe: show normal login */ })
      .finally(() => setSetupCheckDone(true));
  }, []);

  const handleSetupComplete = useCallback((createdEmail: string) => {
    setNeedsSetup(false);
    setSetupSuccess(true);
    setEmail(createdEmail);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    try {
      const response = await api.post('/auth/login', { email, password });
      const { accessToken, user } = response.data;

      localStorage.setItem('biovisitor_token', accessToken);
      localStorage.setItem('biovisitor_user', JSON.stringify(user));

      if (rememberMe) {
        localStorage.setItem('biovisitor_remember_email', email);
      } else {
        localStorage.removeItem('biovisitor_remember_email');
      }

      router.push('/dashboard');
    } catch (error: any) {
      console.error('Login failed:', error);
      setErrorMsg(error.response?.data?.message || t('login.errorDefault'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');

    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setView('forgot-sent');
    } catch (error: any) {
      setForgotError(error.response?.data?.message || 'Ocurrió un error. Inténtalo de nuevo.');
    } finally {
      setForgotLoading(false);
    }
  };

  const openForgot = () => {
    setForgotEmail(email);
    setForgotError('');
    setView('forgot');
  };

  // Don't render until setup check is done (avoids flicker)
  if (!setupCheckDone) {
    return (
      <div className="min-h-screen bg-suprema-gray-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-suprema-burgundy" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-suprema-gray-100 flex items-center justify-center p-4 selection:bg-suprema-burgundy selection:text-white">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-suprema-burgundy/5 blur-3xl mix-blend-multiply" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-suprema-burgundy-dark/5 blur-3xl mix-blend-multiply" />
      </div>

      {/* First-run setup modal */}
      {needsSetup && <SetupModal onComplete={handleSetupComplete} />}

      <div className="max-w-md w-full relative z-10">
        <div className="bg-white rounded-2xl shadow-xl shadow-suprema-gray-900/5 overflow-hidden border border-suprema-gray-100/50 backdrop-blur-sm">

          {/* ─── Header ─── */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-6 shadow-suprema-gray-900/10 ring-4 ring-suprema-gray-100">
              <svg width="38" height="38" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="7" width="14" height="13" rx="2" fill="rgb(161,41,68)" fillOpacity="0.12"/>
                <rect x="4" y="7" width="14" height="13" rx="2" stroke="rgb(161,41,68)" strokeWidth="1.2" fillOpacity="0"/>
                <rect x="9" y="5" width="4" height="3.5" rx="1" fill="rgb(161,41,68)" fillOpacity="0.3"/>
                <rect x="10.25" y="3.5" width="1.5" height="2" rx="0.75" fill="rgb(161,41,68)" fillOpacity="0.25"/>
                <circle cx="11" cy="12" r="2.2" fill="rgb(161,41,68)"/>
                <path d="M6.5 18.5c0-2.5 2.02-4.5 4.5-4.5s4.5 2 4.5 4.5" fill="rgb(161,41,68)" fillOpacity="0.7"/>
                <circle cx="16" cy="7" r="3" fill="rgb(16,185,129)"/>
                <path d="M14.5 7l1 1.2 2-2" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-suprema-gray-900 mb-2">{t('login.title')}</h1>
            <p className="text-suprema-gray-800/60 font-medium">{t('login.subtitle')}</p>
          </div>

          {/* ─── LOGIN VIEW ─── */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="px-8 pb-10 space-y-6">
              <div className="space-y-4">
                {setupSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-700 animate-in fade-in">
                    <CheckCircle size={18} className="flex-shrink-0" />
                    <p className="text-sm font-medium">
                      Administrador configurado correctamente. Inicie sesión con su contraseña.
                    </p>
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 animate-in fade-in">
                    <AlertCircle size={18} className="flex-shrink-0" />
                    <p className="text-sm font-medium">{errorMsg}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5" htmlFor="email">
                    {t('login.email')}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                      <Mail size={18} strokeWidth={2.5} />
                    </div>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                               focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                               transition-all duration-200 outline-none text-suprema-gray-900 font-medium"
                      placeholder="correo@empresa.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5" htmlFor="password">
                    {t('login.password')}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                      <Lock size={18} strokeWidth={2.5} />
                    </div>
                    <input
                      id="password"
                      type={showLoginPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full pl-10 pr-10 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                               focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                               transition-all duration-200 outline-none text-suprema-gray-900 font-medium tracking-widest"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(v => !v)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-suprema-gray-800/40 hover:text-suprema-gray-900 transition-colors"
                    >
                      {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 text-suprema-burgundy focus:ring-suprema-burgundy border-gray-300 rounded cursor-pointer"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm font-medium text-suprema-gray-800/70 select-none cursor-pointer">
                    {t('login.rememberMe')}
                  </label>
                </div>

                <button
                  type="button"
                  onClick={openForgot}
                  className="text-sm font-semibold text-suprema-burgundy hover:text-suprema-burgundy-dark transition-colors"
                >
                  {t('login.forgotPassword')}
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent rounded-xl
                         text-sm font-bold text-white bg-suprema-burgundy hover:bg-suprema-burgundy-dark
                         focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-suprema-burgundy
                         transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                  {isLoading
                    ? <Loader2 className="h-5 w-5 animate-spin text-suprema-burgundy-light" />
                    : <ArrowRight className="h-5 w-5 text-suprema-burgundy-light group-hover:text-white group-hover:translate-x-1 transition-all duration-300" />
                  }
                </span>
                {isLoading ? t('login.authenticating') : t('login.signIn')}
              </button>
            </form>
          )}

          {/* ─── FORGOT PASSWORD VIEW ─── */}
          {view === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="px-8 pb-10 space-y-5">
              <div>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="flex items-center gap-1.5 text-sm font-medium text-suprema-gray-800/50 hover:text-suprema-burgundy transition-colors mb-4"
                >
                  <ArrowLeft size={14} /> Volver al inicio de sesión
                </button>

                <h2 className="text-lg font-bold text-suprema-gray-900 mb-1">Recuperar contraseña</h2>
                <p className="text-sm text-suprema-gray-800/60">
                  Ingresa el correo con el que estás registrado y te enviaremos las instrucciones para crear una nueva contraseña.
                </p>
              </div>

              {forgotError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <p className="text-sm font-medium">{forgotError}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5" htmlFor="forgot-email">
                  Correo electrónico
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                    <Mail size={18} strokeWidth={2.5} />
                  </div>
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                             focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                             transition-all duration-200 outline-none text-suprema-gray-900 font-medium"
                    placeholder="operador@empresa.com"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white
                         bg-suprema-burgundy hover:bg-suprema-burgundy-dark disabled:opacity-70 disabled:cursor-not-allowed
                         transition-all duration-200 shadow-md"
              >
                {forgotLoading && <Loader2 size={16} className="animate-spin" />}
                {forgotLoading ? 'Enviando...' : 'Enviar instrucciones'}
              </button>
            </form>
          )}

          {/* ─── FORGOT SENT VIEW ─── */}
          {view === 'forgot-sent' && (
            <div className="px-8 pb-10 space-y-5 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle size={32} className="text-emerald-600" />
                </div>
              </div>
              <div>
                <h2 className="text-lg font-bold text-suprema-gray-900 mb-2">Revisa tu correo</h2>
                <p className="text-sm text-suprema-gray-800/60 leading-relaxed">
                  Si <span className="font-semibold text-suprema-gray-900">{forgotEmail}</span> está registrado en el sistema,
                  recibirás un enlace para restablecer tu contraseña en los próximos minutos.
                </p>
                <p className="text-xs text-suprema-gray-800/40 mt-3">
                  El enlace expira en 30 minutos. Revisa también tu carpeta de spam.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setView('login'); setForgotEmail(''); }}
                className="inline-flex items-center gap-2 text-sm font-semibold text-suprema-burgundy hover:text-suprema-burgundy-dark transition-colors"
              >
                <ArrowLeft size={14} /> Volver al inicio de sesión
              </button>
            </div>
          )}

          <div className="px-8 py-5 bg-suprema-gray-100/30 border-t border-suprema-gray-100 text-center">
            <p className="text-xs font-medium text-suprema-gray-800/50">
              {t('login.footer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
