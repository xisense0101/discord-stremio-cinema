import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '@/lib/worker-client';

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    const res = await fetch(`${WORKER_URL}/api/discord/user-vc?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
