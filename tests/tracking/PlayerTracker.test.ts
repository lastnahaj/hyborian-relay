import { describe, expect, it } from "vitest";

import type {
  PlayerCommandSource,
  PlayerEventPublisher,
  PlayerTrackingStorage,
} from "../../src/tracking/PlayerTracker.js";
import { PlayerTracker } from "../../src/tracking/PlayerTracker.js";
import type { ConanPlayer } from "../../src/conan/players/parsePlayerListResponse.js";

function playerResponse(players: Array<{ name: string; identity: string }>): string {
  if (players.length === 0) return "No players online.";
  return [
    "Idx | Char name | Funcom ID",
    ...players.map(({ name, identity }, index) => `${index} | ${name} | ${identity}`),
  ].join("\n");
}

class SequencedCommandSource implements PlayerCommandSource {
  readonly responses: Array<string | Error>;

  public constructor(responses: Array<string | Error>) {
    this.responses = responses;
  }

  public async executeCommand(): Promise<string> {
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error("No test RCON response remains.");
    return response;
  }
}

class MemoryPlayerStorage implements PlayerTrackingStorage {
  readonly identities = new Map<string, number>();
  readonly openedSessions: string[] = [];
  readonly confirmedSessions: number[] = [];
  readonly closedSessions: string[] = [];
  readonly serverEvents: string[] = [];
  failUpserts = false;
  failServerEvents = false;

  public upsertPlayer(player: ConanPlayer): number {
    if (this.failUpserts) throw new Error("SQLite player write failed");
    const existing = this.identities.get(player.identityKey);
    if (existing !== undefined) return existing;
    const identifier = this.identities.size + 1;
    this.identities.set(player.identityKey, identifier);
    return identifier;
  }

  public openSession(
    _playerIdentifier: number,
    characterName: string,
    _joinedAt: Date,
    reason: string,
  ): void {
    this.openedSessions.push(`${characterName}:${reason}`);
  }

  public confirmSessionOnline(playerIdentifier: number): void {
    this.confirmedSessions.push(playerIdentifier);
  }

  public closeSession(_playerIdentifier: number, _leftAt: Date, reason: string): void {
    this.closedSessions.push(reason);
  }

  public recordServerEvent(state: string): void {
    if (this.failServerEvents) throw new Error("SQLite server-event write failed");
    this.serverEvents.push(state);
  }
}

class MemoryPlayerPublisher implements PlayerEventPublisher {
  readonly joins: string[] = [];
  readonly leaves: string[] = [];
  readonly serverStates: string[] = [];

  public async publishPlayerJoined(playerName: string): Promise<void> {
    this.joins.push(playerName);
  }

  public async publishPlayerLeft(playerName: string): Promise<void> {
    this.leaves.push(playerName);
  }

  public async publishServerState(state: "online" | "offline"): Promise<void> {
    this.serverStates.push(state);
  }
}

function createTracker(
  responses: Array<string | Error>,
  failuresBeforeOffline = 2,
): {
  tracker: PlayerTracker;
  storage: MemoryPlayerStorage;
  publisher: MemoryPlayerPublisher;
  errors: Error[];
} {
  const storage = new MemoryPlayerStorage();
  const publisher = new MemoryPlayerPublisher();
  const errors: Error[] = [];
  return {
    tracker: new PlayerTracker(
      new SequencedCommandSource(responses),
      storage,
      publisher,
      {
        pollIntervalMilliseconds: 30_000,
        missingPollsBeforeLeave: 2,
        failuresBeforeOffline,
        trackSessions: true,
        publishJoinLeaveEvents: true,
      },
      (error) => void errors.push(error),
    ),
    storage,
    publisher,
    errors,
  };
}

describe("player tracking", () => {
  it("opens baseline sessions silently, then publishes confirmed joins and leaves", async () => {
    const first = [{ name: "Rhovan", identity: "rhovan-key" }];
    const withJoin = [...first, { name: "Selvara", identity: "selvara-key" }];
    const setup = createTracker([
      playerResponse(first),
      playerResponse(withJoin),
      playerResponse([withJoin[1] as { name: string; identity: string }]),
      playerResponse([withJoin[1] as { name: string; identity: string }]),
    ]);

    await setup.tracker.pollOnce();
    expect(setup.publisher.joins).toEqual([]);
    expect(setup.storage.openedSessions).toContain("Rhovan:current_baseline");
    await setup.tracker.pollOnce();
    expect(setup.publisher.joins).toEqual(["Selvara"]);
    await setup.tracker.pollOnce();
    expect(setup.publisher.leaves).toEqual([]);
    await setup.tracker.pollOnce();
    expect(setup.publisher.leaves).toEqual(["Rhovan"]);
    expect(setup.storage.closedSessions).toContain("confirmed_leave");
  });

  it("does not treat a failed poll as an empty player list", async () => {
    const setup = createTracker(
      [
        playerResponse([{ name: "Odran", identity: "odran-key" }]),
        new Error("temporary RCON timeout"),
        playerResponse([]),
      ],
      3,
    );

    await setup.tracker.pollOnce();
    await setup.tracker.pollOnce();
    await setup.tracker.pollOnce();
    expect(setup.publisher.leaves).toEqual([]);
    expect(setup.tracker.snapshot.stale).toBe(false);
  });

  it("publishes one offline event without mass leave events and establishes a silent return baseline", async () => {
    const names = [
      "Vaelric",
      "Serapha",
      "Torven",
      "Mirelda",
      "Kaedren",
      "Nyssara",
      "Brannoc",
      "Velmira",
      "Dravenor",
      "Yseldra",
      "Corveth",
      "Thalric",
      "Maerwyn",
      "Rhovan",
      "Selvara",
      "Odran",
      "Kessira",
      "Varodan",
      "Elsyra",
      "Drenik",
      "Aeric",
      "Bryndra",
      "Caelor",
      "Delmara",
      "Erynd",
      "Faelwen",
      "Garruk",
      "Helvara",
      "Ilyren",
      "Jorveth",
    ];
    const onlinePlayers = names.map((name) => ({ name, identity: `${name.toLowerCase()}-key` }));
    const setup = createTracker([
      playerResponse(onlinePlayers),
      new Error("socket closed"),
      new Error("connection refused"),
      playerResponse(onlinePlayers.slice(0, 4)),
    ]);

    await setup.tracker.pollOnce();
    await setup.tracker.pollOnce();
    await setup.tracker.pollOnce();
    expect(setup.publisher.serverStates).toEqual(["offline"]);
    expect(setup.publisher.leaves).toEqual([]);
    expect(setup.storage.closedSessions).toHaveLength(30);
    await setup.tracker.pollOnce();
    expect(setup.publisher.serverStates).toEqual(["offline", "online"]);
    expect(setup.publisher.joins).toEqual([]);
  });

  it("degrades on an unrecognized player response without declaring the server offline", async () => {
    const setup = createTracker(["unrecognized enhanced response"], 1);
    await setup.tracker.pollOnce();
    expect(setup.tracker.serverState).toBe("degraded");
    expect(setup.publisher.serverStates).toEqual([]);
    expect(setup.errors[0]).toMatchObject({ code: "PLAYER_LIST_PARSE_FAILED" });
  });

  it("re-establishes a silent baseline after a presence write fails", async () => {
    const response = playerResponse([{ name: "Thalric", identity: "thalric-key" }]);
    const setup = createTracker([response, response]);
    setup.storage.failUpserts = true;

    await setup.tracker.pollOnce();
    expect(setup.tracker.trackingState).toBe("degraded");
    setup.storage.failUpserts = false;
    await setup.tracker.pollOnce();

    expect(setup.tracker.trackingState).toBe("healthy");
    expect(setup.storage.openedSessions).toContain("Thalric:current_baseline");
    expect(setup.publisher.joins).toEqual([]);
  });

  it("contains a server-outage persistence failure without rejecting the poll", async () => {
    const setup = createTracker(
      [
        playerResponse([{ name: "Maerwyn", identity: "maerwyn-key" }]),
        new Error("RCON connection closed"),
      ],
      1,
    );
    await setup.tracker.pollOnce();
    setup.storage.failServerEvents = true;

    await expect(setup.tracker.pollOnce()).resolves.toBeUndefined();
    expect(setup.tracker.serverState).toBe("offline");
    expect(setup.tracker.trackingState).toBe("degraded");
    expect(setup.publisher.serverStates).toEqual([]);
  });
});
