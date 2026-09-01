import { NextRequest, NextResponse } from 'next/server';
import { sendWorkerCommand, DEFAULT_GUILD_ID } from '@/lib/worker-client';
import { queueManager } from '@discord-stremio/queue';

export async function GET(req: NextRequest) {
  const guildId = req.nextUrl.searchParams.get('guildId') || DEFAULT_GUILD_ID;

  const [workerRes, queueItems] = await Promise.all([
    sendWorkerCommand('GET_STATE', {}, guildId),
    queueManager.list(guildId).catch(() => []),
  ]);

  return NextResponse.json({
    success: true,
    state: workerRes.state || null,
    queue: queueItems,
    workerConnected: workerRes.success,
  });
}
