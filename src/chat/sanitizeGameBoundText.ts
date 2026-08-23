const repeatedWhitespace = /[\s\u00a0]+/gu;

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
  }).join("");
}

export function sanitizeGameBoundText(untrustedText: string): string {
  return replaceControlCharacters(untrustedText.normalize("NFC"))
    .replaceAll(";", "；")
    .replace(repeatedWhitespace, " ")
    .trim();
}

export function sanitizeDiscordDisplayName(untrustedDisplayName: string): string {
  const sanitizedName = sanitizeGameBoundText(untrustedDisplayName)
    .replaceAll(":", "꞉")
    .replaceAll("[", "(")
    .replaceAll("]", ")");
  return Array.from(sanitizedName).slice(0, 64).join("");
}
