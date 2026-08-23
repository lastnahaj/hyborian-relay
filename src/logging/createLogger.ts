import pino, { type Logger } from "pino";

import type { Configuration } from "../configuration/configurationSchema.js";

const sensitivePaths = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_GAME_CHAT_WEBHOOK_URL",
  "CONAN_RCON_PASSWORD",
  "authorization",
  "headers.authorization",
  "configuration.DISCORD_BOT_TOKEN",
  "configuration.DISCORD_GAME_CHAT_WEBHOOK_URL",
  "configuration.CONAN_RCON_PASSWORD",
];

export function createLogger(configuration: Pick<Configuration, "LOG_LEVEL">): Logger {
  return pino({
    level: configuration.LOG_LEVEL,
    redact: { paths: sensitivePaths, censor: "[redacted]" },
    base: { service: "hyborian-relay" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
