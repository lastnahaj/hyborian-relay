import { createHash } from "node:crypto";

import type { PlayerDeathEvent } from "../conan/logs/parseDeathEvent.js";
import type { ComponentHealthState } from "./PlayerTracker.js";

export interface DeathEventPublisher {
  publishDeath(event: PlayerDeathEvent): Promise<void>;
}

export interface DeathTrackerSettings {
  trackingEnabled: boolean;
  publishingEnabled: boolean;
  duplicateWindowMilliseconds: number;
}

export interface DeathTrackingStorage {
  findUnambiguousPlayerByName(characterName: string): StoredPlayerIdentity | undefined;
  recordDeath(event: PlayerDeathEvent): boolean;
}

export interface StoredPlayerIdentity {
  id: number;
  identity_key: string;
}

export interface DeathTrackingResult {
  stored: boolean;
  published: boolean;
  duplicate: boolean;
}

function semanticFingerprint(event: PlayerDeathEvent): string {
  return createHash("sha256")
    .update(
      [
        event.victimIdentityKey ?? event.victimName.normalize("NFC").toLowerCase(),
        event.killerIdentityKey ?? event.killerName?.normalize("NFC").toLowerCase() ?? "",
        event.classification,
        event.cause?.normalize("NFC").toLowerCase() ?? "",
      ].join("\u0000"),
    )
    .digest("hex");
}

export class DeathTracker {
  readonly #database: DeathTrackingStorage;
  readonly #publisher: DeathEventPublisher;
  readonly #settings: DeathTrackerSettings;
  readonly #recentEvents = new Map<string, number>();
  readonly #onError: (error: Error) => void;
  #health: ComponentHealthState;
  #recognizedEvent = false;
  #unsupportedEventFormatObserved = false;

  public constructor(
    database: DeathTrackingStorage,
    publisher: DeathEventPublisher,
    settings: DeathTrackerSettings,
    onError: (error: Error) => void,
  ) {
    this.#database = database;
    this.#publisher = publisher;
    this.#settings = settings;
    this.#onError = onError;
    this.#health = settings.trackingEnabled ? "healthy" : "disabled";
  }

  public async handle(event: PlayerDeathEvent): Promise<DeathTrackingResult> {
    if (!this.#settings.trackingEnabled) {
      return { stored: false, published: false, duplicate: false };
    }
    this.#recognizedEvent = true;
    this.#unsupportedEventFormatObserved = false;
    const resolvedEvent = this.#resolveKnownPlayers(event);
    const fingerprint = semanticFingerprint(resolvedEvent);
    const occurredAt = resolvedEvent.occurredAt.getTime();
    this.#expire(occurredAt);
    const previousOccurrence = this.#recentEvents.get(fingerprint);
    if (
      previousOccurrence !== undefined &&
      Math.abs(occurredAt - previousOccurrence) <= this.#settings.duplicateWindowMilliseconds
    ) {
      return { stored: false, published: false, duplicate: true };
    }

    try {
      const stored = this.#database.recordDeath(resolvedEvent);
      this.#recentEvents.set(fingerprint, occurredAt);
      this.#health = "healthy";
      if (!stored) return { stored: false, published: false, duplicate: true };
      if (!this.#settings.publishingEnabled) {
        return { stored: true, published: false, duplicate: false };
      }
      try {
        await this.#publisher.publishDeath(resolvedEvent);
        return { stored: true, published: true, duplicate: false };
      } catch (error: unknown) {
        this.#onError(error instanceof Error ? error : new Error(String(error)));
        return { stored: true, published: false, duplicate: false };
      }
    } catch (error: unknown) {
      this.#health = "degraded";
      this.#onError(error instanceof Error ? error : new Error(String(error)));
      return { stored: false, published: false, duplicate: false };
    }
  }

  #resolveKnownPlayers(event: PlayerDeathEvent): PlayerDeathEvent {
    const victimPlayer = this.#database.findUnambiguousPlayerByName(event.victimName);
    const killerPlayer =
      event.killerName === undefined
        ? undefined
        : this.#database.findUnambiguousPlayerByName(event.killerName);
    const classification =
      event.classification === "unknown" && killerPlayer !== undefined
        ? "player_kill"
        : event.classification;
    return {
      ...event,
      classification,
      ...(victimPlayer === undefined ? {} : { victimIdentityKey: victimPlayer.identity_key }),
      ...(killerPlayer === undefined ? {} : { killerIdentityKey: killerPlayer.identity_key }),
    };
  }

  #expire(now: number): void {
    for (const [fingerprint, occurredAt] of this.#recentEvents) {
      if (now - occurredAt > this.#settings.duplicateWindowMilliseconds) {
        this.#recentEvents.delete(fingerprint);
      }
    }
  }

  public get health(): ComponentHealthState {
    return this.#health;
  }

  public noteUnsupportedEventFormat(): void {
    if (!this.#settings.trackingEnabled || this.#recognizedEvent) return;
    this.#unsupportedEventFormatObserved = true;
    this.#health = "degraded";
  }

  public get parserStatus():
    "parser-available-no-live-sample" | "recognized" | "incompatible" | "disabled" {
    if (!this.#settings.trackingEnabled) return "disabled";
    if (this.#recognizedEvent) return "recognized";
    return this.#unsupportedEventFormatObserved
      ? "incompatible"
      : "parser-available-no-live-sample";
  }
}
