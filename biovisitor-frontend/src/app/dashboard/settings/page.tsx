'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Server, ChevronRight, Settings2, Users, TimerOff, Database, ShieldCheck, Mail, QrCode, Cpu } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';

const settingsSections = [
  {
    href: '/dashboard/settings/operators',
    icon: ShieldCheck,
    title: 'Operadores del Sistema',
    description:
      'Crea y gestiona usuarios ADMIN y OPERATOR. Define permisos granulares por módulo, sedes asignadas y políticas de ciberseguridad para cada operador.',
    badge: 'Solo ADMIN',
    badgeColor: 'bg-suprema-burgundy/10 text-suprema-burgundy',
    adminOnly: true,
  },
  {
    href: '/dashboard/settings/suprema',
    icon: Server,
    title: 'Conexión a API de Suprema',
    description:
      'Gestiona las conexiones al servidor BioStar 2 y BioStar X. Soporta múltiples conexiones simultáneas con cifrado AES-256.',
    badge: 'BioStar 2 / X',
    badgeColor: 'bg-blue-50 text-blue-700',
  },
  {
    href: '/dashboard/settings/hosts',
    icon: Users,
    title: 'Gestión de Anfitriones',
    description:
      'Administra los empleados que pueden recibir visitantes. Crea anfitriones localmente o impórtalos desde el directorio de usuarios de BioStar.',
    badge: 'Local / BioStar',
    badgeColor: 'bg-emerald-50 text-emerald-700',
  },
  {
    href: '/dashboard/settings/auto-checkout',
    icon: TimerOff,
    title: 'Autocheckout',
    description:
      'Configura el cierre automático nocturno de visitas, los defaults por tipo de visitante y los dispositivos de salida (lectores/torniquetes) para checkout en tiempo real por evento.',
    badge: 'Automatización',
    badgeColor: 'bg-amber-50 text-amber-700',
  },
  {
    href: '/dashboard/settings/data-retention',
    icon: Database,
    title: 'Retención de datos',
    description:
      'Define el período de conservación de registros de visitantes. Pasado ese tiempo, los datos se eliminan automáticamente en cumplimiento con GDPR, Ley 1581 y otras normativas de privacidad.',
    badge: 'Privacidad / GDPR',
    badgeColor: 'bg-violet-50 text-violet-700',
  },
  {
    href: '/dashboard/settings/checkin-notification',
    icon: Mail,
    title: 'Notificación al anfitrión',
    description:
      'Personaliza el asunto y cuerpo del correo que recibe el anfitrión cuando su visitante realiza check-in. Soporta variables dinámicas como nombre, empresa y motivo de visita.',
    badge: 'Email / Mensajes',
    badgeColor: 'bg-sky-50 text-sky-700',
  },
  {
    href: '/dashboard/settings/qr',
    icon: QrCode,
    title: 'QR Dinámico',
    description:
      'Configura el tiempo de vigencia del código QR en el portal del visitante y si se muestra o no el botón de renovación manual.',
    badge: 'Acceso QR',
    badgeColor: 'bg-amber-50 text-amber-700',
  },
  {
    href: '/dashboard/settings/enrollers',
    icon: Cpu,
    title: 'Dispositivos Enroladores',
    description:
      'Define qué dispositivos BioStar (FaceStation, BioStation, etc.) se usan en recepción para capturar biometría del visitante directamente desde el panel de registro.',
    badge: 'Biométrico',
    badgeColor: 'bg-violet-50 text-violet-700',
  },
];

export default function SettingsPage() {
  const { canViewPage, isAdmin } = usePermissions();

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('biovisitor_user') || '{}');
    if (stored.role === 'OPERATOR' && !canViewPage('settings')) window.location.href = '/dashboard';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleSections = settingsSections.filter(s => {
    if (s.adminOnly && !isAdmin) return false;
    return true;
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-suprema-burgundy/10 flex items-center justify-center">
          <Settings2 className="w-5 h-5 text-suprema-burgundy" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-suprema-gray-900">Configuración</h1>
          <p className="text-sm text-suprema-gray-800/60">
            Administra integraciones y parámetros del sistema
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {visibleSections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group flex items-center gap-4 p-5 bg-white rounded-2xl border border-suprema-gray-100/80 hover:border-suprema-burgundy/30 hover:shadow-md transition-all duration-200"
          >
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-suprema-gray-100/60 group-hover:bg-suprema-burgundy/10 flex items-center justify-center transition-colors duration-200">
              <section.icon className="w-6 h-6 text-suprema-gray-800/50 group-hover:text-suprema-burgundy transition-colors duration-200" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-suprema-gray-900">
                  {section.title}
                </p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${section.badgeColor}`}>
                  {section.badge}
                </span>
              </div>
              <p className="text-xs text-suprema-gray-800/60 leading-relaxed">
                {section.description}
              </p>
            </div>
            <ChevronRight className="flex-shrink-0 w-4 h-4 text-suprema-gray-800/30 group-hover:text-suprema-burgundy transition-colors duration-200" />
          </Link>
        ))}
      </div>
    </div>
  );
}
