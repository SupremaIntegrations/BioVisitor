import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === 'production';
const replitDomain = process.env.REPLIT_DEV_DOMAIN ?? '';

const nextConfig: NextConfig = {
  // SPA estático servido por nginx (windows-deployment/assets/nginx.conf.template)
  // en producción. nginx hace lo que antes hacían las rewrites() de aquí
  // (proxy de /api/v1 y /socket.io al backend) y lo que hacía server-https.js
  // (TLS, redirección HTTP->HTTPS). output: 'export' no soporta
  // rewrites()/redirects()/headers() — por eso ya no están aquí.
  output: 'export',
  turbopack: {},
  ...(!isProduction && {
    allowedDevOrigins: [
      "127.0.0.1",
      ...(replitDomain ? [replitDomain] : ["*.picard.replit.dev"]),
    ],
  }),
};

export default nextConfig;
