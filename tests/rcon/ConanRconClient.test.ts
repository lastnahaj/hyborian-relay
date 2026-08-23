import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ConanRconClient } from "../../src/conan/rcon/ConanRconClient.js";
import {
  encodeRconPacket,
  RconPacketDecoder,
  RconPacketType,
  type RconPacket,
} from "../../src/conan/rcon/RconPacketCodec.js";

interface RunningRconServer {
  port: number;
  server: Server;
}

const runningServers: Server[] = [];

async function startRconServer(
  handlePacket: (packet: RconPacket, socket: Socket) => void,
): Promise<RunningRconServer> {
  const server = createServer((socket) => {
    const decoder = new RconPacketDecoder();
    socket.on("data", (receivedData) => {
      for (const packet of decoder.append(receivedData)) handlePacket(packet, socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  runningServers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Test RCON port unavailable.");
  return { port: address.port, server };
}

function createClient(port: number, timeout = 500): ConanRconClient {
  return new ConanRconClient({
    host: "127.0.0.1",
    port,
    password: "private-rcon-password",
    commandTimeoutMilliseconds: timeout,
    commandQueueLimit: 5,
  });
}

function startAuthenticatedSilentRconServer(): Promise<RunningRconServer> {
  return startRconServer((packet, socket) => {
    if (packet.type === RconPacketType.authentication) {
      socket.write(
        encodeRconPacket({
          requestIdentifier: packet.requestIdentifier,
          type: RconPacketType.authenticationResponse,
          payload: "",
        }),
      );
    }
  });
}

afterEach(async () => {
  for (const server of runningServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("Conan RCON client", () => {
  it("authenticates and combines a multi-packet command response", async () => {
    const rconServer = await startRconServer((packet, socket) => {
      if (packet.type === RconPacketType.authentication) {
        socket.write(
          encodeRconPacket({
            requestIdentifier: packet.requestIdentifier,
            type: RconPacketType.authenticationResponse,
            payload: "",
          }),
        );
      } else {
        socket.write(
          Buffer.concat([
            encodeRconPacket({
              requestIdentifier: packet.requestIdentifier,
              type: RconPacketType.responseValue,
              payload: "Brannoc|",
            }),
            encodeRconPacket({
              requestIdentifier: packet.requestIdentifier,
              type: RconPacketType.responseValue,
              payload: "Varodan",
            }),
          ]),
        );
      }
    });
    const client = createClient(rconServer.port);

    await client.connect();
    await expect(client.executeCommand("listplayers", "interactive-status")).resolves.toBe(
      "Brannoc|Varodan",
    );
    expect(client.state).toBe("connected");
    await client.close();
  });

  it("distinguishes authentication failure without exposing the password", async () => {
    const rconServer = await startRconServer((_packet, socket) => {
      socket.write(
        encodeRconPacket({
          requestIdentifier: -1,
          type: RconPacketType.authenticationResponse,
          payload: "",
        }),
      );
    });
    const client = createClient(rconServer.port);

    await expect(client.connect()).rejects.toMatchObject({ code: "RCON_AUTHENTICATION_FAILED" });
    await expect(client.connect()).rejects.not.toThrow(/private-rcon-password/u);
    await client.close();
  });

  it("times out a command that receives no response", async () => {
    const rconServer = await startAuthenticatedSilentRconServer();
    const client = createClient(rconServer.port, 60);

    await client.connect();
    await expect(client.executeCommand("help", "interactive-status")).rejects.toMatchObject({
      code: "RCON_COMMAND_TIMEOUT",
    });
    await client.close();
  });

  it("rejects an active command promptly when shutdown begins", async () => {
    const rconServer = await startAuthenticatedSilentRconServer();
    const client = createClient(rconServer.port, 10_000);
    await client.connect();

    const pendingCommand = client.executeCommand("listplayers", "background-tracking");
    const closing = client.close();
    await expect(pendingCommand).rejects.toThrow("closing");
    await expect(closing).resolves.toBeUndefined();
  });
});
