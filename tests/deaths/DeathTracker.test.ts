import { describe, expect, it } from "vitest";

import { parseDeathEvent, type PlayerDeathEvent } from "../../src/conan/logs/parseDeathEvent.js";
import type {
  DeathEventPublisher,
  DeathTrackingStorage,
  StoredPlayerIdentity,
} from "../../src/tracking/DeathTracker.js";
import { DeathTracker } from "../../src/tracking/DeathTracker.js";

function deathEvent(eventText: string, second = 0): PlayerDeathEvent {
  const event = parseDeathEvent(
    `[2026.08.21-22.00.${String(second).padStart(2, "0")}:000][Pippi]PippiEvent: ${eventText}`,
  );
  if (event === undefined) throw new Error("Death fixture did not parse.");
  return event;
}

class MemoryDeathStorage implements DeathTrackingStorage {
  readonly knownPlayers = new Map<string, StoredPlayerIdentity>();
  readonly events: PlayerDeathEvent[] = [];
  failWrites = false;

  public findUnambiguousPlayerByName(characterName: string): StoredPlayerIdentity | undefined {
    return this.knownPlayers.get(characterName);
  }

  public recordDeath(event: PlayerDeathEvent): boolean {
    if (this.failWrites) throw new Error("SQLite write failed");
    if (
      this.events.some(({ sourceFingerprint }) => sourceFingerprint === event.sourceFingerprint)
    ) {
      return false;
    }
    this.events.push(event);
    return true;
  }
}

class MemoryDeathPublisher implements DeathEventPublisher {
  readonly events: PlayerDeathEvent[] = [];
  failPublishing = false;

  public async publishDeath(event: PlayerDeathEvent): Promise<void> {
    if (this.failPublishing) throw new Error("Discord unavailable");
    this.events.push(event);
  }
}

function createTracker(
  settings: Partial<{
    trackingEnabled: boolean;
    publishingEnabled: boolean;
    duplicateWindowMilliseconds: number;
  }> = {},
): {
  tracker: DeathTracker;
  storage: MemoryDeathStorage;
  publisher: MemoryDeathPublisher;
  errors: Error[];
} {
  const storage = new MemoryDeathStorage();
  const publisher = new MemoryDeathPublisher();
  const errors: Error[] = [];
  return {
    tracker: new DeathTracker(
      storage,
      publisher,
      {
        trackingEnabled: settings.trackingEnabled ?? true,
        publishingEnabled: settings.publishingEnabled ?? true,
        duplicateWindowMilliseconds: settings.duplicateWindowMilliseconds ?? 10_000,
      },
      (error) => void errors.push(error),
    ),
    storage,
    publisher,
    errors,
  };
}

describe("death tracking", () => {
  it("starts available, degrades on an unsupported candidate, and recovers on a recognized event", async () => {
    const setup = createTracker();
    expect(setup.tracker.health).toBe("healthy");
    expect(setup.tracker.parserStatus).toBe("parser-available-no-live-sample");

    setup.tracker.noteUnsupportedEventFormat();
    expect(setup.tracker.health).toBe("degraded");
    expect(setup.tracker.parserStatus).toBe("incompatible");

    await setup.tracker.handle(deathEvent("Kessira died from frostbite.", 0));
    expect(setup.tracker.health).toBe("healthy");
    expect(setup.tracker.parserStatus).toBe("recognized");
  });

  it("stores and publishes one event while suppressing a cross-line duplicate", async () => {
    const setup = createTracker();
    const first = deathEvent("Serapha was killed by creature Rocknose.", 1);
    const duplicate = deathEvent("Serapha was killed by creature Rocknose.", 5);

    expect(await setup.tracker.handle(first)).toEqual({
      stored: true,
      published: true,
      duplicate: false,
    });
    expect(await setup.tracker.handle(duplicate)).toEqual({
      stored: false,
      published: false,
      duplicate: true,
    });
    expect(setup.storage.events).toHaveLength(1);
    expect(setup.publisher.events).toHaveLength(1);
  });

  it("attributes an otherwise unknown killer only when a stored player identity proves it", async () => {
    const setup = createTracker();
    setup.storage.knownPlayers.set("Kaedren", { id: 9, identity_key: "funcom:kaedren" });

    await setup.tracker.handle(deathEvent("Yseldra was killed by Kaedren.", 10));
    expect(setup.storage.events[0]).toMatchObject({
      killerIdentityKey: "funcom:kaedren",
      classification: "player_kill",
    });
  });

  it("keeps an unknown killer unknown instead of guessing", async () => {
    const setup = createTracker();
    await setup.tracker.handle(deathEvent("Velmira was killed by Sand Reaper Queen.", 12));
    expect(setup.storage.events[0]).toMatchObject({
      killerName: "Sand Reaper Queen",
      classification: "unknown",
    });
  });

  it("persists while publication is disabled and does nothing when tracking is disabled", async () => {
    const persistenceOnly = createTracker({ publishingEnabled: false });
    expect(
      await persistenceOnly.tracker.handle(deathEvent("Mirelda died from falling.", 15)),
    ).toEqual({
      stored: true,
      published: false,
      duplicate: false,
    });

    const disabled = createTracker({ trackingEnabled: false });
    expect(await disabled.tracker.handle(deathEvent("Corveth died.", 16))).toEqual({
      stored: false,
      published: false,
      duplicate: false,
    });
    expect(disabled.tracker.health).toBe("disabled");
  });

  it("degrades on database failure without publishing misleading state", async () => {
    const setup = createTracker();
    setup.storage.failWrites = true;
    const result = await setup.tracker.handle(deathEvent("Torven died from poison.", 18));

    expect(result.stored).toBe(false);
    expect(setup.publisher.events).toEqual([]);
    expect(setup.tracker.health).toBe("degraded");
    expect(setup.errors).toHaveLength(1);
  });

  it("does not duplicate persistence when Discord publishing fails", async () => {
    const setup = createTracker();
    setup.publisher.failPublishing = true;
    const event = deathEvent("Brannoc was killed by NPC Relic Hunter.", 20);
    expect(await setup.tracker.handle(event)).toMatchObject({ stored: true, published: false });
    expect(await setup.tracker.handle(event)).toMatchObject({ duplicate: true });
    expect(setup.storage.events).toHaveLength(1);
  });
});
