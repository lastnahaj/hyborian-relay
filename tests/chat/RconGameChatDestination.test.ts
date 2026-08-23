import { describe, expect, it } from "vitest";

import {
  RconGameChatDestination,
  type GameChatCommandExecutor,
} from "../../src/chat/RconGameChatDestination.js";

class RecordingCommandExecutor implements GameChatCommandExecutor {
  readonly commands: string[] = [];

  public async executeCommand(command: string): Promise<string> {
    this.commands.push(command);
    return "Chat message accepted";
  }
}

describe("RCON game-chat destination", () => {
  it("sends only the selected domain chat transport and can update after capability detection", async () => {
    const executor = new RecordingCommandExecutor();
    const destination = new RconGameChatDestination(executor, "pippi-server");
    await destination.sendGameChatMessage("[Discord] Vaelric: The Wine Cellar is open.");
    destination.setTransport("broadcast");
    await destination.sendGameChatMessage("[Discord] Serapha: Sandstorm incoming.");

    expect(executor.commands).toEqual([
      "server [Discord] Vaelric: The Wine Cellar is open.",
      "broadcast [Discord] Serapha: Sandstorm incoming.",
    ]);
  });
});
