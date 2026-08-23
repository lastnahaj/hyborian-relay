import { describe, expect, it, vi } from "vitest";

import { ChatEchoMemory } from "../../src/chat/ChatEchoMemory.js";
import { parseChatEvent } from "../../src/conan/logs/parseChatEvent.js";
import { relayConanMessageToDiscord } from "../../src/chat/relayConanMessageToDiscord.js";

describe("game-log to Discord integration", () => {
  it("parses and publishes a verified Pippi Global message without enabling mentions", async () => {
    const event = parseChatEvent(
      "[2026.08.21-18.10.01:120][Pippi]PippiChat: Varodan said in channel [Global]: @here the arena opens at dusk.",
    );
    if (event === undefined) throw new Error("Chat fixture did not parse.");
    const publishGameChat = vi.fn(async () => undefined);
    const result = await relayConanMessageToDiscord(
      event,
      { allowedChannels: new Set(["global"]), allowUnknownChannel: false, escapeMarkdown: true },
      { publishGameChat },
      new ChatEchoMemory(60_000, 100),
    );

    expect(result).toBe("published");
    expect(publishGameChat).toHaveBeenCalledWith("Varodan", "@here the arena opens at dusk.");
  });
});
