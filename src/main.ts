import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { DiscordjsError, DiscordjsErrorCodes } from "discord.js";

import { ChatEchoMemory } from "./chat/ChatEchoMemory.js";
import { ChatRateLimiter } from "./chat/ChatRateLimiter.js";
import { RconGameChatDestination } from "./chat/RconGameChatDestination.js";
import { relayConanMessageToDiscord } from "./chat/relayConanMessageToDiscord.js";
import { sanitizeGameBoundText } from "./chat/sanitizeGameBoundText.js";
import { getApplicationVersion } from "./applicationVersion.js";
import { ConanLogFollower } from "./conan/logs/followConanLog.js";
import { parseChatEvent } from "./conan/logs/parseChatEvent.js";
import { isPotentialDeathEvent, parseDeathEvent } from "./conan/logs/parseDeathEvent.js";
import { ConanRconClient } from "./conan/rcon/ConanRconClient.js";
import {
  determineGameChatTransport,
  type ActiveGameChatTransport,
} from "./conan/rcon/detectRconCapabilities.js";
import { loadConfiguration } from "./configuration/loadConfiguration.js";
import { createDiscordClient } from "./discord/createDiscordClient.js";
import { DiscordChatRelay } from "./discord/DiscordChatRelay.js";
import { DiscordEventPublisher } from "./discord/DiscordEventPublisher.js";
import { formatStatusCommand, registerDiscordCommands } from "./discord/registerDiscordCommands.js";
import { describeUnknownError } from "./errors/RelayError.js";
import { startHealthServer, type RunningHealthServer } from "./health/startHealthServer.js";
import { createLogger } from "./logging/createLogger.js";
import {
  type DatabaseHealthState,
  type DiscordHealthState,
  type RuntimeStatusProvider,
} from "./runtime/RuntimeStatus.js";
import { InstanceLock } from "./runtime/InstanceLock.js";
import { RelayDatabase } from "./storage/RelayDatabase.js";
import { DeathTracker } from "./tracking/DeathTracker.js";
import { PlayerTracker, type ComponentHealthState } from "./tracking/PlayerTracker.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run(): Promise<void> {
  const configuration = loadConfiguration();
  const logger = createLogger(configuration);
  logger.info({
    component: "runtime",
    event: "startup",
    version: getApplicationVersion(),
  });
  mkdirSync(dirname(configuration.DATABASE_PATH), { recursive: true, mode: 0o700 });
  const instanceLock = new InstanceLock(configuration.DATABASE_PATH);
  instanceLock.acquire();

  let databaseHealth: DatabaseHealthState = "healthy";
  let discordHealth: DiscordHealthState = "connecting";
  let gameToDiscordHealth: ComponentHealthState =
    configuration.CHAT_RELAY_ENABLED && configuration.GAME_TO_DISCORD_CHAT_ENABLED
      ? "healthy"
      : "disabled";
  const discordToGameChatEnabled =
    configuration.CHAT_RELAY_ENABLED && configuration.DISCORD_TO_GAME_CHAT_ENABLED;
  let activeTransport: ActiveGameChatTransport =
    !discordToGameChatEnabled || configuration.GAME_CHAT_TRANSPORT === "disabled"
      ? "disabled"
      : "unavailable";
  let shuttingDown = false;
  const startedAt = Date.now();

  const database = new RelayDatabase(configuration.DATABASE_PATH);
  const recoveredSessions = database.recoverOpenSessions();
  if (recoveredSessions > 0) {
    logger.info({ component: "storage", event: "sessions_recovered", count: recoveredSessions });
  }

  const discordClient = createDiscordClient();
  const rconClient = new ConanRconClient({
    host: configuration.CONAN_RCON_HOST,
    port: configuration.CONAN_RCON_PORT,
    password: configuration.CONAN_RCON_PASSWORD,
    commandTimeoutMilliseconds: configuration.RCON_COMMAND_TIMEOUT_MILLISECONDS,
    commandQueueLimit: configuration.RCON_COMMAND_QUEUE_LIMIT,
  });
  const discordPublisher = new DiscordEventPublisher(discordClient, database, {
    chatChannelIdentifier: configuration.DISCORD_CHAT_CHANNEL_ID,
    eventChannelIdentifier: configuration.DISCORD_EVENT_CHANNEL_ID,
    ...(configuration.DISCORD_DEATH_CHANNEL_ID === undefined
      ? {}
      : { deathChannelIdentifier: configuration.DISCORD_DEATH_CHANNEL_ID }),
    ...(configuration.DISCORD_STATUS_MESSAGE_ENABLED &&
    configuration.DISCORD_STATUS_CHANNEL_ID !== undefined
      ? { statusChannelIdentifier: configuration.DISCORD_STATUS_CHANNEL_ID }
      : {}),
    pendingEventLimit: configuration.DISCORD_PENDING_EVENT_LIMIT,
    gameChatRendering: configuration.DISCORD_GAME_CHAT_RENDERING,
    ...(configuration.DISCORD_GAME_CHAT_WEBHOOK_URL === undefined
      ? {}
      : { gameChatWebhookUrl: configuration.DISCORD_GAME_CHAT_WEBHOOK_URL }),
  });

  const componentError = (error: Error): void => {
    if ("code" in error && typeof error.code === "string" && error.code.startsWith("SQLITE")) {
      databaseHealth = "degraded";
    }
    logger.error({
      component: "runtime",
      event: "component_error",
      errorCode: "code" in error ? error.code : undefined,
      error: error.message,
    });
  };

  const playerTracker = new PlayerTracker(
    rconClient,
    database,
    discordPublisher,
    {
      pollIntervalMilliseconds: configuration.PLAYER_POLL_INTERVAL_SECONDS * 1_000,
      missingPollsBeforeLeave: configuration.PLAYER_MISSING_POLLS_BEFORE_LEAVE,
      failuresBeforeOffline: configuration.SERVER_FAILURES_BEFORE_OFFLINE,
      trackSessions: configuration.TRACK_PLAYER_SESSIONS,
      publishJoinLeaveEvents: configuration.PUBLISH_JOIN_LEAVE_EVENTS,
    },
    componentError,
  );
  const deathTracker = new DeathTracker(
    database,
    discordPublisher,
    {
      trackingEnabled: configuration.TRACK_PLAYER_DEATHS,
      publishingEnabled: configuration.PUBLISH_DEATH_EVENTS,
      duplicateWindowMilliseconds: configuration.DEATH_EVENT_DUPLICATE_WINDOW_SECONDS * 1_000,
    },
    componentError,
  );

  const statusProvider: RuntimeStatusProvider = () => ({
    discord: discordHealth,
    rcon: rconClient.state,
    conanServer: configuration.TRACK_PLAYERS ? playerTracker.serverState : "unknown",
    discordToGameTransport: activeTransport,
    gameToDiscordChat: gameToDiscordHealth,
    playerTracking: configuration.TRACK_PLAYERS ? playerTracker.trackingState : "disabled",
    sessionTracking: configuration.TRACK_PLAYER_SESSIONS ? playerTracker.trackingState : "disabled",
    deathTracking: deathTracker.health,
    deathParserStatus: deathTracker.parserStatus,
    database: databaseHealth,
    playerSnapshot: playerTracker.snapshot,
    ...(configuration.SERVER_MAXIMUM_PLAYERS === undefined
      ? {}
      : { maximumPlayers: configuration.SERVER_MAXIMUM_PLAYERS }),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
  });

  const echoMemory = new ChatEchoMemory(
    configuration.CHAT_ECHO_MEMORY_SECONDS * 1_000,
    configuration.CHAT_ECHO_MAXIMUM_ENTRIES,
  );
  const gameChatDestination = new RconGameChatDestination(rconClient, activeTransport);
  const rateLimiter = new ChatRateLimiter({
    userMessageLimit: configuration.CHAT_USER_MESSAGE_LIMIT,
    userWindowMilliseconds: configuration.CHAT_USER_MESSAGE_WINDOW_SECONDS * 1_000,
    globalMessageLimit: configuration.CHAT_GLOBAL_MESSAGE_LIMIT,
    globalWindowMilliseconds: configuration.CHAT_GLOBAL_MESSAGE_WINDOW_SECONDS * 1_000,
  });
  const discordChatRelay = new DiscordChatRelay(
    discordClient,
    {
      guildIdentifier: configuration.DISCORD_GUILD_ID,
      channelIdentifier: configuration.DISCORD_CHAT_CHANNEL_ID,
      prefix: configuration.GAME_CHAT_DISCORD_PREFIX,
      maximumCharacters: configuration.GAME_CHAT_MAXIMUM_CHARACTERS,
    },
    gameChatDestination,
    rateLimiter,
    echoMemory,
    discordToGameChatEnabled,
    componentError,
  );

  const logFollower =
    configuration.CONAN_LOG_PATH === undefined
      ? undefined
      : new ConanLogFollower({
          path: configuration.CONAN_LOG_PATH,
          startPosition: configuration.CONAN_LOG_START_POSITION,
          onLine: async (line) => {
            const chatEvent = parseChatEvent(line);
            if (
              chatEvent !== undefined &&
              configuration.CHAT_RELAY_ENABLED &&
              configuration.GAME_TO_DISCORD_CHAT_ENABLED
            ) {
              await relayConanMessageToDiscord(
                chatEvent,
                {
                  allowedChannels: configuration.GAME_CHAT_ALLOWED_CHANNELS,
                  allowUnknownChannel: configuration.ALLOW_UNKNOWN_GAME_CHAT_CHANNEL,
                  escapeMarkdown: configuration.ESCAPE_GAME_CHAT_MARKDOWN,
                },
                discordPublisher,
                echoMemory,
              );
            }
            const deathEvent = parseDeathEvent(line);
            if (deathEvent !== undefined) {
              await deathTracker.handle(deathEvent);
            } else if (configuration.TRACK_PLAYER_DEATHS && isPotentialDeathEvent(line)) {
              deathTracker.noteUnsupportedEventFormat();
              logger.debug({
                component: "game-events",
                event: "death_event_format_unsupported",
                parserContext: Array.from(sanitizeGameBoundText(line)).slice(0, 320).join(""),
              });
            }
          },
          onError: (error) => {
            gameToDiscordHealth = "degraded";
            componentError(error);
          },
          onHealthy: () => {
            gameToDiscordHealth = "healthy";
          },
        });

  const detectCapabilities = async (): Promise<void> => {
    if (!discordToGameChatEnabled) {
      activeTransport = "disabled";
      gameChatDestination.setTransport("disabled");
      return;
    }
    try {
      const helpResponse = await rconClient.executeCommand("help", "interactive-status");
      const decision = determineGameChatTransport(configuration.GAME_CHAT_TRANSPORT, helpResponse);
      activeTransport = decision.transport;
      gameChatDestination.setTransport(decision.transport);
      logger.info({
        component: "rcon",
        event: "chat_transport_selected",
        transport: decision.transport,
        reason: decision.reason,
      });
    } catch (error: unknown) {
      activeTransport = "unavailable";
      gameChatDestination.setTransport("unavailable");
      componentError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  rconClient.on("stateChanged", (state: unknown) => {
    if (state === "connected") void detectCapabilities();
  });
  rconClient.on("connectionError", (error: unknown) => {
    componentError(error instanceof Error ? error : new Error(String(error)));
  });
  rconClient.on("protocolError", (error: unknown) => {
    componentError(error instanceof Error ? error : new Error(String(error)));
  });

  discordClient.on("ready", () => {
    discordHealth = "connected";
    logger.info({ component: "discord", event: "connected", user: discordClient.user?.id });
  });
  discordClient.on("shardDisconnect", () => {
    discordHealth = "disconnected";
  });

  const connectDiscord = async (): Promise<void> => {
    let attempt = 0;
    while (!shuttingDown && !discordClient.isReady()) {
      try {
        await discordClient.login(configuration.DISCORD_BOT_TOKEN);
        await registerDiscordCommands(
          discordClient,
          configuration.DISCORD_BOT_TOKEN,
          configuration.DISCORD_APPLICATION_ID,
          configuration.DISCORD_GUILD_ID,
          statusProvider,
          componentError,
        );
        return;
      } catch (error: unknown) {
        if (error instanceof DiscordjsError && error.code === DiscordjsErrorCodes.TokenInvalid) {
          discordHealth = "authentication-failed";
          componentError(new Error("Discord authentication failed. Verify DISCORD_BOT_TOKEN."));
          return;
        }
        discordHealth = "disconnected";
        componentError(error instanceof Error ? error : new Error(String(error)));
        const retryDelay = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
        attempt += 1;
        await delay(retryDelay);
      }
    }
  };
  let healthServer: RunningHealthServer | undefined;
  if (configuration.HEALTH_SERVER_ENABLED) {
    healthServer = await startHealthServer(
      { host: configuration.HEALTH_SERVER_HOST, port: configuration.HEALTH_SERVER_PORT },
      statusProvider,
    );
  }

  discordChatRelay.start();
  logFollower?.start();
  rconClient.start();
  if (configuration.TRACK_PLAYERS) playerTracker.start();
  void connectDiscord();

  const statusMessageTimer = configuration.DISCORD_STATUS_MESSAGE_ENABLED
    ? setInterval(() => {
        void discordPublisher
          .maintainStatusMessage(formatStatusCommand(statusProvider()))
          .catch((error: unknown) =>
            componentError(error instanceof Error ? error : new Error(String(error))),
          );
      }, 60_000)
    : undefined;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forcedExitTimer = setTimeout(() => {
      logger.fatal({ component: "runtime", event: "shutdown_timeout", signal });
      process.exit(1);
    }, 15_000);
    forcedExitTimer.unref();
    logger.info({ component: "runtime", event: "shutdown_started", signal });
    try {
      discordChatRelay.stop();
      playerTracker.stop();
      logFollower?.stop();
      if (statusMessageTimer !== undefined) clearInterval(statusMessageTimer);
      discordPublisher.stop();
      await rconClient.close();
      await discordClient.destroy();
      if (healthServer !== undefined) await healthServer.close();
      database.close();
      instanceLock.release();
      logger.info({ component: "runtime", event: "shutdown_complete" });
    } finally {
      clearTimeout(forcedExitTimer);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").finally(() => process.exit(0));
  });
}

run().catch((error: unknown) => {
  process.stderr.write(`Hyborian Relay could not start: ${describeUnknownError(error)}\n`);
  process.exitCode = 1;
});
