import { createHash } from "node:crypto";

import { parseUnrealLogTimestamp } from "./gameEventTimestamp.js";

type DeathClassification =
  | "player_kill"
  | "creature_kill"
  | "non_player_character_kill"
  | "environment"
  | "self_inflicted"
  | "unknown";

export interface PlayerDeathEvent {
  victimName: string;
  victimIdentityKey?: string;
  killerName?: string;
  killerIdentityKey?: string;
  classification: DeathClassification;
  cause?: string;
  occurredAt: Date;
  source: "conan-event-log";
  sourceFingerprint: string;
}

const eventPrefixPattern =
  /(?:\[Pippi\](?:PippiEvent|EventLog):|LogGameEvent:\s*(?:Display:\s*)?)(.+)$/u;
const killedByPlayerPattern = /^(.+?) was killed by player (.+?)\.?$/iu;
const killedByCreaturePattern = /^(.+?) was killed by (?:creature|a|an) (.+?)\.?$/iu;
const killedByNonPlayerCharacterPattern =
  /^(.+?) was killed by (?:NPC|non-player character) (.+?)\.?$/iu;
const killedByUnknownPattern = /^(.+?) was killed by (.+?)\.?$/iu;
const environmentalPattern = /^(.+?) died from (.+?)\.?$/iu;
const selfInflictedPattern = /^(.+?) (?:died by their own hand|killed themselves)\.?$/iu;
const unknownPattern = /^(.+?) died\.?$/iu;
const potentialDeathLanguagePattern = /\b(?:died|killed|death)\b/iu;

function cleanEventValue(value: string): string {
  return value.trim().replace(/[.\s]+$/u, "");
}

function buildFingerprint(
  victimName: string,
  killerName: string | undefined,
  classification: DeathClassification,
  cause: string | undefined,
  occurredAt: Date,
): string {
  const second = Math.floor(occurredAt.getTime() / 1_000);
  return createHash("sha256")
    .update(
      [
        victimName.normalize("NFC").toLowerCase(),
        killerName?.normalize("NFC").toLowerCase() ?? "",
        classification,
        cause?.normalize("NFC").toLowerCase() ?? "",
        String(second),
      ].join("\u0000"),
    )
    .digest("hex");
}

function createDeathEvent(
  victimName: string,
  occurredAt: Date,
  classification: DeathClassification,
  killerName?: string,
  cause?: string,
): PlayerDeathEvent {
  const cleanedVictimName = cleanEventValue(victimName);
  const cleanedKillerName = killerName === undefined ? undefined : cleanEventValue(killerName);
  const cleanedCause = cause === undefined ? undefined : cleanEventValue(cause);
  return {
    victimName: cleanedVictimName,
    ...(cleanedKillerName === undefined ? {} : { killerName: cleanedKillerName }),
    classification,
    ...(cleanedCause === undefined ? {} : { cause: cleanedCause }),
    occurredAt,
    source: "conan-event-log",
    sourceFingerprint: buildFingerprint(
      cleanedVictimName,
      cleanedKillerName,
      classification,
      cleanedCause,
      occurredAt,
    ),
  };
}

export function parseDeathEvent(line: string): PlayerDeathEvent | undefined {
  const occurredAt = parseUnrealLogTimestamp(line);
  const prefixedEvent = eventPrefixPattern.exec(line);
  if (occurredAt === undefined || prefixedEvent?.[1] === undefined) return undefined;
  const eventText = prefixedEvent[1].trim();

  let match = killedByPlayerPattern.exec(eventText);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return createDeathEvent(match[1], occurredAt, "player_kill", match[2]);
  }
  match = killedByCreaturePattern.exec(eventText);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return createDeathEvent(match[1], occurredAt, "creature_kill", match[2]);
  }
  match = killedByNonPlayerCharacterPattern.exec(eventText);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return createDeathEvent(match[1], occurredAt, "non_player_character_kill", match[2]);
  }
  match = environmentalPattern.exec(eventText);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return createDeathEvent(match[1], occurredAt, "environment", undefined, match[2]);
  }
  match = selfInflictedPattern.exec(eventText);
  if (match?.[1] !== undefined) return createDeathEvent(match[1], occurredAt, "self_inflicted");
  match = killedByUnknownPattern.exec(eventText);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return createDeathEvent(match[1], occurredAt, "unknown", match[2]);
  }
  match = unknownPattern.exec(eventText);
  if (match?.[1] !== undefined) return createDeathEvent(match[1], occurredAt, "unknown");
  return undefined;
}

export function isPotentialDeathEvent(line: string): boolean {
  const prefixedEvent = eventPrefixPattern.exec(line);
  return prefixedEvent?.[1] !== undefined && potentialDeathLanguagePattern.test(prefixedEvent[1]);
}

export function renderDeathNotification(event: PlayerDeathEvent): string {
  if (event.classification === "environment" && event.cause !== undefined) {
    return `${event.victimName} died from ${event.cause}.`;
  }
  if (event.classification === "self_inflicted") {
    return `${event.victimName} died by their own hand.`;
  }
  if (event.killerName !== undefined) {
    const article = event.classification === "creature_kill" ? "a " : "";
    return `${event.victimName} was killed by ${article}${event.killerName}.`;
  }
  return `${event.victimName} died.`;
}
