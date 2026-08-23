function codePointLength(value: string): number {
  return Array.from(value).length;
}

function takeTextPortion(text: string, maximumCharacters: number): [string, string] {
  const codePoints = Array.from(text);
  if (codePoints.length <= maximumCharacters) return [text, ""];
  const candidate = codePoints.slice(0, maximumCharacters).join("");
  const lastSpace = candidate.lastIndexOf(" ");
  const minimumUsefulSplit = Math.floor(maximumCharacters * 0.5);
  const splitPosition = lastSpace >= minimumUsefulSplit ? lastSpace : candidate.length;
  return [candidate.slice(0, splitPosition).trimEnd(), text.slice(splitPosition).trimStart()];
}

function renderHeader(prefix: string, displayName: string, part: number, total: number): string {
  return part === 1 ? `${prefix} ${displayName}:` : `${prefix} ${displayName} (${part}/${total}):`;
}

function splitWithEstimatedTotal(
  prefix: string,
  displayName: string,
  message: string,
  maximumCharacters: number,
  estimatedTotal: number,
): string[] {
  const parts: string[] = [];
  let remaining = message;
  while (remaining.length > 0) {
    const partNumber = parts.length + 1;
    const header = renderHeader(prefix, displayName, partNumber, estimatedTotal);
    const availableCharacters = maximumCharacters - codePointLength(header) - 1;
    if (availableCharacters < 1) {
      throw new RangeError(
        "The game chat maximum is too short for the configured prefix and sender name.",
      );
    }
    const [portion, rest] = takeTextPortion(remaining, availableCharacters);
    parts.push(`${header} ${portion}`);
    remaining = rest;
  }
  return parts;
}

export function splitGameBoundMessage(
  prefix: string,
  displayName: string,
  message: string,
  maximumCharacters: number,
): string[] {
  const singleMessage = `${prefix} ${displayName}: ${message}`;
  if (codePointLength(singleMessage) <= maximumCharacters) return [singleMessage];

  let estimatedTotal = 2;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const parts = splitWithEstimatedTotal(
      prefix,
      displayName,
      message,
      maximumCharacters,
      estimatedTotal,
    );
    if (parts.length === estimatedTotal) return parts;
    estimatedTotal = parts.length;
  }
  throw new RangeError("Could not split the game-bound message within the configured limit.");
}
