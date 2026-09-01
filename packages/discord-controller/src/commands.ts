import { SlashCommandBuilder } from 'discord.js';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('movie')
    .setDescription('Search for a movie and start streaming in your voice channel')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Movie title or search keyword (e.g. Interstellar)').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('quality')
        .setDescription('Initial video quality (default: 720p HD)')
        .setRequired(false)
        .addChoices(
          { name: '4K UHD (3840x2160 • 12 Mbps)', value: '4k' },
          { name: '2K QHD (2560x1440 • 8 Mbps)', value: '2k' },
          { name: '1080p FHD (1920x1080 • 5 Mbps)', value: '1080p' },
          { name: '720p HD (1280x720 • 2.5 Mbps)', value: '720p' },
          { name: '480p SD (854x480 • 1.2 Mbps)', value: '480p' }
        )
    ),

  new SlashCommandBuilder()
    .setName('series')
    .setDescription('Search for a TV series and stream episodes')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Series title or search keyword').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('quality')
        .setDescription('Initial video quality (default: 720p HD)')
        .setRequired(false)
        .addChoices(
          { name: '4K UHD (3840x2160 • 12 Mbps)', value: '4k' },
          { name: '2K QHD (2560x1440 • 8 Mbps)', value: '2k' },
          { name: '1080p FHD (1920x1080 • 5 Mbps)', value: '1080p' },
          { name: '720p HD (1280x720 • 2.5 Mbps)', value: '720p' },
          { name: '480p SD (854x480 • 1.2 Mbps)', value: '480p' }
        )
    ),

  new SlashCommandBuilder()
    .setName('stream')
    .setDescription('Stream a movie, series, or direct media URL')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Title or video stream URL').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('quality')
        .setDescription('Initial video quality (default: 720p HD)')
        .setRequired(false)
        .addChoices(
          { name: '4K UHD (3840x2160 • 12 Mbps)', value: '4k' },
          { name: '2K QHD (2560x1440 • 8 Mbps)', value: '2k' },
          { name: '1080p FHD (1920x1080 • 5 Mbps)', value: '1080p' },
          { name: '720p HD (1280x720 • 2.5 Mbps)', value: '720p' },
          { name: '480p SD (854x480 • 1.2 Mbps)', value: '480p' }
        )
    ),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a movie or direct media stream')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Movie title or video URL').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('quality')
        .setDescription('Initial video quality (default: 720p HD)')
        .setRequired(false)
        .addChoices(
          { name: '4K UHD (3840x2160 • 12 Mbps)', value: '4k' },
          { name: '2K QHD (2560x1440 • 8 Mbps)', value: '2k' },
          { name: '1080p FHD (1920x1080 • 5 Mbps)', value: '1080p' },
          { name: '720p HD (1280x720 • 2.5 Mbps)', value: '720p' },
          { name: '480p SD (854x480 • 1.2 Mbps)', value: '480p' }
        )
    ),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause current movie playback'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume paused movie playback'),

  new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek playback to a specific timestamp')
    .addStringOption((opt) =>
      opt.setName('time').setDescription('Target time in seconds or format HH:MM:SS / MM:SS').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('forward')
    .setDescription('Fast forward playback by seconds')
    .addIntegerOption((opt) =>
      opt.setName('seconds').setDescription('Seconds to advance (default: 10)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('rewind')
    .setDescription('Rewind playback by seconds')
    .addIntegerOption((opt) =>
      opt.setName('seconds').setDescription('Seconds to rewind (default: 10)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and disconnect the stream worker'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Display upcoming media in the server queue'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the currently playing movie to the next in queue'),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Display the interactive remote control for the currently playing movie'),

  new SlashCommandBuilder()
    .setName('subtitles')
    .setDescription('Select active subtitle language overlay without reloading video')
    .addStringOption((opt) =>
      opt.setName('language').setDescription('Subtitle language (e.g. English, Spanish, Off)').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('subdelay')
    .setDescription('Adjust subtitle synchronization delay in seconds (+1.5s to delay, -0.5s to advance, 0 to reset)')
    .addNumberOption((opt) =>
      opt.setName('offset').setDescription('Timing offset in seconds (e.g. 1.5, -0.5, 0)').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('audio')
    .setDescription('Select audio track for the current stream')
    .addStringOption((opt) =>
      opt.setName('track').setDescription('Audio track ID or language').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('quality')
    .setDescription('Select stream video resolution & bitrate')
    .addStringOption((opt) =>
      opt
        .setName('resolution')
        .setDescription('Target resolution (4K, 2K, 1080p FHD, 720p HD, 480p SD)')
        .setRequired(true)
        .addChoices(
          { name: '4K UHD (3840x2160 • 12 Mbps)', value: '4k' },
          { name: '2K QHD (2560x1440 • 8 Mbps)', value: '2k' },
          { name: '1080p FHD (1920x1080 • 5 Mbps)', value: '1080p' },
          { name: '720p HD (1280x720 • 2.5 Mbps)', value: '720p' },
          { name: '480p SD (854x480 • 1.2 Mbps)', value: '480p' }
        )
    ),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency and health status'),

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administrative and diagnostic utilities')
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('View health, system metrics, and stream transport status')
    ),
];
