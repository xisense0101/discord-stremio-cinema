import { NextRequest, NextResponse } from 'next/server';
import { sendWorkerCommand, DEFAULT_GUILD_ID } from '@/lib/worker-client';

export async function POST(req: NextRequest) {
  try {
    const { action, payload, guildId = DEFAULT_GUILD_ID } = await req.json();

    if (!action) {
      return NextResponse.json({ success: false, error: 'Action required' }, { status: 400 });
    }

    const res = await sendWorkerCommand(action, payload, guildId);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
