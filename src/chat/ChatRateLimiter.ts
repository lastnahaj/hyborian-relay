interface RateLimitDecision {
  allowed: boolean;
  retryAfterMilliseconds: number;
}

export interface ChatRateLimitSettings {
  userMessageLimit: number;
  userWindowMilliseconds: number;
  globalMessageLimit: number;
  globalWindowMilliseconds: number;
}

function discardExpired(timestamps: number[], cutoff: number): void {
  const firstCurrentIndex = timestamps.findIndex((timestamp) => timestamp > cutoff);
  if (firstCurrentIndex === -1) timestamps.splice(0);
  else if (firstCurrentIndex > 0) timestamps.splice(0, firstCurrentIndex);
}

export class ChatRateLimiter {
  readonly #settings: ChatRateLimitSettings;
  readonly #userTimestamps = new Map<string, number[]>();
  readonly #globalTimestamps: number[] = [];

  public constructor(settings: ChatRateLimitSettings) {
    this.#settings = settings;
  }

  public check(userIdentifier: string, now = Date.now()): RateLimitDecision {
    const userTimestamps = this.#userTimestamps.get(userIdentifier) ?? [];
    discardExpired(userTimestamps, now - this.#settings.userWindowMilliseconds);
    discardExpired(this.#globalTimestamps, now - this.#settings.globalWindowMilliseconds);

    if (userTimestamps.length >= this.#settings.userMessageLimit) {
      const oldestTimestamp = userTimestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterMilliseconds: Math.max(
          1,
          oldestTimestamp + this.#settings.userWindowMilliseconds - now,
        ),
      };
    }
    if (this.#globalTimestamps.length >= this.#settings.globalMessageLimit) {
      const oldestTimestamp = this.#globalTimestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterMilliseconds: Math.max(
          1,
          oldestTimestamp + this.#settings.globalWindowMilliseconds - now,
        ),
      };
    }

    userTimestamps.push(now);
    this.#userTimestamps.set(userIdentifier, userTimestamps);
    this.#globalTimestamps.push(now);
    this.#removeEmptyUsers(now);
    return { allowed: true, retryAfterMilliseconds: 0 };
  }

  #removeEmptyUsers(now: number): void {
    for (const [userIdentifier, timestamps] of this.#userTimestamps) {
      discardExpired(timestamps, now - this.#settings.userWindowMilliseconds);
      if (timestamps.length === 0) this.#userTimestamps.delete(userIdentifier);
    }
  }
}
