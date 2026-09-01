import { NextRequest, NextResponse } from 'next/server';
import { AUTH_USER, AUTH_PASS, AUTH_COOKIE_NAME, SEVEN_DAYS_SECONDS, createSessionToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (username !== AUTH_USER || password !== AUTH_PASS) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    const token = await createSessionToken(username);

    const response = NextResponse.json({
      success: true,
      message: 'Login successful. Session valid for 7 days.',
      user: username,
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SEVEN_DAYS_SECONDS,
      path: '/',
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
