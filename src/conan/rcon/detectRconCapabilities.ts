import { RelayError } from "../../errors/RelayError.js";

export type ConfiguredGameChatTransport = "automatic" | "pippi-server" | "broadcast" | "disabled";
export type ActiveGameChatTransport = "pippi-server" | "broadcast" | "disabled" | "unavailable";

export interface GameChatTransportDecision {
  transport: ActiveGameChatTransport;
  reason: string;
}

export function helpConfirmsPippiServerChat(helpResponse: string): boolean {
  return /(?:^|\r?\n)\s*\/?server\s+(?:<[^>]*(?:message|text)[^>]*>|-\s*[^\r\n]*(?:message|chat))/imu.test(
    helpResponse,
  );
}

export function determineGameChatTransport(
  configuredTransport: ConfiguredGameChatTransport,
  helpResponse?: string,
): GameChatTransportDecision {
  if (configuredTransport === "disabled") {
    return { transport: "disabled", reason: "Disabled by GAME_CHAT_TRANSPORT." };
  }
  if (configuredTransport === "pippi-server") {
    return { transport: "pippi-server", reason: "Selected explicitly by the operator." };
  }
  if (configuredTransport === "broadcast") {
    return { transport: "broadcast", reason: "Selected explicitly by the operator." };
  }
  if (helpResponse !== undefined && helpConfirmsPippiServerChat(helpResponse)) {
    return { transport: "pippi-server", reason: "The RCON help response confirmed server chat." };
  }
  return {
    transport: "unavailable",
    reason:
      "RCON help did not confirm a Pippi server-chat command; broadcast fallback is never automatic.",
  };
}

export function createGameChatCommand(
  transport: ActiveGameChatTransport,
  renderedMessage: string,
): string {
  if (transport === "pippi-server") return `server ${renderedMessage}`;
  if (transport === "broadcast") return `broadcast ${renderedMessage}`;
  throw new RelayError(
    "RCON_CHAT_TRANSPORT_UNAVAILABLE",
    transport === "disabled"
      ? "Discord-to-Conan chat is disabled."
      : "Discord-to-Conan chat is unavailable because no safe transport was confirmed.",
  );
}
