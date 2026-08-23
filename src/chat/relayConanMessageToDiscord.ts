import { escapeMarkdown } from "discord.js";

import type { GameChatEvent } from "../conan/logs/parseChatEvent.js";
import type { ChatEchoMemory } from "./ChatEchoMemory.js";

export interface GameToDiscordRelaySettings {
  allowedChannels: ReadonlySet<GameChatEvent["channel"]>;
  allowUnknownChannel: boolean;
  escapeMarkdown: boolean;
}

export interface DiscordGameChatDestination {
  publishGameChat(playerName: string, message: string): Promise<void>;
}

export type GameToDiscordRelayResult = "published" | "blocked-private" | "suppressed-echo";

export async function relayConanMessageToDiscord(
  event: GameChatEvent,
  settings: GameToDiscordRelaySettings,
  destination: DiscordGameChatDestination,
  echoMemory: ChatEchoMemory,
): Promise<GameToDiscordRelayResult> {
  if (echoMemory.consumeIfEcho(event.message)) return "suppressed-echo";
  const channelAllowed = settings.allowedChannels.has(event.channel);
  if (!channelAllowed || (event.channel === "unknown" && !settings.allowUnknownChannel)) {
    return "blocked-private";
  }
  const playerName = settings.escapeMarkdown ? escapeMarkdown(event.playerName) : event.playerName;
  const message = settings.escapeMarkdown ? escapeMarkdown(event.message) : event.message;
  await destination.publishGameChat(playerName, message);
  return "published";
}
