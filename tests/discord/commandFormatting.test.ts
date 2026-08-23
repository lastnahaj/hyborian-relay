import { describe, expect, it } from "vitest";

import {
  formatPlayersCommand,
  formatStatusCommand,
} from "../../src/discord/registerDiscordCommands.js";
import type { RuntimeStatusSnapshot } from "../../src/runtime/RuntimeStatus.js";

function healthyStatus(): RuntimeStatusSnapshot {
  return {
    discord: "connected",
    rcon: "connected",
    conanServer: "online",
    discordToGameTransport: "pippi-server",
    gameToDiscordChat: "healthy",
    playerTracking: "healthy",
    sessionTracking: "healthy",
    deathTracking: "healthy",
    deathParserStatus: "recognized",
    database: "healthy",
    playerSnapshot: {
      players: [
        { identityKey: "funcom:brannoc", characterName: "Brannoc" },
        { identityKey: "funcom:nyssara", characterName: "Nyssara" },
        { identityKey: "funcom:rhovan", characterName: "Rhovan" },
        { identityKey: "funcom:selvara", characterName: "Selvara" },
      ],
      obtainedAt: new Date("2026-08-21T20:00:00.000Z"),
      stale: false,
    },
    maximumPlayers: 40,
    uptimeSeconds: 288_000,
  };
}

describe("Discord command rendering", () => {
  it("renders a sorted player snapshot with capacity", () => {
    expect(formatPlayersCommand(healthyStatus(), new Date("2026-08-21T20:00:05.000Z"))).toBe(
      "Players Online — 4 / 40\n\nBrannoc\nNyssara\nRhovan\nSelvara",
    );
  });

  it("labels stale player data rather than presenting it as live", () => {
    const status = healthyStatus();
    status.playerSnapshot.stale = true;
    expect(formatPlayersCommand(status, new Date("2026-08-21T20:01:00.000Z"))).toContain(
      "Stale (60 seconds old)",
    );
  });

  it("describes an unavailable snapshot and an empty live server naturally", () => {
    const unavailable = healthyStatus();
    delete unavailable.maximumPlayers;
    unavailable.playerSnapshot = { players: [], stale: true };
    expect(formatPlayersCommand(unavailable)).toContain("no successful snapshot");
    unavailable.playerSnapshot = { players: [], stale: false, obtainedAt: new Date() };
    expect(formatPlayersCommand(unavailable)).toContain("No players online.");
  });

  it("reports every tracked component and an actionable death-parser reason", () => {
    const status = healthyStatus();
    status.deathTracking = "degraded";
    status.deathParserStatus = "incompatible";
    status.playerSnapshot.stale = true;
    const response = formatStatusCommand(status, new Date("2026-08-21T20:01:00.000Z"));

    expect(response).toContain("Conan Server: Online");
    expect(response).toContain("Players: 4 / 40");
    expect(response).toContain("Player Snapshot: 60 seconds old — stale");
    expect(response).toContain(
      "Death Tracking: Degraded — no supported death event format has been confirmed",
    );
    expect(response).toContain("Relay Uptime: 3 days, 8 hours");
  });

  it("reports an available death parser without making the first live death a readiness gate", () => {
    const status = healthyStatus();
    status.deathParserStatus = "parser-available-no-live-sample";
    expect(formatStatusCommand(status, new Date("2026-08-21T20:00:05.000Z"))).toContain(
      "Death Tracking: Healthy — parser available, no live sample observed",
    );
  });
});
