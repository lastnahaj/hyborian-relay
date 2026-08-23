import {
  createGameChatCommand,
  type ActiveGameChatTransport,
} from "../conan/rcon/detectRconCapabilities.js";
import type { GameChatDestination } from "./relayDiscordMessageToConan.js";

export class RconGameChatDestination implements GameChatDestination {
  readonly #rconClient: GameChatCommandExecutor;
  #transport: ActiveGameChatTransport;

  public constructor(rconClient: GameChatCommandExecutor, transport: ActiveGameChatTransport) {
    this.#rconClient = rconClient;
    this.#transport = transport;
  }

  public setTransport(transport: ActiveGameChatTransport): void {
    this.#transport = transport;
  }

  public async sendGameChatMessage(renderedMessage: string): Promise<void> {
    const command = createGameChatCommand(this.#transport, renderedMessage);
    await this.#rconClient.executeCommand(command, "chat");
  }
}

export interface GameChatCommandExecutor {
  executeCommand(command: string, priority: "chat"): Promise<string>;
}
