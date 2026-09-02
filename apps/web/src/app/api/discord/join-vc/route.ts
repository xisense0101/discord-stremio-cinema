import { NextRequest, NextResponse } from 'next/server';
import { sendWorkerCommand } from '@/lib/worker-client';
import { saveStoredSettings } from '@/lib/settings-store';

export async function POST(req: NextRequest) {
  try {
    const { guildId, voiceChannelId } = await req.json();
    if (!guildId || !voiceChannelId) {
      return NextResponse.json({ success: false, error: 'guildId and voiceChannelId are required' }, { status: 400 });
    }

    console.log(`[API:JoinVC] Requesting worker to join Guild: ${guildId}, VoiceChannel: ${voiceChannelId}`);

    const result = await sendWorkerCommand(
      'SWITCH_VOICE_CHANNEL',
      { guildId, voiceChannelId },
      guildId,
      voiceChannelId
    );

    // Persist this active choice so future plays and queues target this channel.
    // Awaited so the write has actually completed (on the worker's durable
    // disk, not this app's own ephemeral filesystem) before this response
    // returns - the UI polls /api/settings right after this call resolves.
    await saveStoredSettings({
      selectedGuildId: guildId,
      selectedVoiceChannelId: voiceChannelId,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
