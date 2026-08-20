'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { Star, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function publicPost(path: string, body: object) {
    const res = await fetch(`${PUBLIC_API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return res.json();
}

export default function ExitSurveyPage() {
    const params = useParams();
    const token = params.token as string;

    const [rating, setRating] = useState<number>(0);
    const [hoverRating, setHoverRating] = useState<number>(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (rating < 1) {
            setError('Por favor selecciona una calificación.');
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            await publicPost(`/visitors/survey/${token}`, { rating, comment: comment.trim() || undefined });
            setDone(true);
        } catch (err: any) {
            setError(err.message || 'No se pudo enviar tu respuesta. Intenta nuevamente.');
        } finally {
            setSubmitting(false);
        }
    };

    if (done) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">¡Gracias por tu opinión!</h1>
                    <p className="text-gray-500 text-sm">Tu respuesta ha sido registrada correctamente.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
                <div className="text-center mb-6">
                    <h1 className="text-xl font-bold text-gray-900">¿Cómo estuvo tu visita?</h1>
                    <p className="text-gray-500 text-sm mt-1">Tu opinión nos ayuda a mejorar.</p>
                </div>

                <div className="flex justify-center gap-2 mb-6">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => setRating(n)}
                            onMouseEnter={() => setHoverRating(n)}
                            onMouseLeave={() => setHoverRating(0)}
                            className="transition-transform hover:scale-110"
                            aria-label={`Calificar con ${n} estrella${n > 1 ? 's' : ''}`}
                        >
                            <Star
                                className="w-9 h-9"
                                fill={(hoverRating || rating) >= n ? '#A12944' : 'none'}
                                stroke={(hoverRating || rating) >= n ? '#A12944' : '#d1d5db'}
                                strokeWidth={1.5}
                            />
                        </button>
                    ))}
                </div>

                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Cuéntanos más sobre tu experiencia (opcional)"
                    rows={4}
                    maxLength={1000}
                    className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[#A12944]/30 focus:border-[#A12944] mb-4"
                />

                {error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 bg-[#A12944] hover:bg-[#8a2139] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
                >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Enviar respuesta
                </button>
            </div>
        </div>
    );
}
