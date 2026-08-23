import { createServer, type Server } from "node:http";

import { getApplicationVersion } from "../applicationVersion.js";
import { requiredServicesAreReady, type RuntimeStatusProvider } from "../runtime/RuntimeStatus.js";

export interface HealthServerSettings {
  host: string;
  port: number;
}

export interface RunningHealthServer {
  port: number;
  close(): Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

export async function startHealthServer(
  settings: HealthServerSettings,
  statusProvider: RuntimeStatusProvider,
): Promise<RunningHealthServer> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.method !== "GET") {
      response.writeHead(405).end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }
    if (request.url === "/health/live") {
      response.writeHead(200).end(JSON.stringify({ status: "alive" }));
      return;
    }
    const status = statusProvider();
    if (request.url === "/health/ready") {
      const ready = requiredServicesAreReady(status);
      response
        .writeHead(ready ? 200 : 503)
        .end(JSON.stringify({ status: ready ? "ready" : "not_ready" }));
      return;
    }
    if (request.url === "/health") {
      const ready = requiredServicesAreReady(status);
      response.writeHead(ready ? 200 : 503).end(
        JSON.stringify({
          status: ready ? "healthy" : "degraded",
          version: getApplicationVersion(),
          discord: status.discord,
          rcon: status.rcon,
          conanServer: status.conanServer,
          discordToGameChat: status.discordToGameTransport,
          gameToDiscordChat: status.gameToDiscordChat,
          playerTracking: status.playerTracking,
          sessionTracking: status.sessionTracking,
          deathTracking: status.deathTracking,
          database: status.database,
          playersOnline: status.playerSnapshot.players.length,
          uptimeSeconds: status.uptimeSeconds,
        }),
      );
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.port, settings.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Health server did not bind to a TCP port.");
  }
  return { port: address.port, close: () => closeServer(server) };
}
