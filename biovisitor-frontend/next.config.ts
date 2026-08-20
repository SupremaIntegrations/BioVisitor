import type { NextConfig } from "next";
import path from "path";

const isProduction = process.env.NODE_ENV === 'production';
const replitDomain = process.env.REPLIT_DEV_DOMAIN ?? '';

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {},
  outputFileTracingRoot: path.join(__dirname, './'),
  outputFileTracingExcludes: {
    '*': [
      'node_modules/face-api.js/**',
      'node_modules/@tensorflow/**',
      'node_modules/tfjs-image-recognition-base/**',
      'node_modules/canvas/**',
      'node_modules/sharp/**',
    ],
  },
  ...(!isProduction && {
    allowedDevOrigins: [
      "127.0.0.1",
      ...(replitDomain ? [replitDomain] : ["*.picard.replit.dev"]),
    ],
  }),
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:3001/api/v1/:path*',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://localhost:3001/socket.io/:path*',
      },
    ];
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias as Record<string, unknown> ?? {}),
        'face-api.js': false,
        'tfjs-image-recognition-base': false,
        '@tensorflow/tfjs-core': false,
        '@tensorflow/tfjs-backend-webgl': false,
        '@tensorflow/tfjs-backend-cpu': false,
        '@tensorflow/tfjs-layers': false,
        '@tensorflow/tfjs': false,
      };
    }
    return config;
  },
};

export default nextConfig;
