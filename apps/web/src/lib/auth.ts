import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'discord-stremio-cinema-secret-key-2026-secure-session'
);

export const AUTH_COOKIE_NAME = 'stremio_cinema_session';
export const AUTH_USER = process.env.WEB_USERNAME || 'senzu';
export const AUTH_PASS = process.env.WEB_PASSWORD || 'herewegoagain';
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
