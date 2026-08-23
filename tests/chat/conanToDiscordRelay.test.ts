import { describe, expect, it, vi } from "vitest";

import { ChatEchoMemory } from "../../src/chat/ChatEchoMemory.js";
import { relayConanMessageToDiscord } from "../../src/chat/relayConanMessageToDiscord.js";
import type { GameChatEvent } from "../../src/conan/logs/parseChatEvent.js";

function gameEvent(channel: GameChatEvent["channel"], message: string): GameChatEvent {
  return {
    playerName: "Elsyra_*",
    message,
    channel,
    occurredAt: new Date("2026-08-21T20:00:00.000Z"),
    source: "pippi-chat-log",
  };
}

describe("Conan-to-Discord relay", () => {
  it("publishes verified Global chat with markdown escaped", async () => {
    const publishGameChat = vi.fn(async () => undefined);
    const result = await relayConanMessageToDiscord(
      gameEvent("global", "@everyone **meet at the volcano**"),
      { allowedChannels: new Set(["global"]), allowUnknownChannel: false, escapeMarkdown: true },
      { publishGameChat },
      new ChatEchoMemory(60_000, 100),
    );

    expect(result).toBe("published");
    expect(publishGameChat).toHaveBeenCalledWith(
      "Elsyra\\_\\*",
      "@everyone \\*\\*meet at the volcano\\*\\*",
    );
  });

  it.each(["local", "clan", "whisper", "unknown"] as const)(
    "blocks %s chat under the safe defaults",
    async (channel) => {
      const publishGameChat = vi.fn(async () => undefined);
      const result = await relayConanMessageToDiscord(
        gameEvent(channel, "The hidden passage is open."),
        { allowedChannels: new Set(["global"]), allowUnknownChannel: false, escapeMarkdown: true },
        { publishGameChat },
        new ChatEchoMemory(60_000, 100),
      );
      expect(result).toBe("blocked-private");
      expect(publishGameChat).not.toHaveBeenCalled();
    },
  );

  it("suppresses an exact recent outbound echo but not a manual prefix", async () => {
    const echoMemory = new ChatEchoMemory(60_000, 100);
    echoMemory.record("[Discord] Varodan: The forge is ready.");
    const destination = { publishGameChat: vi.fn(async () => undefined) };

    expect(
      await relayConanMessageToDiscord(
        gameEvent("global", "[Discord] Varodan: The forge is ready."),
        { allowedChannels: new Set(["global"]), allowUnknownChannel: false, escapeMarkdown: true },
        destination,
        echoMemory,
      ),
    ).toBe("suppressed-echo");
    expect(
      await relayConanMessageToDiscord(
        gameEvent("global", "[Discord] Drenik: This is ordinary game chat."),
        { allowedChannels: new Set(["global"]), allowUnknownChannel: false, escapeMarkdown: true },
        destination,
        echoMemory,
      ),
    ).toBe("published");
  });
});
