import { NextRequest, NextResponse } from 'next/server';
import { sendWorkerCommand, DEFAULT_GUILD_ID, DEFAULT_VOICE_CHANNEL_ID } from '@/lib/worker-client';
import { resolveMediaStreams } from '@discord-stremio/metadata';
import { getStoredSettings } from '@/lib/settings-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let {
      mediaItem,
      quality,
      guildId,
      voiceChannelId,
      initialTime = 0,
    } = body;

    if (!mediaItem || !mediaItem.imdbId) {
      return NextResponse.json({ success: false, error: 'Valid mediaItem with imdbId required' }, { status: 400 });
    }

    // Load active settings from file store
    const settings = getStoredSettings();
    guildId = guildId || settings.selectedGuildId || DEFAULT_GUILD_ID;
    voiceChannelId = voiceChannelId || settings.selectedVoiceChannelId || DEFAULT_VOICE_CHANNEL_ID;
    // Always fall back to user's saved defaultQuality if quality is not explicitly passed
    const targetQuality = quality || settings.defaultQuality || '720p';

    console.log(`[API:Play] Playing "${mediaItem.name}" to Guild: ${guildId}, VoiceChannel: ${voiceChannelId} (Target Quality: ${targetQuality})`);

    // Resolve optimal stream matching target quality
    const streams = await resolveMediaStreams(mediaItem.type || 'movie', mediaItem.imdbId, undefined, undefined, targetQuality);
    if (!streams || streams.length === 0) {
      return NextResponse.json({ success: false, error: 'No cached TorBox stream found for this title' }, { status: 404 });
    }

    const selectedStream = streams[0];

    // Open media in worker session with the resolved target quality
    const res = await sendWorkerCommand(
      'OPEN_MEDIA',
      {
        streamUrl: selectedStream.url,
        title: mediaItem.name,
        imdbId: mediaItem.imdbId,
        type: mediaItem.type || 'movie',
        quality: selectedStream.quality || targetQuality,
        voiceChannelId,
        initialTime,
      },
      guildId,
      voiceChannelId
    );

    return NextResponse.json({
      success: res.success,
      state: res.state,
      stream: selectedStream,
      targetQuality,
      error: res.error,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
