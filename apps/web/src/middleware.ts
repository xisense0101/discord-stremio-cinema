import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, AUTH_COOKIE_NAME } from './lib/auth';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Allow static files, favicon, login page, and login api
  if (
    path.startsWith('/_next') ||
    path.startsWith('/favicon.ico') ||
    path === '/login' ||
    path === '/api/auth/login'
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized. Please login.' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { valid } = await verifySessionToken(token);
  if (!valid) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Session expired. Please login again.' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
