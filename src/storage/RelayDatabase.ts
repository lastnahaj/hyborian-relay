import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { PlayerDeathEvent } from "../conan/logs/parseDeathEvent.js";
import type { ConanPlayer } from "../conan/players/parsePlayerListResponse.js";
import { RelayError } from "../errors/RelayError.js";

const initialMigration = `
  CREATE TABLE players (
    id INTEGER PRIMARY KEY,
    identity_key TEXT NOT NULL UNIQUE,
    character_name TEXT NOT NULL,
    platform_identifier TEXT,
    funcom_identifier TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE player_sessions (
    id INTEGER PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id),
    character_name TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    last_confirmed_online_at TEXT NOT NULL,
    left_at TEXT,
    duration_seconds INTEGER,
    start_reason TEXT NOT NULL,
    end_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX player_sessions_open_by_player ON player_sessions(player_id) WHERE left_at IS NULL;

  CREATE TABLE death_events (
    id INTEGER PRIMARY KEY,
    victim_player_id INTEGER REFERENCES players(id),
    victim_name TEXT NOT NULL,
    killer_player_id INTEGER REFERENCES players(id),
    killer_name TEXT,
    classification TEXT NOT NULL,
    cause TEXT,
    occurred_at TEXT NOT NULL,
    source TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX death_events_victim_time ON death_events(victim_name, occurred_at DESC);

  CREATE TABLE server_events (
    id INTEGER PRIMARY KEY,
    state TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE application_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

interface PlayerRecord {
  id: number;
  identity_key: string;
}

interface SessionRecord {
  id: number;
  joined_at: string;
  last_confirmed_online_at: string;
}

interface MetadataRecord {
  value: string;
}

function asIsoString(date: Date): string {
  return date.toISOString();
}

export class RelayDatabase {
  readonly #database: Database.Database;

  public constructor(path: string) {
    let openedDatabase: Database.Database | undefined;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      openedDatabase = new Database(path);
      this.#database = openedDatabase;
      this.#database.pragma("journal_mode = WAL");
      this.#database.pragma("foreign_keys = ON");
      this.#database.pragma("busy_timeout = 5000");
      this.#applyMigrations();
    } catch (error: unknown) {
      openedDatabase?.close();
      if (error instanceof RelayError) throw error;
      throw new RelayError("DATABASE_OPEN_FAILED", `Could not open SQLite database at ${path}.`, {
        cause: error,
      });
    }
  }

  #applyMigrations(): void {
    try {
      this.#database.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      const migration = this.#database.transaction(() => {
        const applied = this.#database
          .prepare("SELECT 1 FROM schema_migrations WHERE name = ?")
          .get("001_initial_schema");
        if (applied !== undefined) return;
        this.#database.exec(initialMigration);
        this.#database
          .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
          .run("001_initial_schema", new Date().toISOString());
      });
      migration();
    } catch (error: unknown) {
      throw new RelayError("DATABASE_MIGRATION_FAILED", "SQLite migrations could not be applied.", {
        cause: error,
      });
    }
  }

  public upsertPlayer(player: ConanPlayer, observedAt: Date): number {
    const timestamp = asIsoString(observedAt);
    this.#database
      .prepare(
        `INSERT INTO players (
          identity_key, character_name, platform_identifier, funcom_identifier,
          first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(identity_key) DO UPDATE SET
          character_name = excluded.character_name,
          platform_identifier = COALESCE(excluded.platform_identifier, players.platform_identifier),
          funcom_identifier = COALESCE(excluded.funcom_identifier, players.funcom_identifier),
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        player.identityKey,
        player.characterName,
        player.platformIdentifier ?? null,
        player.funcomIdentifier ?? null,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      );
    const record = this.#database
      .prepare("SELECT id, identity_key FROM players WHERE identity_key = ?")
      .get(player.identityKey) as PlayerRecord | undefined;
    if (record === undefined) throw new Error("Player upsert did not return a stored player.");
    return record.id;
  }

  public findUnambiguousPlayerByName(characterName: string): PlayerRecord | undefined {
    const records = this.#database
      .prepare(
        "SELECT id, identity_key FROM players WHERE character_name = ? COLLATE NOCASE ORDER BY last_seen_at DESC LIMIT 2",
      )
      .all(characterName) as PlayerRecord[];
    return records.length === 1 ? records[0] : undefined;
  }

  public findPlayerByIdentityKey(identityKey: string): PlayerRecord | undefined {
    return this.#database
      .prepare("SELECT id, identity_key FROM players WHERE identity_key = ?")
      .get(identityKey) as PlayerRecord | undefined;
  }

  public openSession(
    playerIdentifier: number,
    characterName: string,
    joinedAt: Date,
    reason: string,
  ): void {
    const timestamp = asIsoString(joinedAt);
    const existing = this.#database
      .prepare("SELECT id FROM player_sessions WHERE player_id = ? AND left_at IS NULL")
      .get(playerIdentifier);
    if (existing !== undefined) return;
    this.#database
      .prepare(
        `INSERT INTO player_sessions (
          player_id, character_name, joined_at, last_confirmed_online_at,
          start_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(playerIdentifier, characterName, timestamp, timestamp, reason, timestamp, timestamp);
  }

  public confirmSessionOnline(playerIdentifier: number, confirmedAt: Date): void {
    const timestamp = asIsoString(confirmedAt);
    this.#database
      .prepare(
        `UPDATE player_sessions SET last_confirmed_online_at = ?, updated_at = ?
         WHERE player_id = ? AND left_at IS NULL`,
      )
      .run(timestamp, timestamp, playerIdentifier);
  }

  public closeSession(playerIdentifier: number, leftAt: Date, reason: string): void {
    const session = this.#database
      .prepare(
        `SELECT id, joined_at, last_confirmed_online_at FROM player_sessions
         WHERE player_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1`,
      )
      .get(playerIdentifier) as SessionRecord | undefined;
    if (session === undefined) return;
    const effectiveLeftAt = new Date(
      Math.min(leftAt.getTime(), new Date(session.last_confirmed_online_at).getTime()),
    );
    const durationSeconds = Math.max(
      0,
      Math.floor((effectiveLeftAt.getTime() - new Date(session.joined_at).getTime()) / 1_000),
    );
    const timestamp = asIsoString(effectiveLeftAt);
    this.#database
      .prepare(
        `UPDATE player_sessions SET left_at = ?, duration_seconds = ?, end_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, durationSeconds, reason, timestamp, session.id);
  }

  public recoverOpenSessions(): number {
    const sessions = this.#database
      .prepare(
        "SELECT id, joined_at, last_confirmed_online_at FROM player_sessions WHERE left_at IS NULL",
      )
      .all() as SessionRecord[];
    const update = this.#database.prepare(
      `UPDATE player_sessions SET left_at = ?, duration_seconds = ?,
       end_reason = 'relay_restart_recovery', updated_at = ? WHERE id = ?`,
    );
    const recover = this.#database.transaction(() => {
      for (const session of sessions) {
        const durationSeconds = Math.max(
          0,
          Math.floor(
            (new Date(session.last_confirmed_online_at).getTime() -
              new Date(session.joined_at).getTime()) /
              1_000,
          ),
        );
        update.run(
          session.last_confirmed_online_at,
          durationSeconds,
          session.last_confirmed_online_at,
          session.id,
        );
      }
    });
    recover();
    return sessions.length;
  }

  public recordDeath(event: PlayerDeathEvent): boolean {
    const victimPlayer =
      event.victimIdentityKey === undefined
        ? this.findUnambiguousPlayerByName(event.victimName)
        : (this.#database
            .prepare("SELECT id, identity_key FROM players WHERE identity_key = ?")
            .get(event.victimIdentityKey) as PlayerRecord | undefined);
    const killerPlayer =
      event.killerIdentityKey === undefined
        ? event.killerName === undefined
          ? undefined
          : this.findUnambiguousPlayerByName(event.killerName)
        : (this.#database
            .prepare("SELECT id, identity_key FROM players WHERE identity_key = ?")
            .get(event.killerIdentityKey) as PlayerRecord | undefined);
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO death_events (
          victim_player_id, victim_name, killer_player_id, killer_name,
          classification, cause, occurred_at, source, source_fingerprint, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        victimPlayer?.id ?? null,
        event.victimName,
        killerPlayer?.id ?? null,
        event.killerName ?? null,
        event.classification,
        event.cause ?? null,
        asIsoString(event.occurredAt),
        event.source,
        event.sourceFingerprint,
        new Date().toISOString(),
      );
    return result.changes === 1;
  }

  public recordServerEvent(state: string, occurredAt: Date, details?: string): void {
    const timestamp = asIsoString(occurredAt);
    this.#database
      .prepare(
        "INSERT INTO server_events (state, occurred_at, details, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(state, timestamp, details ?? null, timestamp);
  }

  public getMetadata(key: string): string | undefined {
    const record = this.#database
      .prepare("SELECT value FROM application_metadata WHERE key = ?")
      .get(key) as MetadataRecord | undefined;
    return record?.value;
  }

  public setMetadata(key: string, value: string): void {
    this.#database
      .prepare(
        `INSERT INTO application_metadata (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  public verifyWritable(): void {
    const verify = this.#database.transaction(() => {
      this.#database.prepare("SELECT 1").get();
    });
    verify();
  }

  public close(): void {
    this.#database.close();
  }
}
