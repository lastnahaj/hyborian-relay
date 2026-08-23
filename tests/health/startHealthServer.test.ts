import { afterEach, describe, expect, it } from "vitest";

import { startHealthServer, type RunningHealthServer } from "../../src/health/startHealthServer.js";
import {
  requiredServicesAreReady,
  type RuntimeStatusSnapshot,
} from "../../src/runtime/RuntimeStatus.js";

const runningServers: RunningHealthServer[] = [];

function status(): RuntimeStatusSnapshot {
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
      players: [{ identityKey: "funcom:varodan", characterName: "Varodan" }],
      obtainedAt: new Date(),
      stale: false,
    },
    uptimeSeconds: 120,
  };
}

afterEach(async () => {
  for (const server of runningServers.splice(0)) await server.close();
});

describe("health HTTP server", () => {
  it("reports liveness, readiness, and sanitized component health", async () => {
    const currentStatus = status();
    const server = await startHealthServer({ host: "127.0.0.1", port: 0 }, () => currentStatus);
    runningServers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;

    expect((await fetch(`${origin}/health/live`)).status).toBe(200);
    expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "healthy",
      playersOnline: 1,
      database: "healthy",
    });
  });

  it("returns 503 readiness without losing process liveness", async () => {
    const currentStatus = status();
    currentStatus.rcon = "reconnecting";
    currentStatus.conanServer = "offline";
    const server = await startHealthServer({ host: "127.0.0.1", port: 0 }, () => currentStatus);
    runningServers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;

    expect((await fetch(`${origin}/health/live`)).status).toBe(200);
    expect((await fetch(`${origin}/health/ready`)).status).toBe(503);
    expect((await fetch(`${origin}/health`)).status).toBe(503);
    expect((await fetch(`${origin}/missing`)).status).toBe(404);
    expect((await fetch(`${origin}/health`, { method: "POST" })).status).toBe(405);
  });

  it("requires enabled chat transport while accepting intentionally disabled tracking", () => {
    const currentStatus = status();
    currentStatus.discordToGameTransport = "unavailable";
    expect(requiredServicesAreReady(currentStatus)).toBe(false);

    currentStatus.discordToGameTransport = "disabled";
    currentStatus.playerTracking = "disabled";
    currentStatus.sessionTracking = "disabled";
    currentStatus.conanServer = "unknown";
    expect(requiredServicesAreReady(currentStatus)).toBe(true);
  });
});
