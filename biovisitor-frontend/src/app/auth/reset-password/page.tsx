'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  const passwordsMatch = newPassword === confirmPassword;
  const isStrong = newPassword.length >= 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!token) {
      setErrorMsg('El enlace de recuperación no es válido. Solicita uno nuevo desde la página de login.');
      return;
    }

    if (!passwordsMatch) {
      setErrorMsg('Las contraseñas no coinciden.');
      return;
    }

    if (!isStrong) {
      setErrorMsg('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setSuccess(true);
    } catch (error: any) {
      setErrorMsg(error.response?.data?.message || 'El enlace es inválido o ya expiró. Solicita uno nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-suprema-gray-100 flex items-center justify-center p-4 selection:bg-suprema-burgundy selection:text-white">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-suprema-burgundy/5 blur-3xl mix-blend-multiply" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-suprema-burgundy-dark/5 blur-3xl mix-blend-multiply" />
      </div>

      <div className="max-w-md w-full relative z-10">
        <div className="bg-white rounded-2xl shadow-xl shadow-suprema-gray-900/5 overflow-hidden border border-suprema-gray-100/50">

          {/* Header */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-suprema-burgundy to-suprema-burgundy-dark text-white shadow-lg mb-6 shadow-suprema-burgundy/30 ring-4 ring-suprema-burgundy/10">
              <span className="text-2xl font-bold tracking-tighter">S</span>
            </div>
            <h1 className="text-2xl font-bold text-suprema-gray-900 mb-2">BioVisitor X</h1>
            <p className="text-suprema-gray-800/60 font-medium">Sistema de Gestión de Visitantes</p>
          </div>

          {/* Success state */}
          {success ? (
            <div className="px-8 pb-10 space-y-5 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle size={32} className="text-emerald-600" />
                </div>
              </div>
              <div>
                <h2 className="text-lg font-bold text-suprema-gray-900 mb-2">¡Contraseña actualizada!</h2>
                <p className="text-sm text-suprema-gray-800/60 leading-relaxed">
                  Tu contraseña fue restablecida exitosamente. Ya puedes iniciar sesión con tu nueva contraseña.
                </p>
              </div>
              <button
                onClick={() => router.push('/')}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-suprema-burgundy text-white text-sm font-bold hover:bg-suprema-burgundy-dark transition-colors shadow-md"
              >
                Ir al inicio de sesión
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-8 pb-10 space-y-5">
              <div>
                <h2 className="text-lg font-bold text-suprema-gray-900 mb-1">Nueva contraseña</h2>
                <p className="text-sm text-suprema-gray-800/60">
                  Elige una contraseña segura de al menos 8 caracteres.
                </p>
              </div>

              {/* Token missing warning */}
              {!token && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-700">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">
                    Enlace inválido. Por favor solicita un nuevo correo de recuperación desde la página de inicio de sesión.
                  </p>
                </div>
              )}

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <p className="text-sm font-medium">{errorMsg}</p>
                </div>
              )}

              {/* New password */}
              <div>
                <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5" htmlFor="new-password">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                    <Lock size={18} strokeWidth={2.5} />
                  </div>
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="block w-full pl-10 pr-10 py-2.5 border border-suprema-gray-100 rounded-xl bg-suprema-gray-100/50
                             focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20 focus:border-suprema-burgundy
                             transition-all duration-200 outline-none text-suprema-gray-900 font-medium tracking-widest"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-suprema-gray-800/40 hover:text-suprema-gray-800/70 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {/* Strength indicator */}
                {newPassword.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className={`h-1 flex-1 rounded-full transition-colors ${isStrong ? 'bg-emerald-500' : 'bg-red-300'}`} />
                    <span className={`text-[10px] font-bold ${isStrong ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isStrong ? '✓ Segura' : `${newPassword.length}/8 mín.`}
                    </span>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-sm font-semibold text-suprema-gray-900 mb-1.5" htmlFor="confirm-password">
                  Confirmar contraseña
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-suprema-gray-800/40">
                    <Lock size={18} strokeWidth={2.5} />
                  </div>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`block w-full pl-10 pr-3 py-2.5 border rounded-xl bg-suprema-gray-100/50
                             focus:bg-white focus:ring-2 focus:ring-suprema-burgundy/20
                             transition-all duration-200 outline-none text-suprema-gray-900 font-medium tracking-widest
                             ${confirmPassword.length > 0 && !passwordsMatch
                               ? 'border-red-300 focus:border-red-400'
                               : 'border-suprema-gray-100 focus:border-suprema-burgundy'
                             }`}
                    placeholder="••••••••"
                  />
                </div>
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-red-500 font-medium mt-1">Las contraseñas no coinciden</p>
                )}
                {confirmPassword.length > 0 && passwordsMatch && (
                  <p className="text-xs text-emerald-600 font-medium mt-1">✓ Las contraseñas coinciden</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading || !token || !isStrong || !passwordsMatch}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white
                         bg-suprema-burgundy hover:bg-suprema-burgundy-dark disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-200 shadow-md"
              >
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                {isLoading ? 'Guardando...' : 'Establecer nueva contraseña'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-suprema-gray-800/50 hover:text-suprema-burgundy transition-colors"
                >
                  <ArrowLeft size={14} /> Volver al inicio de sesión
                </button>
              </div>
            </form>
          )}

          <div className="px-8 py-5 bg-suprema-gray-100/30 border-t border-suprema-gray-100 text-center">
            <p className="text-xs font-medium text-suprema-gray-800/50">
              Solo personal autorizado. BioVisitor X v2.0
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-suprema-gray-100 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-suprema-burgundy" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
