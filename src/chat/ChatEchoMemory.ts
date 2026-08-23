import { createHash } from "node:crypto";

interface FingerprintEntry {
  fingerprint: string;
  expiresAt: number;
}

function fingerprint(renderedMessage: string): string {
  return createHash("sha256").update(renderedMessage.normalize("NFC")).digest("hex");
}

export class ChatEchoMemory {
  readonly #memoryMilliseconds: number;
  readonly #maximumEntries: number;
  readonly #entries: FingerprintEntry[] = [];

  public constructor(memoryMilliseconds: number, maximumEntries: number) {
    this.#memoryMilliseconds = memoryMilliseconds;
    this.#maximumEntries = maximumEntries;
  }

  public record(renderedMessage: string, now = Date.now()): void {
    this.#expire(now);
    this.#entries.push({
      fingerprint: fingerprint(renderedMessage),
      expiresAt: now + this.#memoryMilliseconds,
    });
    if (this.#entries.length > this.#maximumEntries) {
      this.#entries.splice(0, this.#entries.length - this.#maximumEntries);
    }
  }

  public consumeIfEcho(renderedMessage: string, now = Date.now()): boolean {
    this.#expire(now);
    const expectedFingerprint = fingerprint(renderedMessage);
    const matchingIndex = this.#entries.findIndex(
      (entry) => entry.fingerprint === expectedFingerprint,
    );
    if (matchingIndex === -1) return false;
    this.#entries.splice(matchingIndex, 1);
    return true;
  }

  #expire(now: number): void {
    let expiredCount = 0;
    while ((this.#entries[expiredCount]?.expiresAt ?? Number.POSITIVE_INFINITY) <= now) {
      expiredCount += 1;
    }
    if (expiredCount > 0) this.#entries.splice(0, expiredCount);
  }

  public get size(): number {
    return this.#entries.length;
  }
}
