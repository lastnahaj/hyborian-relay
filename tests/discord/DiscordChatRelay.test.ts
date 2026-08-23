import { EventEmitter } from "node:events";

import { Collection, MessageType, type Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { ChatEchoMemory } from "../../src/chat/ChatEchoMemory.js";
import { ChatRateLimiter } from "../../src/chat/ChatRateLimiter.js";
import { DiscordChatRelay } from "../../src/discord/DiscordChatRelay.js";

describe("Discord gateway chat relay", () => {
  it("maps a normal Discord message into the safe relay and detaches on shutdown", async () => {
    const client = new EventEmitter();
    const sent: string[] = [];
    const relay = new DiscordChatRelay(
      client as unknown as Client,
      {
        guildIdentifier: "223456789012345678",
        channelIdentifier: "323456789012345678",
        prefix: "[Discord]",
        maximumCharacters: 100,
      },
      { sendGameChatMessage: async (message) => void sent.push(message) },
      new ChatRateLimiter({
        userMessageLimit: 5,
        userWindowMilliseconds: 10_000,
        globalMessageLimit: 30,
        globalWindowMilliseconds: 10_000,
      }),
      new ChatEchoMemory(60_000, 100),
      true,
      vi.fn(),
    );
    relay.start();
    client.emit("messageCreate", {
      guildId: "223456789012345678",
      channelId: "323456789012345678",
      author: {
        id: "623456789012345678",
        bot: false,
        globalName: null,
        username: "OdranAccount",
      },
      webhookId: null,
      type: MessageType.Default,
      content: "Meet at the aqueduct.",
      member: { displayName: "Odran" },
      attachments: new Collection(),
    });
    await vi.waitFor(() => expect(sent).toEqual(["[Discord] Odran: Meet at the aqueduct."]));

    relay.stop();
    client.emit("messageCreate", {
      guildId: "223456789012345678",
      channelId: "323456789012345678",
      author: {
        id: "723456789012345678",
        bot: false,
        globalName: "Kessira",
        username: "KessiraAccount",
      },
      webhookId: null,
      type: MessageType.Default,
      content: "This message arrives after shutdown.",
      member: null,
      attachments: new Collection(),
    });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
  });
});
