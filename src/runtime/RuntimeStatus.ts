import type { RconConnectionState } from "../conan/rcon/ConanRconClient.js";
import type { ActiveGameChatTransport } from "../conan/rcon/detectRconCapabilities.js";
import type {
  ComponentHealthState,
  PlayerSnapshot,
  ServerHealthState,
} from "../tracking/PlayerTracker.js";

export type DiscordHealthState =
  "connecting" | "connected" | "disconnected" | "authentication-failed";
export type DatabaseHealthState = "healthy" | "degraded";

export interface RuntimeStatusSnapshot {
  discord: DiscordHealthState;
  rcon: RconConnectionState;
  conanServer: ServerHealthState;
  discordToGameTransport: ActiveGameChatTransport;
  gameToDiscordChat: ComponentHealthState;
  playerTracking: ComponentHealthState;
  sessionTracking: ComponentHealthState;
  deathTracking: ComponentHealthState;
  deathParserStatus: "parser-available-no-live-sample" | "recognized" | "incompatible" | "disabled";
  database: DatabaseHealthState;
  playerSnapshot: PlayerSnapshot;
  maximumPlayers?: number;
  uptimeSeconds: number;
}

export type RuntimeStatusProvider = () => RuntimeStatusSnapshot;

export function requiredServicesAreReady(status: RuntimeStatusSnapshot): boolean {
  return (
    status.discord === "connected" &&
    status.database === "healthy" &&
    status.rcon === "connected" &&
    status.discordToGameTransport !== "unavailable" &&
    status.gameToDiscordChat !== "degraded" &&
    status.playerTracking !== "degraded" &&
    (status.playerTracking === "disabled" || status.conanServer === "online") &&
    status.sessionTracking !== "degraded" &&
    status.deathTracking !== "degraded"
  );
}
