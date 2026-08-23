import { sanitizeDiscordDisplayName, sanitizeGameBoundText } from "./sanitizeGameBoundText.js";
import { splitGameBoundMessage } from "./splitGameBoundMessage.js";
import type { ChatEchoMemory } from "./ChatEchoMemory.js";
import type { ChatRateLimiter } from "./ChatRateLimiter.js";

interface DiscordAttachmentReference {
  filename: string;
}

export interface GameBoundDiscordMessage {
  guildIdentifier: string | null;
  channelIdentifier: string;
  authorIdentifier: string;
  authorIsBot: boolean;
  webhookIdentifier: string | null;
  isDefaultMessage: boolean;
  content: string;
  guildDisplayName?: string;
  globalDisplayName?: string;
  username: string;
  attachments: DiscordAttachmentReference[];
}

export interface DiscordToGameRelaySettings {
  guildIdentifier: string;
  channelIdentifier: string;
  prefix: string;
  maximumCharacters: number;
}

export interface GameChatDestination {
  sendGameChatMessage(renderedMessage: string): Promise<void>;
}

export type DiscordRelayResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "rate-limited"; retryAfterMilliseconds: number }
  | { outcome: "relayed"; messageCount: number };

function selectDiscordDisplayName(message: GameBoundDiscordMessage): string {
  return message.guildDisplayName ?? message.globalDisplayName ?? message.username;
}

function renderAttachmentReferences(attachments: DiscordAttachmentReference[]): string {
  return attachments
    .map((attachment) => `[attachment: ${sanitizeGameBoundText(attachment.filename)}]`)
    .join(" ");
}

export async function relayDiscordMessageToConan(
  message: GameBoundDiscordMessage,
  settings: DiscordToGameRelaySettings,
  destination: GameChatDestination,
  rateLimiter: ChatRateLimiter,
  echoMemory: ChatEchoMemory,
): Promise<DiscordRelayResult> {
  if (message.guildIdentifier !== settings.guildIdentifier) {
    return { outcome: "ignored", reason: "wrong guild" };
  }
  if (message.channelIdentifier !== settings.channelIdentifier) {
    return { outcome: "ignored", reason: "wrong channel" };
  }
  if (message.authorIsBot) return { outcome: "ignored", reason: "bot author" };
  if (message.webhookIdentifier !== null) return { outcome: "ignored", reason: "webhook author" };
  if (!message.isDefaultMessage) return { outcome: "ignored", reason: "unsupported message type" };

  const contentParts = [
    sanitizeGameBoundText(message.content),
    renderAttachmentReferences(message.attachments),
  ].filter(Boolean);
  const content = contentParts.join(" ");
  if (content.length === 0) return { outcome: "ignored", reason: "empty message" };

  const rateLimitDecision = rateLimiter.check(message.authorIdentifier);
  if (!rateLimitDecision.allowed) {
    return {
      outcome: "rate-limited",
      retryAfterMilliseconds: rateLimitDecision.retryAfterMilliseconds,
    };
  }

  const discordDisplayName = sanitizeDiscordDisplayName(selectDiscordDisplayName(message));
  const renderedMessages = splitGameBoundMessage(
    settings.prefix,
    discordDisplayName,
    content,
    settings.maximumCharacters,
  );
  for (const renderedMessage of renderedMessages) {
    await destination.sendGameChatMessage(renderedMessage);
    echoMemory.record(renderedMessage);
  }
  return { outcome: "relayed", messageCount: renderedMessages.length };
}
