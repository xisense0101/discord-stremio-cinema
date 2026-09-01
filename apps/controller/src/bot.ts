import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from 'discord.js';
import config from '@discord-stremio/config';
import {
  slashCommands,
  handleSlashCommand,
  handleComponentInteraction,
  activePlayerMessages,
  ipcClient,
} from '@discord-stremio/discord-controller';
import { createPlayerEmbed, createPlayerControlRows } from '@discord-stremio/diagnostics';

export class DiscordBotController {
  private client: Client;
  private tickerInterval: NodeJS.Timeout | null = null;
  private isUpdating: boolean = false;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('clientReady', async () => {
      console.log(`[Controller] Logged in as: ${this.client.user?.tag} (${this.client.user?.id})`);
      await this.registerSlashCommands();
      this.startLiveTicker();
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await handleSlashCommand(interaction);
        } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
          await handleComponentInteraction(interaction);
        }
      } catch (err) {
        console.error('[Controller] Interaction handler notice:', (err as Error).message);
      }
    });
  }

  private startLiveTicker(): void {
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this.tickerInterval = setInterval(async () => {
      if (this.isUpdating) return;
      this.isUpdating = true;
      try {
        for (const [guildId, msg] of activePlayerMessages.entries()) {
          try {
            const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
            if (stateRes.success && stateRes.state && stateRes.state.status === 'PLAYING') {
              const embed = createPlayerEmbed(stateRes.state);
              const rows = createPlayerControlRows(stateRes.state);
              await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
            }
          } catch {
            // Ignore transient message edit errors
          }
        }
      } finally {
        this.isUpdating = false;
      }
    }, 20000);
  }

  private async registerSlashCommands(): Promise<void> {
    const clientId = this.client.user?.id || config.discord.clientId;
    if (!clientId) {
      console.warn('[Controller] DISCORD_CLIENT_ID missing, registering via client.application.commands...');
      if (this.client.application) {
        await this.client.application.commands.set(slashCommands);
        console.log(`[Controller] Successfully registered ${slashCommands.length} slash commands globally.`);
      }
      return;
    }

    try {
      console.log(`[Controller] Registering ${slashCommands.length} global slash commands...`);
      const rest = new REST({ version: '10' }).setToken(config.discord.controllerToken);
      await rest.put(Routes.applicationCommands(clientId), {
        body: slashCommands.map((cmd) => cmd.toJSON()),
      });
      console.log('[Controller] Slash commands registered successfully.');
    } catch (err) {
      console.error('[Controller] Failed to register slash commands:', err);
    }
  }

  async start(): Promise<void> {
    console.log('[Controller] Logging in bot client...');
    await this.client.login(config.discord.controllerToken);
  }

  async stop(): Promise<void> {
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this.client.destroy();
  }

  isReady(): boolean {
    return Boolean(this.client.isReady());
  }
}

export const botController = new DiscordBotController();
