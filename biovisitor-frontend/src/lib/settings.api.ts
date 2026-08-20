/**
 * @file settings.api.ts
 * @description Cliente API para el módulo de Configuración - Conexiones Suprema BioStar.
 *
 * Todas las llamadas incluyen automáticamente el token JWT (via interceptor en api.ts).
 * Las credenciales NUNCA aparecen en las respuestas del servidor.
 */

import { api } from './api';

export type BioStarPlatform = 'BIOSTAR_2' | 'BIOSTAR_X';

export type ConnectionTestStatus =
  | 'NEVER_TESTED'
  | 'SUCCESS'
  | 'FAILED'
  | 'PENDING';

export interface SupremaConnection {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  platform: BioStarPlatform;
  apiUrl: string;
  hasCaCert: boolean;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: ConnectionTestStatus;
  lastTestMessage: string | null;
  serverMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionPayload {
  tenantId?: string;
  name: string;
  description?: string;
  platform: BioStarPlatform;
  apiUrl: string;
  loginId: string;
  password: string;
  caCertPath?: string;
  isActive?: boolean;
}

export interface UpdateConnectionPayload {
  name?: string;
  description?: string;
  platform?: BioStarPlatform;
  apiUrl?: string;
  loginId?: string;
  password?: string;
  caCertPath?: string;
  isActive?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverInfo?: {
    platform: string;
    version?: string;
    buildDate?: string;
    licenseInfo?: Record<string, unknown>;
  };
  latencyMs?: number;
  testedAt: string;
}

const BASE = '/settings/suprema-connections';

export const settingsApi = {
  listConnections: async (tenantId?: string): Promise<SupremaConnection[]> => {
    const params = tenantId ? { tenantId } : {};
    const res = await api.get<SupremaConnection[]>(BASE, { params });
    return res.data;
  },

  getConnection: async (id: string): Promise<SupremaConnection> => {
    const res = await api.get<SupremaConnection>(`${BASE}/${id}`);
    return res.data;
  },

  createConnection: async (
    payload: CreateConnectionPayload,
  ): Promise<SupremaConnection> => {
    const res = await api.post<SupremaConnection>(BASE, payload);
    return res.data;
  },

  updateConnection: async (
    id: string,
    payload: UpdateConnectionPayload,
  ): Promise<SupremaConnection> => {
    const res = await api.patch<SupremaConnection>(`${BASE}/${id}`, payload);
    return res.data;
  },

  deleteConnection: async (id: string): Promise<void> => {
    await api.delete(`${BASE}/${id}`);
  },

  testConnection: async (id: string): Promise<ConnectionTestResult> => {
    const res = await api.post<ConnectionTestResult>(`${BASE}/${id}/test`);
    return res.data;
  },
};
