'use client';

import { useMemo } from 'react';

export interface OperatorPermissions {
  visitors:   { view: boolean; checkin: boolean; checkout: boolean; preregister: boolean; editVisitor: boolean };
  reports:    { view: boolean };
  accessLogs: { view: boolean };
  auditTrail: { view: boolean };
  settings:   { view: boolean };
}

interface StoredUser {
  role: string;
  permissions?: OperatorPermissions | null;
}

function readStoredUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
  } catch {
    return null;
  }
}

export function usePermissions() {
  const stored = useMemo(() => readStoredUser(), []);
  const role = stored?.role ?? 'OPERATOR';
  const isAdmin = role === 'ADMIN';
  const perms = stored?.permissions ?? null;

  function can(module: keyof OperatorPermissions, action: string): boolean {
    if (isAdmin) return true;
    if (role !== 'OPERATOR') return false;
    if (!perms) return false;
    const mod = perms[module] as Record<string, boolean> | undefined;
    return mod?.[action] === true;
  }

  function canViewPage(page: 'visitors' | 'reports' | 'accessLogs' | 'auditTrail' | 'settings'): boolean {
    if (isAdmin) return true;
    if (role !== 'OPERATOR') return false;
    if (!perms) return false;
    return perms[page]?.view === true;
  }

  return { isAdmin, role, perms, can, canViewPage };
}
