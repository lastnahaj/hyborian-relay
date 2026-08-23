import { z } from "zod";

const discordIdentifier = z
  .string()
  .regex(/^\d{17,20}$/, "must be a 17-20 digit Discord identifier");

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalDiscordIdentifier = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  discordIdentifier.optional(),
);

const environmentBoolean = (defaultValue: boolean): z.ZodType<boolean, unknown> =>
  z
    .preprocess((value) => {
      if (value === "true" || value === true) return true;
      if (value === "false" || value === false) return false;
      return value;
    }, z.boolean())
    .default(defaultValue);

const environmentInteger = (
  defaultValue: number,
  minimum: number,
  maximum: number,
): z.ZodType<number, unknown> =>
  z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
      z.number().int().min(minimum).max(maximum),
    )
    .default(defaultValue);

const optionalMaximumPlayers = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().max(1_000).optional(),
);

const allowedGameChatChannels = z
  .string()
  .default("global")
  .transform((value, context) => {
    const channels = value
      .split(",")
      .map((channel) => channel.trim().toLowerCase())
      .filter(Boolean);
    const acceptedChannels = ["global", "local", "clan", "whisper", "unknown"] as const;
    for (const channel of channels) {
      if (!acceptedChannels.includes(channel as (typeof acceptedChannels)[number])) {
        context.addIssue({ code: "custom", message: `unsupported game chat channel: ${channel}` });
      }
    }
    return new Set(channels as Array<(typeof acceptedChannels)[number]>);
  });

export const configurationSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DISCORD_BOT_TOKEN: z.string().min(1, "is required"),
    DISCORD_APPLICATION_ID: discordIdentifier,
    DISCORD_GUILD_ID: discordIdentifier,
    DISCORD_CHAT_CHANNEL_ID: discordIdentifier,
    DISCORD_EVENT_CHANNEL_ID: discordIdentifier,
    DISCORD_DEATH_CHANNEL_ID: optionalDiscordIdentifier,
    DISCORD_PENDING_EVENT_LIMIT: environmentInteger(500, 1, 10_000),
    DISCORD_STATUS_MESSAGE_ENABLED: environmentBoolean(false),
    DISCORD_STATUS_CHANNEL_ID: optionalDiscordIdentifier,
    DISCORD_GAME_CHAT_RENDERING: z.enum(["bot", "webhook"]).default("bot"),
    DISCORD_GAME_CHAT_WEBHOOK_URL: optionalString,
    ESCAPE_GAME_CHAT_MARKDOWN: environmentBoolean(true),

    CONAN_RCON_HOST: z.string().trim().min(1).default("127.0.0.1"),
    CONAN_RCON_PORT: environmentInteger(25_575, 1, 65_535),
    CONAN_RCON_PASSWORD: z.string().min(1, "is required"),
    RCON_COMMAND_TIMEOUT_MILLISECONDS: environmentInteger(5_000, 100, 120_000),
    RCON_COMMAND_QUEUE_LIMIT: environmentInteger(100, 1, 10_000),
    GAME_CHAT_TRANSPORT: z
      .enum(["automatic", "pippi-server", "broadcast", "disabled"])
      .default("automatic"),
    GAME_CHAT_DISCORD_PREFIX: z.string().trim().min(1).max(40).default("[Discord]"),
    GAME_CHAT_MAXIMUM_CHARACTERS: environmentInteger(400, 80, 2_000),

    CONAN_LOG_PATH: optionalString,
    CONAN_LOG_START_POSITION: z.enum(["beginning", "end"]).default("end"),
    GAME_CHAT_ALLOWED_CHANNELS: allowedGameChatChannels,
    ALLOW_UNKNOWN_GAME_CHAT_CHANNEL: environmentBoolean(false),

    CHAT_RELAY_ENABLED: environmentBoolean(true),
    DISCORD_TO_GAME_CHAT_ENABLED: environmentBoolean(true),
    GAME_TO_DISCORD_CHAT_ENABLED: environmentBoolean(true),
    CHAT_USER_MESSAGE_LIMIT: environmentInteger(5, 1, 1_000),
    CHAT_USER_MESSAGE_WINDOW_SECONDS: environmentInteger(10, 1, 3_600),
    CHAT_GLOBAL_MESSAGE_LIMIT: environmentInteger(30, 1, 10_000),
    CHAT_GLOBAL_MESSAGE_WINDOW_SECONDS: environmentInteger(10, 1, 3_600),
    CHAT_ECHO_MEMORY_SECONDS: environmentInteger(60, 1, 3_600),
    CHAT_ECHO_MAXIMUM_ENTRIES: environmentInteger(1_000, 1, 100_000),

    TRACK_PLAYERS: environmentBoolean(true),
    TRACK_PLAYER_SESSIONS: environmentBoolean(true),
    PUBLISH_JOIN_LEAVE_EVENTS: environmentBoolean(true),
    PLAYER_POLL_INTERVAL_SECONDS: environmentInteger(30, 1, 3_600),
    PLAYER_MISSING_POLLS_BEFORE_LEAVE: environmentInteger(2, 1, 100),
    SERVER_FAILURES_BEFORE_OFFLINE: environmentInteger(3, 1, 100),
    SERVER_MAXIMUM_PLAYERS: optionalMaximumPlayers,

    TRACK_PLAYER_DEATHS: environmentBoolean(true),
    PUBLISH_DEATH_EVENTS: environmentBoolean(true),
    DEATH_EVENT_DUPLICATE_WINDOW_SECONDS: environmentInteger(10, 1, 3_600),

    DATABASE_PATH: z.string().trim().min(1).default("./data/hyborian-relay.db"),

    HEALTH_SERVER_ENABLED: environmentBoolean(true),
    HEALTH_SERVER_HOST: z.string().trim().min(1).default("127.0.0.1"),
    HEALTH_SERVER_PORT: environmentInteger(8_787, 1, 65_535),
  })
  .superRefine((configuration, context) => {
    const gameEventsNeeded =
      (configuration.CHAT_RELAY_ENABLED && configuration.GAME_TO_DISCORD_CHAT_ENABLED) ||
      configuration.TRACK_PLAYER_DEATHS;
    if (gameEventsNeeded && configuration.CONAN_LOG_PATH === undefined) {
      context.addIssue({
        code: "custom",
        path: ["CONAN_LOG_PATH"],
        message: "is required when game chat or death tracking reads Conan events",
      });
    }
    if (
      configuration.DISCORD_GAME_CHAT_RENDERING === "webhook" &&
      configuration.DISCORD_GAME_CHAT_WEBHOOK_URL === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_GAME_CHAT_WEBHOOK_URL"],
        message: "is required when DISCORD_GAME_CHAT_RENDERING=webhook",
      });
    }
    if (
      configuration.DISCORD_STATUS_MESSAGE_ENABLED &&
      configuration.DISCORD_STATUS_CHANNEL_ID === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["DISCORD_STATUS_CHANNEL_ID"],
        message: "is required when the persistent status message is enabled",
      });
    }
    if (configuration.TRACK_PLAYER_SESSIONS && !configuration.TRACK_PLAYERS) {
      context.addIssue({
        code: "custom",
        path: ["TRACK_PLAYER_SESSIONS"],
        message: "requires TRACK_PLAYERS=true",
      });
    }
  });

export type Configuration = z.infer<typeof configurationSchema>;
