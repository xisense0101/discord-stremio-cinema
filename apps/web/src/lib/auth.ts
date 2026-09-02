import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const isProduction = process.env.NODE_ENV === 'production';

// Fail closed in production instead of silently signing sessions with a
// secret/password that's sitting in source control. Dev keeps a fallback
// for local convenience only.
if (isProduction && (!process.env.JWT_SECRET || !process.env.WEB_PASSWORD)) {
  throw new Error(
    'JWT_SECRET and WEB_PASSWORD must be set in production - refusing to boot with a default/hardcoded credential.'
  );
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-only-insecure-secret-do-not-use-in-production'
);

export const AUTH_COOKIE_NAME = 'stremio_cinema_session';
export const AUTH_USER = process.env.WEB_USERNAME || 'senzu';
export const AUTH_PASS = process.env.WEB_PASSWORD || 'dev-only-insecure-password';
export const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604800s (7 days)

export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({ user: username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<{ valid: boolean; user?: string }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { valid: true, user: payload.user as string };
  } catch {
    return { valid: false };
  }
}

export async function getServerSession(): Promise<{ valid: boolean; user?: string }> {
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return { valid: false };
  return verifySessionToken(token);
}
