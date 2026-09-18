'use client';

import { useEffect, useState } from 'react';

/**
 * Extrae el último segmento no vacío de la ruta actual (el token de un
 * enlace público como /visitor/onboarding/<token>). Reemplaza a
 * useParams()/React.use(params) en las rutas de token público, que bajo
 * `output: 'export'` ya no son segmentos dinámicos de Next — nginx sirve
 * un único HTML estático para todo el prefijo (ver
 * windows-deployment/assets/nginx.conf.template) y esta función lee el
 * token real desde la URL del navegador en tiempo de ejecución.
 *
 * Debe leer window.location DENTRO de useEffect: durante el build estático
 * Next prerenderiza en Node, donde `window` no existe.
 */
export function useUrlToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const segments = window.location.pathname.split('/').filter(Boolean);
    setToken(segments.at(-1) ?? null);
  }, []);

  return token;
}
