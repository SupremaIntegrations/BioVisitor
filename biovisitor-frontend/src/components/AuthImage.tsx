'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface AuthImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}

export default function AuthImage({ src, alt, className, fallback }: AuthImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadImage = async () => {
      try {
        const response = await api.get(src, { responseType: 'blob' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(response.data);
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    setBlobUrl(null);
    setFailed(false);
    loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed || !blobUrl) {
    return <>{fallback || null}</>;
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}
