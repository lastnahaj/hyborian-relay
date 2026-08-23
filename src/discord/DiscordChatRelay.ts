import { MessageType, type Client, type Message } from "discord.js";

import type { ChatEchoMemory } from "../chat/ChatEchoMemory.js";
import type { ChatRateLimiter } from "../chat/ChatRateLimiter.js";
import {
  relayDiscordMessageToConan,
  type DiscordToGameRelaySettings,
  type GameChatDestination,
} from "../chat/relayDiscordMessageToConan.js";

export class DiscordChatRelay {
  readonly #client: Client;
  readonly #settings: DiscordToGameRelaySettings;
  readonly #destination: GameChatDestination;
  readonly #rateLimiter: ChatRateLimiter;
  readonly #echoMemory: ChatEchoMemory;
  readonly #onError: (error: Error) => void;
  #enabled: boolean;

  public constructor(
    client: Client,
    settings: DiscordToGameRelaySettings,
    destination: GameChatDestination,
    rateLimiter: ChatRateLimiter,
    echoMemory: ChatEchoMemory,
    enabled: boolean,
    onError: (error: Error) => void,
  ) {
    this.#client = client;
    this.#settings = settings;
    this.#destination = destination;
    this.#rateLimiter = rateLimiter;
    this.#echoMemory = echoMemory;
    this.#enabled = enabled;
    this.#onError = onError;
  }

  public start(): void {
    this.#client.on("messageCreate", this.#handleMessage);
  }

  readonly #handleMessage = (message: Message): void => {
    if (!this.#enabled) return;
    void relayDiscordMessageToConan(
      {
        guildIdentifier: message.guildId,
        channelIdentifier: message.channelId,
        authorIdentifier: message.author.id,
        authorIsBot: message.author.bot,
        webhookIdentifier: message.webhookId,
        isDefaultMessage: message.type === MessageType.Default,
        content: message.content,
        ...(message.member?.displayName === undefined
          ? {}
          : { guildDisplayName: message.member.displayName }),
        ...(message.author.globalName === null
          ? {}
          : { globalDisplayName: message.author.globalName }),
        username: message.author.username,
        attachments: message.attachments.map((attachment) => ({ filename: attachment.name })),
      },
      this.#settings,
      this.#destination,
      this.#rateLimiter,
      this.#echoMemory,
    ).catch((error: unknown) => {
      this.#onError(error instanceof Error ? error : new Error(String(error)));
    });
  };

  public stop(): void {
    this.#enabled = false;
    this.#client.off("messageCreate", this.#handleMessage);
  }
}
