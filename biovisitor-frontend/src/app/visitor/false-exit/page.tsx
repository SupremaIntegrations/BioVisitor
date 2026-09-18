'use client';

import React, { useState } from 'react';
import { useUrlToken } from '@/lib/useUrlToken';
import { ShieldAlert, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function publicPost(path: string) {
    const res = await fetch(`${PUBLIC_API}${path}`, { method: 'POST' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return res.json();
}

export default function FalseExitReportPage() {
    const token = useUrlToken();

    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirm = async () => {
        setError(null);
        setSubmitting(true);
        try {
            await publicPost(`/visitors/false-exit/${token}`);
            setDone(true);
        } catch (err: any) {
            setError(err.message || 'No se pudo enviar el reporte. Intenta nuevamente.');
        } finally {
            setSubmitting(false);
        }
    };

    if (done) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Reporte enviado</h1>
                    <p className="text-gray-500 text-sm">
                        Un operador de recepción ha sido notificado y revisará tu caso en breve para restablecer tu acceso.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                    <ShieldAlert className="w-8 h-8 text-red-600" />
                </div>
                <h1 className="text-xl font-bold text-gray-900 mb-2">¿Sigues dentro de las instalaciones?</h1>
                <p className="text-gray-500 text-sm mb-6">
                    Nuestro sistema registró tu salida automáticamente, pero si en realidad todavía te encuentras en el
                    edificio, confirma a continuación para que un operador de recepción restablezca tu acceso.
                </p>

                {error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4 text-left">
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <button
                    onClick={handleConfirm}
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
                >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Confirmar — sigo dentro
                </button>

                <p className="text-xs text-gray-400 mt-4">
                    Este enlace es válido por 1 hora tras tu salida registrada. Si ya saliste de las instalaciones, puedes
                    ignorar este correo.
                </p>
            </div>
        </div>
    );
}
