/**
 * @file visitor-types.ts
 * @description Catálogo compartido de tipos de visitante (labels/íconos/colores),
 * usado por RegisterWalkInModal, VisitorDetailModal, la página de visitantes y la
 * página de configuración de auto-checkout por tipo de visitante.
 *
 * Además de los tipos predefinidos (fijos del sistema), cada tenant puede crear
 * tipos personalizados desde Configuración > Tipos de Visitante. El hook
 * `useVisitorTypeCatalog` combina ambos catálogos para uso en toda la UI.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '@/lib/api';

export interface VisitorTypeMeta {
  label: string;
  icon: string;
  color: string;
}

export interface CustomVisitorType {
  key: string;
  label: string;
  icon: string;
}

export const VISITOR_TYPE_LABELS: Record<string, VisitorTypeMeta> = {
  WALK_IN:    { label: 'Visitante General', icon: '🚶', color: 'bg-gray-100 text-gray-700' },
  CONTRACTOR: { label: 'Contratista',       icon: '🔧', color: 'bg-orange-100 text-orange-700' },
  VIP:        { label: 'VIP',               icon: '⭐', color: 'bg-yellow-100 text-yellow-700' },
  INTERVIEW:  { label: 'Entrevista',        icon: '💼', color: 'bg-blue-100 text-blue-700' },
  SUPPLIER:   { label: 'Proveedor',         icon: '📦', color: 'bg-purple-100 text-purple-700' },
  COURIER:    { label: 'Mensajería',        icon: '📬', color: 'bg-teal-100 text-teal-700' },
};

export const VISITOR_TYPE_KEYS = Object.keys(VISITOR_TYPE_LABELS);

const CUSTOM_TYPE_COLOR = 'bg-slate-100 text-slate-700';

/**
 * Hook que combina los tipos de visitante predefinidos con los personalizados
 * del tenant actual (obtenidos de `GET /visitors/settings/visitor-types`).
 *
 * Retorna:
 * - `labels`: mapa combinado key -> { label, icon, color }, listo para usar
 *   igual que `VISITOR_TYPE_LABELS` en selects, badges, etc.
 * - `keys`: lista de claves combinadas (predefinidas primero, luego personalizadas).
 * - `custom`: lista cruda de tipos personalizados (para UI de gestión).
 * - `loading`, `error`, `refresh`, `createCustomType`, `deleteCustomType`.
 */
export function useVisitorTypeCatalog() {
  const [custom, setCustom] = useState<CustomVisitorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ builtIn: string[]; custom: CustomVisitorType[] }>('/visitors/settings/visitor-types');
      setCustom(Array.isArray(res.data?.custom) ? res.data.custom : []);
    } catch {
      setError('No se pudieron cargar los tipos de visitante personalizados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const labels = useMemo(() => {
    const map: Record<string, VisitorTypeMeta> = { ...VISITOR_TYPE_LABELS };
    for (const c of custom) {
      map[c.key] = { label: c.label, icon: c.icon || '🏷️', color: CUSTOM_TYPE_COLOR };
    }
    return map;
  }, [custom]);

  const keys = useMemo(() => [...VISITOR_TYPE_KEYS, ...custom.map(c => c.key)], [custom]);

  const createCustomType = useCallback(async (input: { label: string; icon?: string }) => {
    const res = await api.post<{ custom: CustomVisitorType[] }>('/visitors/settings/visitor-types', input);
    setCustom(Array.isArray(res.data?.custom) ? res.data.custom : []);
    return res.data?.custom ?? [];
  }, []);

  const deleteCustomType = useCallback(async (key: string) => {
    const res = await api.delete<{ custom: CustomVisitorType[] }>(`/visitors/settings/visitor-types/${encodeURIComponent(key)}`);
    setCustom(Array.isArray(res.data?.custom) ? res.data.custom : []);
    return res.data?.custom ?? [];
  }, []);

  return { labels, keys, custom, loading, error, refresh, createCustomType, deleteCustomType };
}
