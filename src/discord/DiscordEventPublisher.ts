import { type Client, WebhookClient } from "discord.js";

import { renderDeathNotification, type PlayerDeathEvent } from "../conan/logs/parseDeathEvent.js";
import type { DiscordGameChatDestination } from "../chat/relayConanMessageToDiscord.js";
import type { DeathEventPublisher } from "../tracking/DeathTracker.js";
import type { PlayerEventPublisher } from "../tracking/PlayerTracker.js";
import type { RelayDatabase } from "../storage/RelayDatabase.js";

interface PendingDiscordEvent {
  createdAt: number;
  publish: () => Promise<void>;
}

export interface DiscordPublisherSettings {
  chatChannelIdentifier: string;
  eventChannelIdentifier: string;
  deathChannelIdentifier?: string;
  statusChannelIdentifier?: string;
  pendingEventLimit: number;
  gameChatRendering: "bot" | "webhook";
  gameChatWebhookUrl?: string;
}

export class DiscordEventPublisher
  implements DiscordGameChatDestination, DeathEventPublisher, PlayerEventPublisher
{
  readonly #client: Client;
  readonly #database: RelayDatabase;
  readonly #settings: DiscordPublisherSettings;
  readonly #pendingEvents: PendingDiscordEvent[] = [];
  readonly #webhookClient?: WebhookClient;
  #acceptingEvents = true;
  #flushing = false;

  public constructor(client: Client, database: RelayDatabase, settings: DiscordPublisherSettings) {
    this.#client = client;
    this.#database = database;
    this.#settings = settings;
    if (settings.gameChatRendering === "webhook" && settings.gameChatWebhookUrl !== undefined) {
      this.#webhookClient = new WebhookClient({ url: settings.gameChatWebhookUrl });
    }
    client.on("ready", () => {
      void this.flushPendingEvents();
    });
  }

  public async publishGameChat(playerName: string, message: string): Promise<void> {
    await this.#publishOrQueue(() => {
      if (this.#settings.gameChatRendering === "webhook") {
        const webhookClient = this.#webhookClient;
        if (webhookClient === undefined)
          throw new Error("Discord game-chat webhook is not configured.");
        return webhookClient
          .send({
            content: message,
            username: playerName.slice(0, 80),
            allowedMentions: { parse: [] },
          })
          .then(() => undefined);
      }
      return this.#sendToChannel(
        this.#settings.chatChannelIdentifier,
        `**${playerName}:** ${message}`,
      );
    });
  }

  public async publishPlayerJoined(playerName: string): Promise<void> {
    await this.#publishOrQueue(() =>
      this.#sendToChannel(
        this.#settings.eventChannelIdentifier,
        `${playerName} joined the server.`,
      ),
    );
  }

  public async publishPlayerLeft(playerName: string): Promise<void> {
    await this.#publishOrQueue(() =>
      this.#sendToChannel(this.#settings.eventChannelIdentifier, `${playerName} left the server.`),
    );
  }

  public async publishServerState(state: "online" | "offline"): Promise<void> {
    await this.#publishOrQueue(() =>
      this.#sendToChannel(
        this.#settings.eventChannelIdentifier,
        state === "online" ? "Conan server is online." : "Conan server is offline.",
      ),
    );
  }

  public async publishDeath(event: PlayerDeathEvent): Promise<void> {
    const channelIdentifier =
      this.#settings.deathChannelIdentifier ?? this.#settings.eventChannelIdentifier;
    await this.#publishOrQueue(() =>
      this.#sendToChannel(channelIdentifier, renderDeathNotification(event)),
    );
  }

  async #sendToChannel(channelIdentifier: string, content: string): Promise<void> {
    const channel = await this.#client.channels.fetch(channelIdentifier);
    if (channel === null || !channel.isSendable()) {
      throw new Error(
        `Discord channel ${channelIdentifier} is unavailable or cannot receive messages.`,
      );
    }
    await channel.send({ content, allowedMentions: { parse: [] } });
  }

  async #publishOrQueue(publish: () => Promise<void>): Promise<void> {
    if (!this.#acceptingEvents) throw new Error("Discord event publishing is stopping.");
    if (this.#client.isReady()) {
      await publish();
      return;
    }
    this.#pendingEvents.push({ createdAt: Date.now(), publish });
    if (this.#pendingEvents.length > this.#settings.pendingEventLimit) this.#pendingEvents.shift();
  }

  public async flushPendingEvents(now = Date.now()): Promise<void> {
    if (this.#flushing || !this.#client.isReady()) return;
    this.#flushing = true;
    try {
      const recentCutoff = now - 5 * 60_000;
      const pendingEvents = this.#pendingEvents
        .splice(0)
        .filter((event) => event.createdAt >= recentCutoff);
      for (const event of pendingEvents) await event.publish();
    } finally {
      this.#flushing = false;
    }
  }

  public async maintainStatusMessage(content: string): Promise<void> {
    const channelIdentifier = this.#settings.statusChannelIdentifier;
    if (channelIdentifier === undefined || !this.#client.isReady()) return;
    const channel = await this.#client.channels.fetch(channelIdentifier);
    if (channel === null || !channel.isSendable() || !channel.messages) {
      throw new Error(`Discord status channel ${channelIdentifier} is unavailable.`);
    }
    const storedMessageIdentifier = this.#database.getMetadata("discord_status_message_id");
    if (storedMessageIdentifier !== undefined) {
      try {
        const message = await channel.messages.fetch(storedMessageIdentifier);
        await message.edit({ content, allowedMentions: { parse: [] } });
        return;
      } catch {
        // A deleted status message is recreated below and its new identifier replaces the stale one.
      }
    }
    const message = await channel.send({ content, allowedMentions: { parse: [] } });
    this.#database.setMetadata("discord_status_message_id", message.id);
  }

  public stop(): void {
    this.#acceptingEvents = false;
    this.#pendingEvents.splice(0);
    this.#webhookClient?.destroy();
  }
}
