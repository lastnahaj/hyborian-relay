import { EventEmitter } from "node:events";

import type { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { parseDeathEvent } from "../../src/conan/logs/parseDeathEvent.js";
import { DiscordEventPublisher } from "../../src/discord/DiscordEventPublisher.js";
import type { RelayDatabase } from "../../src/storage/RelayDatabase.js";

interface SentMessage {
  content: string;
  allowedMentions: { parse: never[] };
}

class FakeDiscordClient extends EventEmitter {
  ready = true;
  readonly sentByChannel = new Map<string, SentMessage[]>();
  readonly messages = new Map<string, { edit: ReturnType<typeof vi.fn> }>();
  readonly channels = {
    fetch: async (channelIdentifier: string) => {
      const sent = this.sentByChannel.get(channelIdentifier) ?? [];
      this.sentByChannel.set(channelIdentifier, sent);
      return {
        isSendable: () => true,
        send: async (message: SentMessage) => {
          sent.push(message);
          return { id: `message-${sent.length}` };
        },
        messages: {
          fetch: async (messageIdentifier: string) => {
            const message = this.messages.get(messageIdentifier);
            if (message === undefined) throw new Error("status message deleted");
            return message;
          },
        },
      };
    },
  };

  public isReady(): boolean {
    return this.ready;
  }
}

class FakeMetadataDatabase {
  readonly values = new Map<string, string>();

  public getMetadata(key: string): string | undefined {
    return this.values.get(key);
  }

  public setMetadata(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function publisher(
  client: FakeDiscordClient,
  database = new FakeMetadataDatabase(),
): DiscordEventPublisher {
  return new DiscordEventPublisher(
    client as unknown as Client,
    database as unknown as RelayDatabase,
    {
      chatChannelIdentifier: "323456789012345678",
      eventChannelIdentifier: "423456789012345678",
      statusChannelIdentifier: "523456789012345678",
      pendingEventLimit: 2,
      gameChatRendering: "bot",
    },
  );
}

describe("Discord event publishing", () => {
  it("protects mentions on game chat and uses the event-channel death fallback", async () => {
    const client = new FakeDiscordClient();
    const eventPublisher = publisher(client);
    await eventPublisher.publishGameChat("Vaelric", "@everyone gather at the Black Keep.");
    const death = parseDeathEvent(
      "[2026.08.21-23.10.00:000][Pippi]PippiEvent: Mirelda died from falling.",
    );
    if (death === undefined) throw new Error("Death fixture did not parse.");
    await eventPublisher.publishDeath(death);

    expect(client.sentByChannel.get("323456789012345678")?.[0]).toEqual({
      content: "**Vaelric:** @everyone gather at the Black Keep.",
      allowedMentions: { parse: [] },
    });
    expect(client.sentByChannel.get("423456789012345678")?.[0]?.content).toBe(
      "Mirelda died from falling.",
    );
    eventPublisher.stop();
  });

  it("bounds disconnected events and discards entries older than five minutes", async () => {
    const client = new FakeDiscordClient();
    client.ready = false;
    const eventPublisher = publisher(client);
    await eventPublisher.publishPlayerJoined("Kaedren");
    await eventPublisher.publishPlayerLeft("Torven");
    await eventPublisher.publishServerState("offline");
    client.ready = true;

    await eventPublisher.flushPendingEvents(Date.now() + 6 * 60_000);
    expect(client.sentByChannel.get("423456789012345678")).toBeUndefined();
    eventPublisher.stop();
  });

  it("flushes only the newest bounded events after a short Discord outage", async () => {
    const client = new FakeDiscordClient();
    client.ready = false;
    const eventPublisher = publisher(client);
    await eventPublisher.publishPlayerJoined("Dravenor");
    await eventPublisher.publishPlayerLeft("Yseldra");
    await eventPublisher.publishServerState("online");
    client.ready = true;

    await eventPublisher.flushPendingEvents();
    expect(client.sentByChannel.get("423456789012345678")?.map(({ content }) => content)).toEqual([
      "Yseldra left the server.",
      "Conan server is online.",
    ]);
    eventPublisher.stop();
  });

  it("recreates a deleted persistent status message and then edits it", async () => {
    const client = new FakeDiscordClient();
    const database = new FakeMetadataDatabase();
    database.values.set("discord_status_message_id", "deleted-message");
    const eventPublisher = publisher(client, database);

    await eventPublisher.maintainStatusMessage("Hyborian Relay is healthy.");
    expect(database.values.get("discord_status_message_id")).toBe("message-1");
    const edit = vi.fn(async () => undefined);
    client.messages.set("message-1", { edit });
    await eventPublisher.maintainStatusMessage("Hyborian Relay remains healthy.");
    expect(edit).toHaveBeenCalledWith({
      content: "Hyborian Relay remains healthy.",
      allowedMentions: { parse: [] },
    });
    eventPublisher.stop();
  });
});
