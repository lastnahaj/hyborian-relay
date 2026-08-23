import { describe, expect, it } from "vitest";

import {
  createGameChatCommand,
  determineGameChatTransport,
  helpConfirmsPippiServerChat,
} from "../../src/conan/rcon/detectRconCapabilities.js";

describe("Pippi chat capability detection", () => {
  it("accepts a clear server-message command and rejects ambiguous help text", () => {
    expect(helpConfirmsPippiServerChat("server <message>\nlistplayers")).toBe(true);
    expect(helpConfirmsPippiServerChat("server settings are available\nlistplayers")).toBe(false);
  });

  it("never falls back to broadcast in automatic mode", () => {
    expect(determineGameChatTransport("automatic", "broadcast <message>").transport).toBe(
      "unavailable",
    );
    expect(determineGameChatTransport("broadcast").transport).toBe("broadcast");
    expect(determineGameChatTransport("disabled").transport).toBe("disabled");
    expect(determineGameChatTransport("pippi-server").transport).toBe("pippi-server");
  });

  it("builds only domain-specific configured chat commands", () => {
    expect(createGameChatCommand("pippi-server", "[Discord] Kessira: The purge is north.")).toBe(
      "server [Discord] Kessira: The purge is north.",
    );
    expect(() => createGameChatCommand("unavailable", "Elsyra: ready")).toThrow(/unavailable/u);
    expect(() => createGameChatCommand("disabled", "Drenik: quiet hours")).toThrow(/disabled/u);
  });
});
