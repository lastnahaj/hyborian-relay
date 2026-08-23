import { RelayError } from "../../errors/RelayError.js";

export interface ConanPlayer {
  identityKey: string;
  characterName: string;
  platformIdentifier?: string;
  funcomIdentifier?: string;
}

const emptyResponsePatterns = [
  /^\s*$/u,
  /^\s*no players(?: online| connected)?[.!]?\s*$/iu,
  /^\s*players online:\s*0\s*$/iu,
];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header));
}

function normalizeCharacterIdentity(characterName: string): string {
  return `character:${characterName.normalize("NFC").trim().toLocaleLowerCase("en-US")}`;
}

function createPlayer(
  characterName: string,
  platformIdentifier: string | undefined,
  funcomIdentifier: string | undefined,
): ConanPlayer {
  const identityKey =
    funcomIdentifier !== undefined
      ? `funcom:${funcomIdentifier}`
      : platformIdentifier !== undefined
        ? `platform:${platformIdentifier}`
        : normalizeCharacterIdentity(characterName);
  return {
    identityKey,
    characterName,
    ...(platformIdentifier === undefined ? {} : { platformIdentifier }),
    ...(funcomIdentifier === undefined ? {} : { funcomIdentifier }),
  };
}

export function parsePlayerListResponse(response: string): ConanPlayer[] {
  if (emptyResponsePatterns.some((pattern) => pattern.test(response))) return [];
  const lines = response
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex(
    (line) => line.includes("|") && /char(?:acter)?\s*name/iu.test(line),
  );
  if (headerIndex === -1) {
    throw new RelayError(
      "PLAYER_LIST_PARSE_FAILED",
      "The listplayers response did not contain a recognized header.",
    );
  }

  const headers = (lines[headerIndex] ?? "").split("|").map(normalizeHeader);
  const characterNameColumn = findColumn(headers, ["charname", "charactername"]);
  const platformIdentifierColumn = findColumn(headers, [
    "platformid",
    "platformidentifier",
    "steamid",
    "userid",
  ]);
  const funcomIdentifierColumn = findColumn(headers, ["funcomid", "funcomidentifier"]);
  if (characterNameColumn === -1) {
    throw new RelayError(
      "PLAYER_LIST_PARSE_FAILED",
      "The listplayers response did not identify the character-name column.",
    );
  }

  const players: ConanPlayer[] = [];
  const identities = new Set<string>();
  for (const line of lines.slice(headerIndex + 1)) {
    if (/^[\s+|=-]+$/u.test(line)) continue;
    const columns = line.split("|").map((column) => column.trim());
    const characterName = columns[characterNameColumn];
    if (characterName === undefined || characterName === "") continue;
    const platformIdentifier =
      platformIdentifierColumn === -1 ? undefined : columns[platformIdentifierColumn] || undefined;
    const funcomIdentifier =
      funcomIdentifierColumn === -1 ? undefined : columns[funcomIdentifierColumn] || undefined;
    const player = createPlayer(characterName, platformIdentifier, funcomIdentifier);
    if (identities.has(player.identityKey)) {
      throw new RelayError(
        "PLAYER_LIST_PARSE_FAILED",
        `The listplayers response repeated stable identity ${player.identityKey}.`,
      );
    }
    identities.add(player.identityKey);
    players.push(player);
  }
  return players;
}
