import { NextRequest, NextResponse } from 'next/server';

/**
 * Internal URL used by middleware (server-side) to reach the NestJS backend.
 * Set BACKEND_INTERNAL_URL in your environment for non-default deployments.
 * The Next.js rewrite proxy is not available inside middleware fetch() calls,
 * so we call the backend directly via this URL.
 */
const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001';

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
};

export async function middleware(request: NextRequest) {
  // Short-circuit: if the browser already carries an auth session cookie the
  // user is logged in — skip the setup check entirely.
  // (Tokens are currently stored in localStorage; this guard future-proofs a
  //  cookie-based auth migration without any further middleware changes.)
  if (request.cookies.has('biovisitor_token')) {
    return NextResponse.next();
  }

  try {
    const res = await fetch(
      `${BACKEND_INTERNAL_URL}/api/v1/auth/system-status`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      },
    );

    if (res.ok) {
      const data = await res.json();
      if (data?.needsSetup === true) {
        return NextResponse.redirect(new URL('/', request.url));
      }
      // needsSetup === false — system is configured, let the request through.
      return NextResponse.next();
    }

    // Non-2xx from the backend (e.g. 500): redirect to the login page so the
    // user hits a meaningful entry point rather than a broken dashboard.
    return NextResponse.redirect(new URL('/', request.url));
  } catch {
    // Backend unreachable (timeout, connection refused, etc.) — fail-closed.
    // Redirect to the login page; the user will see a clear error when they
    // attempt to authenticate, rather than a silent broken dashboard.
    return NextResponse.redirect(new URL('/', request.url));
  }
}
