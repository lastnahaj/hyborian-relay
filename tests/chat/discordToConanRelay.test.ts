import { describe, expect, it, vi } from "vitest";

import { ChatEchoMemory } from "../../src/chat/ChatEchoMemory.js";
import { ChatRateLimiter } from "../../src/chat/ChatRateLimiter.js";
import {
  relayDiscordMessageToConan,
  type GameChatDestination,
  type GameBoundDiscordMessage,
} from "../../src/chat/relayDiscordMessageToConan.js";

function messageFrom(characterName: string): GameBoundDiscordMessage {
  return {
    guildIdentifier: "223456789012345678",
    channelIdentifier: "323456789012345678",
    authorIdentifier: `identity-${characterName}`,
    authorIsBot: false,
    webhookIdentifier: null,
    isDefaultMessage: true,
    content: "Anyone running the Wine Cellar?",
    guildDisplayName: characterName,
    globalDisplayName: `${characterName} Global`,
    username: `${characterName} Account`,
    attachments: [],
  };
}

interface RelayDependencies {
  sent: string[];
  destination: GameChatDestination;
  rateLimiter: ChatRateLimiter;
  echoMemory: ChatEchoMemory;
}

const dependencies = (): RelayDependencies => {
  const sent: string[] = [];
  return {
    sent,
    destination: { sendGameChatMessage: vi.fn(async (message: string) => void sent.push(message)) },
    rateLimiter: new ChatRateLimiter({
      userMessageLimit: 5,
      userWindowMilliseconds: 10_000,
      globalMessageLimit: 30,
      globalWindowMilliseconds: 10_000,
    }),
    echoMemory: new ChatEchoMemory(60_000, 100),
  };
};

const settings = {
  guildIdentifier: "223456789012345678",
  channelIdentifier: "323456789012345678",
  prefix: "[Discord]",
  maximumCharacters: 80,
};

describe("Discord-to-Conan relay", () => {
  it("uses the guild display name and records a successful outbound fingerprint", async () => {
    const relayDependencies = dependencies();
    const result = await relayDiscordMessageToConan(
      messageFrom("Vaelric"),
      settings,
      relayDependencies.destination,
      relayDependencies.rateLimiter,
      relayDependencies.echoMemory,
    );

    expect(result).toEqual({ outcome: "relayed", messageCount: 1 });
    expect(relayDependencies.sent).toEqual(["[Discord] Vaelric: Anyone running the Wine Cellar?"]);
    expect(relayDependencies.echoMemory.consumeIfEcho(relayDependencies.sent[0] ?? "")).toBe(true);
  });

  it.each([
    ["wrong guild", { guildIdentifier: "923456789012345678" }],
    ["wrong channel", { channelIdentifier: "823456789012345678" }],
    ["bot author", { authorIsBot: true }],
    ["webhook author", { webhookIdentifier: "723456789012345678" }],
    ["unsupported message type", { isDefaultMessage: false }],
  ])("ignores a %s", async (_reason, overrides) => {
    const relayDependencies = dependencies();
    const result = await relayDiscordMessageToConan(
      { ...messageFrom("Thalric"), ...overrides },
      settings,
      relayDependencies.destination,
      relayDependencies.rateLimiter,
      relayDependencies.echoMemory,
    );

    expect(result.outcome).toBe("ignored");
    expect(relayDependencies.sent).toEqual([]);
  });

  it("represents attachments without fetching them and sanitizes multiline content", async () => {
    const relayDependencies = dependencies();
    const message = messageFrom("Maerwyn");
    message.content = "Map\r\nfor the western ruins";
    message.attachments = [{ filename: "ruins-map.png" }];

    await relayDiscordMessageToConan(
      message,
      settings,
      relayDependencies.destination,
      relayDependencies.rateLimiter,
      relayDependencies.echoMemory,
    );
    expect(relayDependencies.sent[0]).toContain(
      "Map for the western ruins [attachment: ruins-map.png]",
    );
  });
});
