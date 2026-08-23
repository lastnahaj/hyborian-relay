import {
  parsePlayerListResponse,
  type ConanPlayer,
} from "../conan/players/parsePlayerListResponse.js";
import { RelayError } from "../errors/RelayError.js";
import { PlayerReconciler } from "./PlayerReconciler.js";

export type ServerHealthState = "unknown" | "connecting" | "online" | "degraded" | "offline";
export type ComponentHealthState = "healthy" | "degraded" | "disabled";

export interface PlayerSnapshot {
  players: ConanPlayer[];
  obtainedAt?: Date;
  stale: boolean;
}

export interface PlayerTrackerSettings {
  pollIntervalMilliseconds: number;
  missingPollsBeforeLeave: number;
  failuresBeforeOffline: number;
  trackSessions: boolean;
  publishJoinLeaveEvents: boolean;
}

export interface PlayerEventPublisher {
  publishPlayerJoined(playerName: string): Promise<void>;
  publishPlayerLeft(playerName: string): Promise<void>;
  publishServerState(state: "online" | "offline"): Promise<void>;
}

export interface PlayerCommandSource {
  executeCommand(command: string, priority: "background-tracking"): Promise<string>;
}

export interface PlayerTrackingStorage {
  upsertPlayer(player: ConanPlayer, observedAt: Date): number;
  openSession(
    playerIdentifier: number,
    characterName: string,
    joinedAt: Date,
    reason: string,
  ): void;
  confirmSessionOnline(playerIdentifier: number, confirmedAt: Date): void;
  closeSession(playerIdentifier: number, leftAt: Date, reason: string): void;
  recordServerEvent(state: string, occurredAt: Date, details?: string): void;
}

export class PlayerTracker {
  readonly #rconClient: PlayerCommandSource;
  readonly #database: PlayerTrackingStorage;
  readonly #publisher: PlayerEventPublisher;
  readonly #settings: PlayerTrackerSettings;
  readonly #reconciler: PlayerReconciler;
  readonly #storedPlayerIdentifiers = new Map<string, number>();
  readonly #onError: (error: Error) => void;
  #pollTimer: NodeJS.Timeout | undefined;
  #consecutiveFailures = 0;
  #serverState: ServerHealthState = "unknown";
  #trackingState: ComponentHealthState = "degraded";
  #snapshot: PlayerSnapshot = { players: [], stale: true };

  public constructor(
    rconClient: PlayerCommandSource,
    database: PlayerTrackingStorage,
    publisher: PlayerEventPublisher,
    settings: PlayerTrackerSettings,
    onError: (error: Error) => void,
  ) {
    this.#rconClient = rconClient;
    this.#database = database;
    this.#publisher = publisher;
    this.#settings = settings;
    this.#reconciler = new PlayerReconciler(settings.missingPollsBeforeLeave);
    this.#onError = onError;
  }

  public start(): void {
    if (this.#pollTimer !== undefined) return;
    this.#serverState = "connecting";
    void this.pollOnce();
    this.#pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.#settings.pollIntervalMilliseconds);
  }

  public async pollOnce(): Promise<void> {
    try {
      const response = await this.#rconClient.executeCommand("listplayers", "background-tracking");
      const observedPlayers = parsePlayerListResponse(response);
      await this.#handleSuccessfulPoll(observedPlayers, new Date());
    } catch (error: unknown) {
      await this.#handleFailedPoll(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async #handleSuccessfulPoll(observedPlayers: ConanPlayer[], observedAt: Date): Promise<void> {
    this.#consecutiveFailures = 0;
    const previousServerState = this.#serverState;
    const reconciliation = this.#reconciler.reconcile(observedPlayers);
    try {
      for (const player of observedPlayers) {
        const playerIdentifier = this.#database.upsertPlayer(player, observedAt);
        this.#storedPlayerIdentifiers.set(player.identityKey, playerIdentifier);
        if (this.#settings.trackSessions) {
          if (
            reconciliation.baselineEstablished ||
            reconciliation.joins.some(
              (joinedPlayer) => joinedPlayer.identityKey === player.identityKey,
            )
          ) {
            this.#database.openSession(
              playerIdentifier,
              player.characterName,
              observedAt,
              reconciliation.baselineEstablished ? "current_baseline" : "confirmed_join",
            );
          }
          this.#database.confirmSessionOnline(playerIdentifier, observedAt);
        }
      }
      for (const player of reconciliation.leaves) {
        const playerIdentifier = this.#storedPlayerIdentifiers.get(player.identityKey);
        if (this.#settings.trackSessions && playerIdentifier !== undefined) {
          this.#database.closeSession(playerIdentifier, observedAt, "confirmed_leave");
        }
      }
    } catch (error: unknown) {
      this.#reconciler.invalidateBaseline();
      this.#trackingState = "degraded";
      this.#onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    this.#snapshot = {
      players: reconciliation.currentPlayers,
      obtainedAt: observedAt,
      stale: false,
    };
    this.#trackingState = "healthy";
    this.#serverState = "online";
    if (previousServerState === "offline") {
      this.#database.recordServerEvent("online", observedAt);
      await this.#publishSafely(() => this.#publisher.publishServerState("online"));
    }
    if (this.#settings.publishJoinLeaveEvents && !reconciliation.baselineEstablished) {
      for (const player of reconciliation.joins) {
        await this.#publishSafely(() => this.#publisher.publishPlayerJoined(player.characterName));
      }
      for (const player of reconciliation.leaves) {
        await this.#publishSafely(() => this.#publisher.publishPlayerLeft(player.characterName));
      }
    }
  }

  async #handleFailedPoll(error: Error): Promise<void> {
    this.#snapshot = { ...this.#snapshot, stale: true };
    this.#trackingState = "degraded";
    this.#onError(error);
    if (error instanceof RelayError && error.code === "PLAYER_LIST_PARSE_FAILED") {
      this.#serverState = "degraded";
      return;
    }

    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures < this.#settings.failuresBeforeOffline) {
      this.#serverState = "degraded";
      return;
    }
    if (this.#serverState === "offline") return;

    this.#serverState = "offline";
    const occurredAt = new Date();
    const previouslyOnline = this.#reconciler.invalidateBaseline();
    try {
      if (this.#settings.trackSessions) {
        for (const player of previouslyOnline) {
          const playerIdentifier = this.#storedPlayerIdentifiers.get(player.identityKey);
          if (playerIdentifier !== undefined) {
            this.#database.closeSession(playerIdentifier, occurredAt, "server_offline");
          }
        }
      }
      this.#database.recordServerEvent("offline", occurredAt, error.message);
    } catch (storageError: unknown) {
      this.#trackingState = "degraded";
      this.#onError(storageError instanceof Error ? storageError : new Error(String(storageError)));
      return;
    }
    await this.#publishSafely(() => this.#publisher.publishServerState("offline"));
  }

  async #publishSafely(publish: () => Promise<void>): Promise<void> {
    try {
      await publish();
    } catch (error: unknown) {
      this.#onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public stop(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  public get snapshot(): PlayerSnapshot {
    return {
      ...this.#snapshot,
      players: [...this.#snapshot.players],
      ...(this.#snapshot.obtainedAt === undefined ? {} : { obtainedAt: this.#snapshot.obtainedAt }),
    };
  }

  public get serverState(): ServerHealthState {
    return this.#serverState;
  }

  public get trackingState(): ComponentHealthState {
    return this.#trackingState;
  }
}
