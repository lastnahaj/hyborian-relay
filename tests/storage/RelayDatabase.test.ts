import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { parseDeathEvent } from "../../src/conan/logs/parseDeathEvent.js";
import { RelayDatabase } from "../../src/storage/RelayDatabase.js";

const temporaryDirectories: string[] = [];

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hyborian-relay-db-"));
  temporaryDirectories.push(directory);
  return join(directory, "relay.db");
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("SQLite persistence", () => {
  it("applies the ordered migration once and reopens with WAL and foreign keys", async () => {
    const path = await databasePath();
    const first = new RelayDatabase(path);
    first.close();
    const reopened = new RelayDatabase(path);
    reopened.verifyWritable();
    reopened.close();

    const inspection = new Database(path, { readonly: true });
    expect(inspection.prepare("SELECT name FROM schema_migrations ORDER BY name").all()).toEqual([
      { name: "001_initial_schema" },
    ]);
    expect(inspection.pragma("journal_mode", { simple: true })).toBe("wal");
    inspection.close();
  });

  it("rolls back a migration that cannot complete", async () => {
    const path = await databasePath();
    const conflictingDatabase = new Database(path);
    conflictingDatabase.exec("CREATE TABLE player_sessions (id INTEGER PRIMARY KEY)");
    conflictingDatabase.close();

    expect(() => new RelayDatabase(path)).toThrow("migrations could not be applied");
    const inspection = new Database(path, { readonly: true });
    const tables = inspection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).not.toContain("players");
    expect(tables.map(({ name }) => name)).toContain("player_sessions");
    expect(inspection.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: 0,
    });
    inspection.close();
  });

  it("upserts players without merging equal display names across stable identities", async () => {
    const path = await databasePath();
    const database = new RelayDatabase(path);
    const observedAt = new Date("2026-08-21T20:00:00.000Z");
    database.upsertPlayer(
      { identityKey: "funcom:rhovan-one", characterName: "Rhovan" },
      observedAt,
    );
    database.upsertPlayer(
      { identityKey: "funcom:rhovan-two", characterName: "Rhovan" },
      observedAt,
    );

    expect(database.findUnambiguousPlayerByName("Rhovan")).toBeUndefined();
    expect(database.findPlayerByIdentityKey("funcom:rhovan-one")?.id).toBeTypeOf("number");
    database.close();
  });

  it("opens, confirms, closes, and recovers sessions using UTC timestamps", async () => {
    const path = await databasePath();
    const database = new RelayDatabase(path);
    const playerIdentifier = database.upsertPlayer(
      { identityKey: "funcom:selvara", characterName: "Selvara" },
      new Date("2026-08-21T20:00:00.000Z"),
    );
    database.openSession(
      playerIdentifier,
      "Selvara",
      new Date("2026-08-21T20:00:00.000Z"),
      "confirmed_join",
    );
    database.confirmSessionOnline(playerIdentifier, new Date("2026-08-21T20:30:00.000Z"));
    database.closeSession(
      playerIdentifier,
      new Date("2026-08-21T20:31:00.000Z"),
      "confirmed_leave",
    );
    database.openSession(
      playerIdentifier,
      "Selvara",
      new Date("2026-08-21T21:00:00.000Z"),
      "current_baseline",
    );
    database.confirmSessionOnline(playerIdentifier, new Date("2026-08-21T21:05:00.000Z"));
    expect(database.recoverOpenSessions()).toBe(1);
    database.close();

    const inspection = new Database(path, { readonly: true });
    const sessions = inspection
      .prepare(
        "SELECT duration_seconds, end_reason, left_at FROM player_sessions ORDER BY joined_at",
      )
      .all();
    expect(sessions).toEqual([
      {
        duration_seconds: 1_800,
        end_reason: "confirmed_leave",
        left_at: "2026-08-21T20:30:00.000Z",
      },
      {
        duration_seconds: 300,
        end_reason: "relay_restart_recovery",
        left_at: "2026-08-21T21:05:00.000Z",
      },
    ]);
    inspection.close();
  });

  it("stores one death with nullable identities and a unique source fingerprint", async () => {
    const path = await databasePath();
    const database = new RelayDatabase(path);
    const death = parseDeathEvent(
      "[2026.08.21-23.00.00:000][Pippi]PippiEvent: Elsyra died from heatstroke.",
    );
    if (death === undefined) throw new Error("Death fixture did not parse.");

    expect(database.recordDeath(death)).toBe(true);
    expect(database.recordDeath(death)).toBe(false);
    database.recordServerEvent("offline", new Date("2026-08-21T23:10:00.000Z"), "RCON closed");
    database.setMetadata("discord_status_message_id", "623456789012345678");
    expect(database.getMetadata("discord_status_message_id")).toBe("623456789012345678");
    database.close();

    const inspection = new Database(path, { readonly: true });
    expect(inspection.prepare("SELECT COUNT(*) AS count FROM death_events").get()).toEqual({
      count: 1,
    });
    expect(inspection.prepare("SELECT COUNT(*) AS count FROM server_events").get()).toEqual({
      count: 1,
    });
    inspection.close();
  });

  it("stores proven victim and killer relations without inventing an unknown relation", async () => {
    const path = await databasePath();
    const database = new RelayDatabase(path);
    const observedAt = new Date("2026-08-21T22:00:00.000Z");
    const victimIdentifier = database.upsertPlayer(
      { identityKey: "funcom:varodan", characterName: "Varodan" },
      observedAt,
    );
    const killerIdentifier = database.upsertPlayer(
      { identityKey: "funcom:drenik", characterName: "Drenik" },
      observedAt,
    );
    const provenDeath = parseDeathEvent(
      "[2026.08.21-22.10.00:000][Pippi]PippiEvent: Varodan was killed by player Drenik.",
    );
    const unknownDeath = parseDeathEvent(
      "[2026.08.21-22.11.00:000][Pippi]PippiEvent: Kessira was killed by a Sand Reaper Queen.",
    );
    if (provenDeath === undefined || unknownDeath === undefined) {
      throw new Error("Death relation fixtures did not parse.");
    }
    provenDeath.victimIdentityKey = "funcom:varodan";
    provenDeath.killerIdentityKey = "funcom:drenik";
    database.recordDeath(provenDeath);
    database.recordDeath(unknownDeath);
    database.close();

    const inspection = new Database(path, { readonly: true });
    expect(
      inspection
        .prepare(
          "SELECT victim_player_id, killer_player_id FROM death_events WHERE victim_name = 'Varodan'",
        )
        .get(),
    ).toEqual({
      victim_player_id: victimIdentifier,
      killer_player_id: killerIdentifier,
    });
    expect(
      inspection
        .prepare("SELECT killer_player_id FROM death_events WHERE victim_name = 'Kessira'")
        .get(),
    ).toEqual({ killer_player_id: null });
    inspection.close();
  });
});
