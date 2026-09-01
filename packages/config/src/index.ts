import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file from all potential monorepo locations
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const ConfigSchema = z.object({
  DISCORD_CONTROLLER_TOKEN: z.string().min(1, 'DISCORD_CONTROLLER_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_STREAMER_TOKEN: z.string().min(1, 'DISCORD_STREAMER_TOKEN is required'),

  TORBOX_API_KEY: z.string().optional().default('6eb85715-b543-41c3-ba65-25d0af51edd8'),
  RESOLVER_MODE: z.enum(['torbox-direct', 'aiostreams']).default('aiostreams'),
  AIOSTREAMS_URL: z.string().default('https://aiostreams.elfhosted.com/stremio/7ed277cb-23c5-47c7-bed8-422e3095a99f/eyJpIjoicndwc3NHYXF6RFZ3b0YzUXpZY0JEQT09IiwiZSI6ImRiZVpDK21TeHgwVTBjV0REYk5CRmt5cVFkVzBrOWhObGNCNHZhYXBtVHM9IiwidCI6ImEifQ/manifest.json'),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  DATABASE_URL: z.string().default('sqlite://./data/stremio_player.db'),

  STREAM_WIDTH: z.coerce.number().default(1920),
  STREAM_HEIGHT: z.coerce.number().default(1080),
  STREAM_FPS: z.coerce.number().default(30),
  STREAM_BITRATE_KBPS: z.coerce.number().default(6000),
  STREAM_MAX_BITRATE_KBPS: z.coerce.number().default(8000),
  STREAM_AUDIO_BITRATE_KBPS: z.coerce.number().default(128),

  PUPPETEER_HEADLESS: z.coerce.boolean().default(true),
  CHROME_EXECUTABLE_PATH: z.string().default('/usr/bin/google-chrome'),

  PORT: z.coerce.number().default(4000),
  WORKER_PORT: z.coerce.number().default(4001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type RawConfig = z.infer<typeof ConfigSchema>;

let parsedConfig: RawConfig;
try {
  parsedConfig = ConfigSchema.parse(process.env);
} catch (err: any) {
  if (err instanceof z.ZodError) {
    console.error('❌ Configuration validation error:', JSON.stringify(err.format(), null, 2));
  } else {
    console.error('❌ Configuration error:', err);
  }
  // Fallback defaults for safety during bootstrap
  parsedConfig = ConfigSchema.parse({
    DISCORD_CONTROLLER_TOKEN: process.env.DISCORD_CONTROLLER_TOKEN || 'MISSING_CONTROLLER_TOKEN',
    DISCORD_STREAMER_TOKEN: process.env.DISCORD_STREAMER_TOKEN || 'MISSING_STREAMER_TOKEN',
  });
}

export const config = {
  discord: {
    controllerToken: parsedConfig.DISCORD_CONTROLLER_TOKEN,
    clientId: parsedConfig.DISCORD_CLIENT_ID,
    streamerToken: parsedConfig.DISCORD_STREAMER_TOKEN,
  },
  torbox: {
    apiKey: parsedConfig.TORBOX_API_KEY,
    resolverMode: parsedConfig.RESOLVER_MODE,
    aiostreamsUrl: parsedConfig.AIOSTREAMS_URL,
  },
  redis: {
    url: parsedConfig.REDIS_URL,
  },
  database: {
    url: parsedConfig.DATABASE_URL,
  },
  stream: {
    width: parsedConfig.STREAM_WIDTH,
    height: parsedConfig.STREAM_HEIGHT,
    fps: parsedConfig.STREAM_FPS,
    bitrateKbps: parsedConfig.STREAM_BITRATE_KBPS,
    maxBitrateKbps: parsedConfig.STREAM_MAX_BITRATE_KBPS,
    audioBitrateKbps: parsedConfig.STREAM_AUDIO_BITRATE_KBPS,
  },
  browser: {
    headless: parsedConfig.PUPPETEER_HEADLESS,
    chromePath: parsedConfig.CHROME_EXECUTABLE_PATH,
    dataDir: path.resolve(process.cwd(), 'data/chromium-profiles'),
  },
  server: {
    port: parsedConfig.PORT,
    workerPort: parsedConfig.WORKER_PORT,
    isProduction: parsedConfig.NODE_ENV === 'production',
  },
};

export default config;
