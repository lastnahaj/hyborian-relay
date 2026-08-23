import { constants, accessSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

import { PermissionsBitField, WebhookClient, type Guild } from "discord.js";

import { getApplicationVersion } from "./applicationVersion.js";
import { parsePlayerListResponse } from "./conan/players/parsePlayerListResponse.js";
import { ConanRconClient } from "./conan/rcon/ConanRconClient.js";
import { determineGameChatTransport } from "./conan/rcon/detectRconCapabilities.js";
import { type Configuration } from "./configuration/configurationSchema.js";
import { loadConfiguration } from "./configuration/loadConfiguration.js";
import { createDiscordClient } from "./discord/createDiscordClient.js";
import { describeUnknownError } from "./errors/RelayError.js";
import { RelayDatabase } from "./storage/RelayDatabase.js";

type DoctorExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface CheckGroup {
  name: string;
  messages: string[];
  failed: boolean;
  exitCode?: Exclude<DoctorExitCode, 0 | 7>;
}

function checkGroup(name: string): CheckGroup {
  return { name, messages: [], failed: false };
}

function pass(group: CheckGroup, message: string): void {
  group.messages.push(`  PASS - ${message}`);
}

function warning(group: CheckGroup, message: string): void {
  group.messages.push(`  WARN - ${message}`);
}

function fail(group: CheckGroup, message: string, exitCode: Exclude<DoctorExitCode, 0 | 7>): void {
  group.messages.push(`  FAIL - ${message}`);
  group.failed = true;
  group.exitCode = exitCode;
}

function printGroups(groups: CheckGroup[]): void {
  process.stdout.write(`Hyborian Relay ${getApplicationVersion()} diagnostics\n\n`);
  for (const group of groups) {
    process.stdout.write(`${group.name}\n${group.messages.join("\n")}\n\n`);
  }
}

function runtimeChecks(configuration: Configuration): CheckGroup {
  const group = checkGroup("Runtime");
  const majorVersion = Number(process.versions.node.split(".")[0]);
  if (majorVersion === 22) pass(group, `Node.js ${process.versions.node}`);
  else fail(group, `Node.js 22 is required; current version is ${process.versions.node}`, 1);
  mkdirSync(dirname(configuration.DATABASE_PATH), { recursive: true, mode: 0o700 });
  try {
    accessSync(dirname(configuration.DATABASE_PATH), constants.R_OK | constants.W_OK);
    pass(group, `data directory is readable and writable: ${dirname(configuration.DATABASE_PATH)}`);
  } catch (error: unknown) {
    fail(group, `data directory is not writable: ${describeUnknownError(error)}`, 4);
  }
  if (existsSync(".env") && process.platform !== "win32") {
    const permissions = statSync(".env").mode & 0o777;
    if ((permissions & 0o077) === 0) pass(group, ".env permissions are restricted");
    else warning(group, `run chmod 600 .env; current mode is ${permissions.toString(8)}`);
  }
  return group;
}

function databaseChecks(configuration: Configuration): CheckGroup {
  const group = checkGroup("Database");
  let database: RelayDatabase | undefined;
  try {
    database = new RelayDatabase(configuration.DATABASE_PATH);
    database.verifyWritable();
    pass(group, "database opened, migrations applied, and a transaction completed");
  } catch (error: unknown) {
    fail(group, describeUnknownError(error), 5);
  } finally {
    database?.close();
  }
  return group;
}

function conanLogChecks(configuration: Configuration): CheckGroup {
  const group = checkGroup("Conan Logs");
  const logPath = configuration.CONAN_LOG_PATH;
  if (logPath === undefined) {
    pass(group, "log source is not required by the enabled feature set");
    return group;
  }
  try {
    if (existsSync(logPath)) {
      const status = statSync(logPath);
      if (!status.isFile()) throw new Error("configured path is not a regular file");
      accessSync(logPath, constants.R_OK);
      pass(group, `log is readable: ${logPath}`);
    } else {
      accessSync(dirname(logPath), constants.R_OK);
      warning(group, "log file is absent; the follower will wait for Conan to create it");
    }
    pass(group, "Pippi Global-chat parser is available");
    if (configuration.TRACK_PLAYER_DEATHS) {
      warning(group, "death parser is available; no live death sample is required for this check");
    }
    if (configuration.ALLOW_UNKNOWN_GAME_CHAT_CHANNEL) {
      warning(
        group,
        "unknown game-chat channels are explicitly allowed and may expose private chat",
      );
    } else {
      pass(group, "unknown and private game-chat channels are blocked by default");
    }
  } catch (error: unknown) {
    fail(group, `cannot read the configured log path: ${describeUnknownError(error)}`, 4);
  }
  return group;
}

async function checkDiscordChannel(
  guild: Guild,
  channelIdentifier: string,
  label: string,
  group: CheckGroup,
): Promise<void> {
  const channel = await guild.channels.fetch(channelIdentifier);
  if (channel === null || !channel.isSendable()) {
    throw new Error(`${label} ${channelIdentifier} is missing or is not a sendable channel`);
  }
  const botMember = guild.members.me;
  if (botMember === null) throw new Error("bot guild membership could not be resolved");
  const permissions = channel.permissionsFor(botMember);
  const requiredPermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands,
  ];
  if (!permissions?.has(requiredPermissions)) {
    throw new Error(`${label} is missing one or more required bot permissions`);
  }
  pass(group, `${label} is accessible with required permissions`);
}

async function discordChecks(configuration: Configuration): Promise<CheckGroup> {
  const group = checkGroup("Discord");
  const client = createDiscordClient();
  try {
    await client.login(configuration.DISCORD_BOT_TOKEN);
    pass(group, "bot authentication succeeded");
    if (client.application?.id !== configuration.DISCORD_APPLICATION_ID) {
      throw new Error("DISCORD_APPLICATION_ID does not match the authenticated bot application");
    }
    pass(group, "application identifier matches the bot token");
    const guild = await client.guilds.fetch(configuration.DISCORD_GUILD_ID);
    pass(group, "configured guild is accessible");
    await checkDiscordChannel(guild, configuration.DISCORD_CHAT_CHANNEL_ID, "chat channel", group);
    await checkDiscordChannel(
      guild,
      configuration.DISCORD_EVENT_CHANNEL_ID,
      "event channel",
      group,
    );
    if (configuration.DISCORD_DEATH_CHANNEL_ID !== undefined) {
      await checkDiscordChannel(
        guild,
        configuration.DISCORD_DEATH_CHANNEL_ID,
        "death channel",
        group,
      );
    } else {
      pass(group, "death events fall back to the event channel");
    }
    if (
      configuration.DISCORD_STATUS_MESSAGE_ENABLED &&
      configuration.DISCORD_STATUS_CHANNEL_ID !== undefined
    ) {
      await checkDiscordChannel(
        guild,
        configuration.DISCORD_STATUS_CHANNEL_ID,
        "status channel",
        group,
      );
    }
    if (
      configuration.DISCORD_GAME_CHAT_RENDERING === "webhook" &&
      configuration.DISCORD_GAME_CHAT_WEBHOOK_URL !== undefined
    ) {
      const webhook = new WebhookClient({ url: configuration.DISCORD_GAME_CHAT_WEBHOOK_URL });
      await client.fetchWebhook(webhook.id, webhook.token ?? undefined);
      webhook.destroy();
      pass(group, "game-chat webhook is accessible without sending a message");
    }
  } catch (error: unknown) {
    fail(group, describeUnknownError(error), 2);
  } finally {
    await client.destroy();
  }
  return group;
}

async function rconChecks(configuration: Configuration): Promise<CheckGroup> {
  const group = checkGroup("Conan RCON");
  const client = new ConanRconClient({
    host: configuration.CONAN_RCON_HOST,
    port: configuration.CONAN_RCON_PORT,
    password: configuration.CONAN_RCON_PASSWORD,
    commandTimeoutMilliseconds: configuration.RCON_COMMAND_TIMEOUT_MILLISECONDS,
    commandQueueLimit: configuration.RCON_COMMAND_QUEUE_LIMIT,
  });
  try {
    await client.connect();
    pass(group, "TCP connection and authentication succeeded");
    const playerResponse = await client.executeCommand("listplayers", "interactive-status");
    const players = parsePlayerListResponse(playerResponse);
    pass(group, `listplayers parsed successfully (${players.length} online)`);
    const helpResponse = await client.executeCommand("help", "interactive-status");
    pass(group, "RCON help/capability response received");
    const decision = determineGameChatTransport(configuration.GAME_CHAT_TRANSPORT, helpResponse);
    if (
      decision.transport === "unavailable" &&
      configuration.CHAT_RELAY_ENABLED &&
      configuration.DISCORD_TO_GAME_CHAT_ENABLED
    ) {
      fail(group, decision.reason, 6);
    } else {
      pass(group, `game chat transport: ${decision.transport} — ${decision.reason}`);
    }
  } catch (error: unknown) {
    fail(group, describeUnknownError(error), 3);
  } finally {
    await client.close();
  }
  return group;
}

async function healthPortChecks(configuration: Configuration): Promise<CheckGroup> {
  const group = checkGroup("Health Server");
  if (!configuration.HEALTH_SERVER_ENABLED) {
    pass(group, "disabled by configuration");
    return group;
  }
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(configuration.HEALTH_SERVER_PORT, configuration.HEALTH_SERVER_HOST, resolve);
    });
    pass(
      group,
      `${configuration.HEALTH_SERVER_HOST}:${configuration.HEALTH_SERVER_PORT} is available`,
    );
  } catch (error: unknown) {
    fail(group, `configured bind address is unavailable: ${describeUnknownError(error)}`, 1);
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return group;
}

function determineExitCode(groups: CheckGroup[]): DoctorExitCode {
  const failedCodes = new Set(
    groups.flatMap((group) =>
      group.failed && group.exitCode !== undefined ? [group.exitCode] : [],
    ),
  );
  if (failedCodes.size === 0) return 0;
  if (failedCodes.size > 1) return 7;
  return [...failedCodes][0] ?? 7;
}

async function runDoctor(): Promise<DoctorExitCode> {
  let configuration: Configuration;
  try {
    configuration = loadConfiguration();
  } catch (error: unknown) {
    const configurationGroup = checkGroup("Configuration");
    fail(configurationGroup, describeUnknownError(error), 1);
    printGroups([configurationGroup]);
    return 1;
  }

  const configurationGroup = checkGroup("Configuration");
  pass(configurationGroup, "environment values are valid and internally consistent");
  const groups = [
    configurationGroup,
    runtimeChecks(configuration),
    databaseChecks(configuration),
    conanLogChecks(configuration),
    await discordChecks(configuration),
    await rconChecks(configuration),
    await healthPortChecks(configuration),
  ];
  printGroups(groups);
  return determineExitCode(groups);
}

runDoctor()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Diagnostics failed unexpectedly: ${describeUnknownError(error)}\n`);
    process.exitCode = 7;
  });
