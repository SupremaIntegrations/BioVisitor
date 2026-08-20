'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook que cierra la sesión automáticamente tras un período de inactividad.
 * Escucha eventos de mouse, teclado y touch para resetear el temporizador.
 *
 * @param timeoutMinutes - Minutos de inactividad antes de cerrar sesión. null = desactivado.
 * @param onTimeout     - Función que se ejecuta al expirar el timer.
 */
export function useInactivityTimer(
  timeoutMinutes: number | null,
  onTimeout: () => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!timeoutMinutes || timeoutMinutes <= 0) return;
    timerRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, timeoutMinutes * 60 * 1000);
  }, [timeoutMinutes]);

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;

    const events: string[] = [
      'mousedown', 'mousemove', 'keydown',
      'scroll', 'touchstart', 'click', 'wheel',
    ];

    events.forEach(e => document.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(e => document.removeEventListener(e, reset));
    };
  }, [timeoutMinutes, reset]);
}
