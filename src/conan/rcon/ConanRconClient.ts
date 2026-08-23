import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";

import { RelayError, describeUnknownError } from "../../errors/RelayError.js";
import { RconCommandQueue, type RconCommandPriority } from "./RconCommandQueue.js";
import {
  RconPacketDecoder,
  RconPacketType,
  encodeRconPacket,
  type RconPacket,
} from "./RconPacketCodec.js";

export type RconConnectionState =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "closed";

export interface RconClientSettings {
  host: string;
  port: number;
  password: string;
  commandTimeoutMilliseconds: number;
  commandQueueLimit: number;
}

interface PendingCommand {
  responseParts: string[];
  timeout: NodeJS.Timeout;
  completionDelay?: NodeJS.Timeout;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
}

interface AuthenticationAttempt {
  requestIdentifier: number;
  timeout: NodeJS.Timeout;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class ConanRconClient extends EventEmitter {
  readonly #settings: RconClientSettings;
  readonly #queue: RconCommandQueue;
  readonly #pendingCommands = new Map<number, PendingCommand>();
  #socket: Socket | undefined;
  #decoder = new RconPacketDecoder();
  #authenticationAttempt: AuthenticationAttempt | undefined;
  #connectionAttempt: Promise<void> | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #requestIdentifier = 1;
  #reconnectAttempt = 0;
  #running = false;
  #state: RconConnectionState = "disconnected";

  public constructor(settings: RconClientSettings) {
    super();
    this.#settings = settings;
    this.#queue = new RconCommandQueue(settings.commandQueueLimit);
  }

  public async connect(): Promise<void> {
    this.#running = true;
    await this.#beginConnection();
  }

  public start(): void {
    this.#running = true;
    void this.#beginConnection().catch((error: unknown) => {
      this.emit("connectionError", error);
      this.#scheduleReconnect();
    });
  }

  async #beginConnection(): Promise<void> {
    if (this.#state === "connected") return;
    if (this.#connectionAttempt !== undefined) return this.#connectionAttempt;
    this.#setState(this.#reconnectAttempt === 0 ? "connecting" : "reconnecting");
    this.#connectionAttempt = this.#connectAndAuthenticate();
    try {
      await this.#connectionAttempt;
      this.#reconnectAttempt = 0;
      this.#setState("connected");
    } finally {
      this.#connectionAttempt = undefined;
    }
  }

  async #connectAndAuthenticate(): Promise<void> {
    const socket = createConnection({ host: this.#settings.host, port: this.#settings.port });
    this.#socket = socket;
    this.#decoder = new RconPacketDecoder();
    socket.setNoDelay(true);
    socket.on("data", (receivedData) => this.#handleData(receivedData));
    socket.on("close", () => this.#handleSocketClose(socket));
    socket.on("error", (error) => this.#handleSocketError(socket, error));

    await new Promise<void>((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        socket.off("connect", onConnect);
        socket.off("error", onInitialError);
        reject(
          new RelayError(
            "RCON_CONNECTION_FAILED",
            `RCON connection to ${this.#settings.host}:${this.#settings.port} timed out after ${this.#settings.commandTimeoutMilliseconds} milliseconds.`,
          ),
        );
        socket.destroy();
      }, this.#settings.commandTimeoutMilliseconds);
      const onConnect = (): void => {
        clearTimeout(connectionTimeout);
        socket.off("error", onInitialError);
        resolve();
      };
      const onInitialError = (error: Error): void => {
        clearTimeout(connectionTimeout);
        socket.off("connect", onConnect);
        reject(
          new RelayError(
            "RCON_CONNECTION_FAILED",
            `Could not connect to RCON at ${this.#settings.host}:${this.#settings.port}: ${error.message}`,
            { cause: error },
          ),
        );
      };
      socket.once("connect", onConnect);
      socket.once("error", onInitialError);
    });
    await this.#authenticate(socket);
  }

  async #authenticate(socket: Socket): Promise<void> {
    const requestIdentifier = this.#nextRequestIdentifier();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#authenticationAttempt = undefined;
        reject(
          new RelayError(
            "RCON_COMMAND_TIMEOUT",
            `RCON authentication timed out after ${this.#settings.commandTimeoutMilliseconds} milliseconds.`,
          ),
        );
        socket.destroy();
      }, this.#settings.commandTimeoutMilliseconds);
      this.#authenticationAttempt = { requestIdentifier, timeout, resolve, reject };
      socket.write(
        encodeRconPacket({
          requestIdentifier,
          type: RconPacketType.authentication,
          payload: this.#settings.password,
        }),
      );
    });
  }

  #handleData(receivedData: Buffer): void {
    try {
      for (const packet of this.#decoder.append(receivedData)) this.#handlePacket(packet);
    } catch (error: unknown) {
      const protocolFailure =
        error instanceof RelayError
          ? error
          : new RelayError("RCON_PROTOCOL_ERROR", describeUnknownError(error), { cause: error });
      this.#rejectPending(protocolFailure);
      this.emit("protocolError", protocolFailure);
      this.#socket?.destroy();
    }
  }

  #handlePacket(packet: RconPacket): void {
    const authenticationAttempt = this.#authenticationAttempt;
    if (
      authenticationAttempt !== undefined &&
      packet.type === RconPacketType.authenticationResponse
    ) {
      if (packet.requestIdentifier === -1) {
        clearTimeout(authenticationAttempt.timeout);
        this.#authenticationAttempt = undefined;
        authenticationAttempt.reject(
          new RelayError(
            "RCON_AUTHENTICATION_FAILED",
            `RCON authentication failed for ${this.#settings.host}:${this.#settings.port}. Verify CONAN_RCON_PASSWORD. The password was not logged.`,
          ),
        );
        this.#socket?.destroy();
        return;
      }
      if (packet.requestIdentifier === authenticationAttempt.requestIdentifier) {
        clearTimeout(authenticationAttempt.timeout);
        this.#authenticationAttempt = undefined;
        authenticationAttempt.resolve();
        return;
      }
    }

    const pendingCommand = this.#pendingCommands.get(packet.requestIdentifier);
    if (pendingCommand === undefined) return;
    pendingCommand.responseParts.push(packet.payload);
    if (pendingCommand.completionDelay !== undefined) clearTimeout(pendingCommand.completionDelay);
    pendingCommand.completionDelay = setTimeout(
      () => this.#completeCommand(packet.requestIdentifier),
      25,
    );
  }

  #completeCommand(requestIdentifier: number): void {
    const pendingCommand = this.#pendingCommands.get(requestIdentifier);
    if (pendingCommand === undefined) return;
    clearTimeout(pendingCommand.timeout);
    this.#pendingCommands.delete(requestIdentifier);
    pendingCommand.resolve(pendingCommand.responseParts.join(""));
  }

  public executeCommand(command: string, priority: RconCommandPriority): Promise<string> {
    return this.#queue.enqueue(() => this.#executeCommandNow(command), priority);
  }

  async #executeCommandNow(command: string): Promise<string> {
    const socket = this.#socket;
    if (this.#state !== "connected" || socket === undefined || socket.destroyed) {
      throw new RelayError("RCON_CONNECTION_FAILED", "RCON is not connected.");
    }
    const requestIdentifier = this.#nextRequestIdentifier();
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingCommands.delete(requestIdentifier);
        reject(
          new RelayError(
            "RCON_COMMAND_TIMEOUT",
            `RCON command ${requestIdentifier} timed out after ${this.#settings.commandTimeoutMilliseconds} milliseconds.`,
          ),
        );
      }, this.#settings.commandTimeoutMilliseconds);
      this.#pendingCommands.set(requestIdentifier, { responseParts: [], timeout, resolve, reject });
      socket.write(
        encodeRconPacket({ requestIdentifier, type: RconPacketType.command, payload: command }),
      );
    });
  }

  #nextRequestIdentifier(): number {
    const currentIdentifier = this.#requestIdentifier;
    this.#requestIdentifier = currentIdentifier >= 2_147_483_646 ? 1 : currentIdentifier + 1;
    return currentIdentifier;
  }

  #handleSocketError(socket: Socket, error: Error): void {
    if (socket !== this.#socket) return;
    this.emit("socketError", error);
  }

  #handleSocketClose(socket: Socket): void {
    if (socket !== this.#socket) return;
    this.#socket = undefined;
    const connectionFailure = new RelayError(
      "RCON_CONNECTION_FAILED",
      `RCON connection to ${this.#settings.host}:${this.#settings.port} closed.`,
    );
    const authenticationAttempt = this.#authenticationAttempt;
    if (authenticationAttempt !== undefined) {
      clearTimeout(authenticationAttempt.timeout);
      this.#authenticationAttempt = undefined;
      authenticationAttempt.reject(connectionFailure);
    }
    this.#rejectPending(connectionFailure);
    if (this.#running) {
      this.#setState("reconnecting");
      this.#scheduleReconnect();
    }
  }

  #rejectPending(error: Error): void {
    for (const pendingCommand of this.#pendingCommands.values()) {
      clearTimeout(pendingCommand.timeout);
      if (pendingCommand.completionDelay !== undefined)
        clearTimeout(pendingCommand.completionDelay);
      pendingCommand.reject(error);
    }
    this.#pendingCommands.clear();
  }

  #scheduleReconnect(): void {
    if (!this.#running || this.#reconnectTimer !== undefined) return;
    const baseDelay = Math.min(60_000, 1_000 * 2 ** Math.min(this.#reconnectAttempt, 6));
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#beginConnection().catch((error: unknown) => {
        this.emit("connectionError", error);
        this.#scheduleReconnect();
      });
    }, delay);
  }

  #setState(state: RconConnectionState): void {
    if (state === this.#state) return;
    this.#state = state;
    this.emit("stateChanged", state);
  }

  public async close(): Promise<void> {
    this.#running = false;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#rejectPending(new Error("RCON client is closing."));
    this.#socket?.destroy();
    this.#socket = undefined;
    await this.#queue.close();
    this.#setState("closed");
  }

  public get state(): RconConnectionState {
    return this.#state;
  }
}
