import { NextResponse } from 'next/server';
import { WORKER_URL } from '@/lib/worker-client';

export async function GET() {
  try {
    const res = await fetch(`${WORKER_URL}/api/discord/guilds`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ success: false, guilds: [] });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message, guilds: [] }, { status: 500 });
  }
}
