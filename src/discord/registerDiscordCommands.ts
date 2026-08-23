import {
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";

import { getApplicationVersion } from "../applicationVersion.js";
import type { RuntimeStatusProvider, RuntimeStatusSnapshot } from "../runtime/RuntimeStatus.js";

function titleCase(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const portions = [
    ...(days > 0 ? [`${days} day${days === 1 ? "" : "s"}`] : []),
    ...(hours > 0 ? [`${hours} hour${hours === 1 ? "" : "s"}`] : []),
    ...(days === 0 && minutes > 0 ? [`${minutes} minute${minutes === 1 ? "" : "s"}`] : []),
  ];
  return portions.join(", ") || "less than a minute";
}

export function formatPlayersCommand(status: RuntimeStatusSnapshot, now = new Date()): string {
  const maximum = status.maximumPlayers;
  const count = status.playerSnapshot.players.length;
  const countText = maximum === undefined ? String(count) : `${count} / ${maximum}`;
  const age =
    status.playerSnapshot.obtainedAt === undefined
      ? "no successful snapshot"
      : `${Math.max(0, Math.floor((now.getTime() - status.playerSnapshot.obtainedAt.getTime()) / 1_000))} seconds old`;
  const staleLabel = status.playerSnapshot.stale ? ` — Stale (${age})` : "";
  const names = status.playerSnapshot.players.map((player) => player.characterName);
  return [
    `Players Online — ${countText}${staleLabel}`,
    "",
    ...(names.length > 0 ? names : ["No players online."]),
  ].join("\n");
}

export function formatStatusCommand(status: RuntimeStatusSnapshot, now = new Date()): string {
  const snapshotAge =
    status.playerSnapshot.obtainedAt === undefined
      ? "No successful snapshot"
      : `${Math.max(0, Math.floor((now.getTime() - status.playerSnapshot.obtainedAt.getTime()) / 1_000))} seconds old${status.playerSnapshot.stale ? " — stale" : ""}`;
  const playerMaximum = status.maximumPlayers;
  const players =
    playerMaximum === undefined
      ? String(status.playerSnapshot.players.length)
      : `${status.playerSnapshot.players.length} / ${playerMaximum}`;
  const deathReason =
    status.deathParserStatus === "parser-available-no-live-sample"
      ? " — parser available, no live sample observed"
      : status.deathParserStatus === "incompatible"
        ? " — no supported death event format has been confirmed"
        : "";
  return [
    `Hyborian Relay ${getApplicationVersion()}`,
    "",
    `Conan Server: ${titleCase(status.conanServer)}`,
    `RCON: ${titleCase(status.rcon)}`,
    `Players: ${players}`,
    `Player Snapshot: ${snapshotAge}`,
    `Discord to Conan: ${titleCase(status.discordToGameTransport)}`,
    `Conan to Discord: ${titleCase(status.gameToDiscordChat)}`,
    `Player Tracking: ${titleCase(status.playerTracking)}`,
    `Session Tracking: ${titleCase(status.sessionTracking)}`,
    `Death Tracking: ${titleCase(status.deathTracking)}${deathReason}`,
    `Database: ${titleCase(status.database)}`,
    `Relay Uptime: ${formatDuration(status.uptimeSeconds)}`,
  ].join("\n");
}

async function respondToCommand(
  interaction: ChatInputCommandInteraction,
  statusProvider: RuntimeStatusProvider,
): Promise<void> {
  if (interaction.commandName === "players") {
    await interaction.reply({ content: formatPlayersCommand(statusProvider()), ephemeral: false });
  } else if (interaction.commandName === "status") {
    await interaction.reply({ content: formatStatusCommand(statusProvider()), ephemeral: false });
  }
}

export async function registerDiscordCommands(
  client: Client,
  token: string,
  applicationIdentifier: string,
  guildIdentifier: string,
  statusProvider: RuntimeStatusProvider,
  onError: (error: Error) => void,
): Promise<void> {
  const commands = [
    new SlashCommandBuilder().setName("players").setDescription("Show the current Conan players."),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show Hyborian Relay service health."),
  ].map((command) => command.toJSON());
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationIdentifier, guildIdentifier), {
    body: commands,
  });
  client.on("interactionCreate", (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== guildIdentifier) return;
    void respondToCommand(interaction, statusProvider).catch((error: unknown) => {
      onError(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
