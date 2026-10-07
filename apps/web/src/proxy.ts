import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S } from '@/lib/session-cookie';

const PUBLIC_PATHS = ['/login', '/register'];

/**
 * Optimistic checks only. Real authorization happens server-side on every page, action and
 * API route (getSession / requireSession), never here (PRD §21).
 */
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (!token) {
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/invite/') ||
      PUBLIC_PATHS.includes(pathname)
    ) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Sliding cookie: keep it alive as long as the database session is being renewed.
  const response = NextResponse.next();
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
