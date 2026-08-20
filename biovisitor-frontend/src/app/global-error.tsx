'use client';

export const dynamic = 'force-dynamic';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'sans-serif', background: '#f5f5f5' }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#a12944', margin: 0 }}>
            BioVisitor X — Error inesperado
          </h1>
          <p style={{ color: '#555', maxWidth: '400px', margin: 0 }}>
            Ocurrió un error crítico en la aplicación.
            {error?.digest && (
              <span style={{ display: 'block', fontSize: '12px', marginTop: '8px', color: '#999' }}>
                Código: {error.digest}
              </span>
            )}
          </p>
          <button
            onClick={reset}
            style={{
              padding: '10px 24px',
              background: '#a12944',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
