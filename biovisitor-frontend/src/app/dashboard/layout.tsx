'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useInactivityTimer } from '@/hooks/useInactivityTimer';
import { useSocket } from '@/hooks/useSocket';
import { api } from '@/lib/api';
import {
    Users,
    Calendar,
    ShieldCheck,
    Settings,
    LogOut,
    Menu,
    X,
    Bell,
    FileText,
    Globe,
    UserCheck,
    ClipboardList,
    Laptop,
    KeyRound,
    Eye,
    EyeOff,
    CheckCircle2,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';
import { type Locale, localeLabels, localeDisplayCodes } from '@/i18n/translations';
import { usePermissions } from '@/hooks/usePermissions';

/* ─── Modal: Cambiar contraseña ─────────────────────────────────────── */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword.length < 8) {
            setError('La nueva contraseña debe tener al menos 8 caracteres.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Las contraseñas nuevas no coinciden.');
            return;
        }

        setLoading(true);
        try {
            await api.post('/auth/change-password', { currentPassword, newPassword });
            setSuccess(true);
        } catch (err: any) {
            const msg = err?.response?.data?.message;
            setError(Array.isArray(msg) ? msg.join(', ') : (msg || 'Error al cambiar la contraseña.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-suprema-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
                            <KeyRound size={18} className="text-suprema-burgundy" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-suprema-gray-900">Cambiar contraseña</h2>
                            <p className="text-xs text-suprema-gray-800/60">Actualiza tu contraseña de acceso</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-800/50 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    {success ? (
                        <div className="flex flex-col items-center gap-4 py-6 text-center">
                            <CheckCircle2 size={48} className="text-emerald-500" />
                            <div>
                                <p className="font-semibold text-suprema-gray-900 text-base">¡Contraseña actualizada!</p>
                                <p className="text-sm text-suprema-gray-800/60 mt-1">Tu contraseña fue cambiada exitosamente.</p>
                            </div>
                            <button
                                onClick={onClose}
                                className="mt-2 px-6 py-2.5 rounded-xl bg-suprema-burgundy text-white text-sm font-semibold hover:bg-suprema-burgundy/90 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Contraseña actual */}
                            <div>
                                <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5 uppercase tracking-wide">
                                    Contraseña actual
                                </label>
                                <div className="relative">
                                    <input
                                        type={showCurrent ? 'text' : 'password'}
                                        value={currentPassword}
                                        onChange={e => setCurrentPassword(e.target.value)}
                                        required
                                        autoFocus
                                        className="w-full px-4 py-2.5 pr-10 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy"
                                        placeholder="Tu contraseña actual"
                                    />
                                    <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-800/40 hover:text-suprema-gray-800">
                                        {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>

                            {/* Nueva contraseña */}
                            <div>
                                <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5 uppercase tracking-wide">
                                    Nueva contraseña
                                </label>
                                <div className="relative">
                                    <input
                                        type={showNew ? 'text' : 'password'}
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        required
                                        minLength={8}
                                        className="w-full px-4 py-2.5 pr-10 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy"
                                        placeholder="Mínimo 8 caracteres"
                                    />
                                    <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-800/40 hover:text-suprema-gray-800">
                                        {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                {newPassword.length > 0 && newPassword.length < 8 && (
                                    <p className="text-xs text-amber-600 mt-1">Al menos 8 caracteres</p>
                                )}
                            </div>

                            {/* Confirmar contraseña */}
                            <div>
                                <label className="block text-xs font-semibold text-suprema-gray-800/70 mb-1.5 uppercase tracking-wide">
                                    Confirmar nueva contraseña
                                </label>
                                <div className="relative">
                                    <input
                                        type={showConfirm ? 'text' : 'password'}
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 pr-10 rounded-xl border border-suprema-gray-200 text-sm text-suprema-gray-900 focus:outline-none focus:ring-2 focus:ring-suprema-burgundy/30 focus:border-suprema-burgundy"
                                        placeholder="Repite la nueva contraseña"
                                    />
                                    <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-suprema-gray-800/40 hover:text-suprema-gray-800">
                                        {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                                    <p className="text-xs text-red-600 mt-1">Las contraseñas no coinciden</p>
                                )}
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
                                    <X size={15} className="flex-shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-suprema-gray-200 text-sm font-semibold text-suprema-gray-700 hover:bg-suprema-gray-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading || newPassword !== confirmPassword || newPassword.length < 8 || !currentPassword}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-suprema-burgundy text-white text-sm font-semibold hover:bg-suprema-burgundy/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? 'Guardando…' : 'Cambiar contraseña'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

const ALL_NAV = [
    { key: 'nav.overview',   href: '/dashboard',             icon: Calendar,      roles: ['ADMIN', 'OPERATOR', 'HOST'], permKey: null },
    { key: 'nav.visitors',   href: '/dashboard/visitors',    icon: Users,         roles: ['ADMIN', 'OPERATOR'],         permKey: 'visitors'   as const },
    { key: 'nav.equipment',  href: '/dashboard/equipment',   icon: Laptop,        roles: ['ADMIN', 'OPERATOR'],         permKey: null },
    { key: 'nav.reports',    href: '/dashboard/reports',     icon: FileText,      roles: ['ADMIN', 'OPERATOR'],         permKey: 'reports'    as const },
    { key: 'nav.accessLogs', href: '/dashboard/logs',        icon: ShieldCheck,   roles: ['ADMIN', 'OPERATOR'],         permKey: 'accessLogs' as const },
    { key: 'nav.auditTrail', href: '/dashboard/audit-trail', icon: ClipboardList, roles: ['ADMIN', 'OPERATOR'],         permKey: 'auditTrail' as const },
    { key: 'nav.settings',   href: '/dashboard/settings',    icon: Settings,      roles: ['ADMIN', 'OPERATOR'],         permKey: 'settings'   as const },
];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
    ADMIN:    { label: 'Admin',    color: 'bg-suprema-burgundy/10 text-suprema-burgundy' },
    OPERATOR: { label: 'Operador', color: 'bg-blue-100 text-blue-700' },
    HOST:     { label: 'Anfitrión', color: 'bg-emerald-100 text-emerald-700' },
};

const locales: Locale[] = ['es', 'en', 'pt', 'ko'];

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isAuth, setIsAuth] = useState<boolean | null>(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ fullName: string; role: string; email: string } | null>(null);
    const { canViewPage } = usePermissions();
    const notifRef = useRef<HTMLDivElement>(null);
    const { locale, setLocale, t } = useI18n();
    const { isConnected, listenToEvent } = useSocket();
    const [falseExitAlerts, setFalseExitAlerts] = useState<{ visitId: string; visitorName: string; falseExitReportedAt: string | null }[]>([]);

    const fetchFalseExitAlerts = useCallback(async () => {
        try {
            const res = await api.get('/visitors/alerts/false-exits');
            const data = Array.isArray(res.data) ? res.data : [];
            setFalseExitAlerts(data);
        } catch {
            /* silent — non-critical badge */
        }
    }, []);

    useEffect(() => {
        fetchFalseExitAlerts();
        const id = setInterval(fetchFalseExitAlerts, 30_000);
        return () => clearInterval(id);
    }, [fetchFalseExitAlerts]);

    useEffect(() => {
        if (!isConnected) return;
        const c1 = listenToEvent('visit.false_exit_reported', () => fetchFalseExitAlerts());
        const c2 = listenToEvent('visit.temporary_reenabled', () => fetchFalseExitAlerts());
        const c3 = listenToEvent('visit.false_exit_dismissed', () => fetchFalseExitAlerts());
        return () => { c1(); c2(); c3(); };
    }, [isConnected, listenToEvent, fetchFalseExitAlerts]);

    const goToFalseExit = (visitId?: string) => {
        setShowNotifications(false);
        router.push(visitId ? `/dashboard/visitors?filter=falseexit&visitId=${visitId}` : '/dashboard/visitors?filter=falseexit');
    };

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
                setShowNotifications(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState<number | null>(null);

    const handleSessionTimeout = useCallback(() => {
        localStorage.removeItem('biovisitor_token');
        localStorage.removeItem('biovisitor_user');
        window.location.href = '/?reason=timeout';
    }, []);

    useInactivityTimer(sessionTimeoutMinutes, handleSessionTimeout);

    React.useEffect(() => {
        const token = localStorage.getItem('biovisitor_token');
        if (!token) {
            window.location.href = '/';
        } else {
            setIsAuth(true);
            try {
                const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
                setCurrentUser({ fullName: stored.fullName || '', role: stored.role || 'OPERATOR', email: stored.email || '' });
                if (stored.sessionTimeoutMinutes && stored.sessionTimeoutMinutes > 0) {
                    setSessionTimeoutMinutes(stored.sessionTimeoutMinutes);
                }
            } catch { /* ignore */ }
        }
    }, []);

    if (isAuth === null) return null;

    const userRole = currentUser?.role ?? 'OPERATOR';
    const navItems = ALL_NAV.filter(item => {
        if (!item.roles.includes(userRole)) return false;
        if (userRole === 'OPERATOR' && item.permKey !== null) {
            return canViewPage(item.permKey);
        }
        return true;
    });
    const roleBadge = ROLE_BADGE[userRole] ?? ROLE_BADGE.OPERATOR;

    return (
        <div className="min-h-screen bg-suprema-gray-100 flex">
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-suprema-gray-900/80 backdrop-blur-sm lg:hidden transition-opacity"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-suprema-gray-100/80 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:w-72 flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
                <div className="h-16 flex items-center px-6 border-b border-suprema-gray-100/80 justify-between lg:justify-center">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-white shadow-sm border border-suprema-gray-100 flex items-center justify-center flex-shrink-0">
                            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                        <span className="font-bold text-lg text-suprema-gray-900 tracking-tight">BioVisitor</span>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-suprema-gray-800/60 hover:text-suprema-gray-900">
                        <X size={20} />
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1.5">
                    <div className="mb-6 px-2">
                        <p className="text-xs font-semibold text-suprema-gray-800/40 uppercase tracking-wider">{t('nav.mainMenu')}</p>
                    </div>
                    {navItems.map((item) => {
                        const isActive = item.href === '/dashboard'
                            ? pathname === '/dashboard'
                            : pathname === item.href || pathname.startsWith(item.href + '/');
                        return (
                            <Link
                                key={item.key}
                                href={item.href}
                                className={`
                  group flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200
                  ${isActive
                                        ? 'bg-suprema-burgundy/10 text-suprema-burgundy'
                                        : 'text-suprema-gray-800/70 hover:bg-suprema-gray-100/80 hover:text-suprema-gray-900'
                                    }
                `}
                            >
                                <item.icon
                                    className={`flex-shrink-0 mr-3 h-5 w-5 transition-colors duration-200
                    ${isActive ? 'text-suprema-burgundy' : 'text-suprema-gray-800/40 group-hover:text-suprema-gray-800/70'}
                  `}
                                />
                                {t(item.key)}
                                {'comingSoon' in item && !!item.comingSoon && (
                                    <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-suprema-burgundy/10 text-suprema-burgundy">
                                        {t('nav.soon')}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-suprema-gray-100/80">
                    <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-suprema-gray-100/50">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-suprema-gray-800 to-suprema-gray-900 flex items-center justify-center text-white font-semibold text-sm shadow-inner uppercase flex-shrink-0">
                            {currentUser?.fullName?.substring(0, 2) || 'AD'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-suprema-gray-900 truncate">
                                {currentUser?.fullName || 'Usuario'}
                            </p>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${roleBadge.color}`}>
                                <UserCheck size={9} />
                                {roleBadge.label}
                            </span>
                        </div>
                        <button
                            onClick={() => setShowChangePassword(true)}
                            className="text-suprema-gray-800/40 hover:text-suprema-burgundy transition-colors p-1.5 rounded-lg hover:bg-white"
                            title="Cambiar contraseña"
                        >
                            <KeyRound size={16} />
                        </button>
                        <button
                            onClick={() => {
                                localStorage.removeItem('biovisitor_token');
                                localStorage.removeItem('biovisitor_user');
                                window.location.href = '/';
                            }}
                            className="text-suprema-gray-800/40 hover:text-suprema-burgundy transition-colors p-1.5 rounded-lg hover:bg-white"
                            title={t('user.logout')}
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {showChangePassword && (
                <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
            )}

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 bg-white/80 backdrop-blur-md border-b border-suprema-gray-100/80 flex items-center justify-between px-4 sm:px-6 lg:px-8 z-30 sticky top-0">
                    <div className="flex items-center text-suprema-gray-900">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="mr-4 lg:hidden p-2 rounded-lg hover:bg-suprema-gray-100 text-suprema-gray-800/70 transition-colors"
                        >
                            <Menu size={20} />
                        </button>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative group">
                            <button className="relative p-2 text-suprema-gray-800/60 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-full transition-colors flex items-center gap-1">
                                <Globe size={20} />
                                <span className="text-xs font-bold uppercase hidden sm:block">{localeDisplayCodes[locale]}</span>
                            </button>
                            <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-lg border border-suprema-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                <div className="p-2 space-y-1">
                                    {locales.map(loc => (
                                        <button
                                            key={loc}
                                            onClick={() => setLocale(loc)}
                                            className={`w-full text-left px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${locale === loc ? 'bg-suprema-burgundy/10 text-suprema-burgundy' : 'hover:bg-suprema-gray-50 text-suprema-gray-700 hover:text-suprema-burgundy'}`}
                                        >
                                            {localeLabels[loc]}
                                            {locale === loc && <span className="ml-1 text-xs">✓</span>}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="relative" ref={notifRef}>
                            <button
                                onClick={() => setShowNotifications(!showNotifications)}
                                className="relative p-2 text-suprema-gray-800/60 hover:text-suprema-gray-900 hover:bg-suprema-gray-100 rounded-full transition-colors"
                            >
                                <Bell size={20} />
                                {falseExitAlerts.length > 0 && (
                                    <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white animate-pulse">
                                        {falseExitAlerts.length}
                                    </span>
                                )}
                            </button>
                            {showNotifications && (
                                <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl shadow-lg border border-suprema-gray-100 z-50 overflow-hidden">
                                    <div className="p-4 pb-2 flex items-center justify-between">
                                        <p className="text-sm font-semibold text-suprema-gray-900">{t('notifications.title')}</p>
                                        {falseExitAlerts.length > 0 && (
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full">
                                                {falseExitAlerts.length}
                                            </span>
                                        )}
                                    </div>
                                    {falseExitAlerts.length === 0 ? (
                                        <p className="text-xs text-suprema-gray-800/60 px-4 pb-4">{t('notifications.empty')}</p>
                                    ) : (
                                        <div className="max-h-72 overflow-y-auto">
                                            {falseExitAlerts.map(alert => (
                                                <button
                                                    key={alert.visitId}
                                                    onClick={() => goToFalseExit(alert.visitId)}
                                                    className="w-full text-left px-4 py-2.5 border-t border-suprema-gray-100 hover:bg-red-50/60 transition-colors flex items-start gap-2"
                                                >
                                                    <span className="mt-0.5 h-2 w-2 rounded-full bg-red-600 animate-pulse flex-shrink-0" />
                                                    <span className="min-w-0">
                                                        <span className="block text-xs font-semibold text-suprema-gray-900 truncate">
                                                            Falsa salida reportada
                                                        </span>
                                                        <span className="block text-xs text-suprema-gray-800/70 truncate">{alert.visitorName}</span>
                                                        {alert.falseExitReportedAt && (
                                                            <span className="block text-[10px] text-suprema-gray-800/50">
                                                                {new Date(alert.falseExitReportedAt).toLocaleString()}
                                                            </span>
                                                        )}
                                                    </span>
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => goToFalseExit()}
                                                className="w-full text-center px-4 py-2 text-xs font-semibold text-suprema-burgundy hover:bg-suprema-gray-50 border-t border-suprema-gray-100"
                                            >
                                                Ver todas en Visitantes
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
