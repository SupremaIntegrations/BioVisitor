'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function ExitDevicesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/settings/auto-checkout');
  }, [router]);

  return (
    <div className="flex items-center justify-center gap-2 py-16 text-suprema-gray-800/50">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">Esta sección ahora forma parte de Autocheckout…</span>
    </div>
  );
}
