import { NextRequest, NextResponse } from 'next/server';
import { sendWorkerCommand, DEFAULT_GUILD_ID, WORKER_URL, workerAuthHeaders } from '@/lib/worker-client';

export const dynamic = 'force-dynamic';

/**
 * Both the player state and the queue come from the worker, which is the only
 * process that owns either. The queue used to be read from
 * @discord-stremio/queue's in-memory fallback store here, which is per
 * serverless instance - so this endpoint (polled by the UI every couple of
 * seconds) returned the real queue or an empty one depending on which
 * instance happened to serve the request. See apps/stream-worker/src/queue-store.ts.
 */
export async function GET(req: NextRequest) {
  const guildId = req.nextUrl.searchParams.get('guildId') || DEFAULT_GUILD_ID;

  const [workerRes, queueRes] = await Promise.all([
    sendWorkerCommand('GET_STATE', {}, guildId),
    fetch(`${WORKER_URL}/api/queue?guildId=${encodeURIComponent(guildId)}`, {
      headers: workerAuthHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  return NextResponse.json({
    success: true,
    state: workerRes.state || null,
    // null (worker unreachable) is reported distinctly from [] (genuinely
    // empty) so the UI never redraws a populated queue as empty just because
    // one poll failed.
    queue: queueRes?.items ?? null,
    queueAvailable: queueRes !== null,
    workerConnected: workerRes.success,
  });
}
