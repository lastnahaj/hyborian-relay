import { describe, expect, it } from "vitest";

import { ChatEchoMemory } from "../../src/chat/ChatEchoMemory.js";
import { ChatRateLimiter } from "../../src/chat/ChatRateLimiter.js";
import {
  sanitizeDiscordDisplayName,
  sanitizeGameBoundText,
} from "../../src/chat/sanitizeGameBoundText.js";
import { splitGameBoundMessage } from "../../src/chat/splitGameBoundMessage.js";

describe("game-bound chat safety", () => {
  it("removes command-breaking controls while preserving Unicode and punctuation", () => {
    expect(sanitizeGameBoundText("  Kaedren\r\n says;  привет\0  ")).toBe("Kaedren says； привет");
    expect(sanitizeDiscordDisplayName("[Mirelda]: Scout")).toBe("(Mirelda)꞉ Scout");
  });

  it("splits long messages on useful boundaries without splitting Unicode code points", () => {
    const portions = splitGameBoundMessage(
      "[Discord]",
      "Serapha",
      "The northern aqueduct is clear, but bring antidotes before crossing the jungle ruins. 🗡️",
      62,
    );

    expect(portions.length).toBeGreaterThan(1);
    expect(portions[1]).toMatch(/Serapha \(2\/\d+\):/u);
    expect(portions.every((portion) => Array.from(portion).length <= 62)).toBe(true);
    expect(portions.join(" ")).toContain("🗡️");
  });

  it("enforces both per-user and global windows", () => {
    const limiter = new ChatRateLimiter({
      userMessageLimit: 2,
      userWindowMilliseconds: 1_000,
      globalMessageLimit: 3,
      globalWindowMilliseconds: 1_000,
    });

    expect(limiter.check("Torven", 0).allowed).toBe(true);
    expect(limiter.check("Torven", 10).allowed).toBe(true);
    expect(limiter.check("Torven", 20).allowed).toBe(false);
    expect(limiter.check("Nyssara", 30).allowed).toBe(true);
    expect(limiter.check("Rhovan", 40).allowed).toBe(false);
    expect(limiter.check("Rhovan", 1_100).allowed).toBe(true);
  });

  it("suppresses only a matching recent echo and expires bounded entries", () => {
    const memory = new ChatEchoMemory(1_000, 2);
    memory.record("[Discord] Selvara: Need a carpenter.", 0);
    memory.record("[Discord] Odran: The Sinkhole is clear.", 10);
    memory.record("[Discord] Kessira: Sandstorm incoming.", 20);

    expect(memory.size).toBe(2);
    expect(memory.consumeIfEcho("[Discord] Selvara: Need a carpenter.", 30)).toBe(false);
    expect(memory.consumeIfEcho("[Discord] Odran: The Sinkhole is clear.", 30)).toBe(true);
    expect(memory.consumeIfEcho("[Discord] Kessira: Sandstorm incoming.", 2_000)).toBe(false);
  });
});
