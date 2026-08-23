import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isPotentialDeathEvent,
  parseDeathEvent,
  renderDeathNotification,
} from "../../src/conan/logs/parseDeathEvent.js";

const deathLines = readFileSync(
  new URL("../fixtures/conan-death-events.log", import.meta.url),
  "utf8",
)
  .trim()
  .split("\n");

describe("Conan death event parser", () => {
  it.each([
    [0, "Serapha", "Kaedren", "player_kill"],
    [1, "Torven", "Rocknose", "creature_kill"],
    [2, "Brannoc", "Relic Hunter", "non_player_character_kill"],
    [6, "Yseldra", "Dravenor", "unknown"],
  ] as const)(
    "parses supported killer attribution fixture %s without inventing classification",
    (lineIndex, victimName, killerName, classification) => {
      const event = parseDeathEvent(deathLines[lineIndex] ?? "");
      expect(event).toMatchObject({ victimName, killerName, classification });
      expect(event?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    },
  );

  it("parses explicit environmental, self-inflicted, and unknown deaths", () => {
    expect(parseDeathEvent(deathLines[3] ?? "")).toMatchObject({
      victimName: "Mirelda",
      classification: "environment",
      cause: "falling",
    });
    expect(parseDeathEvent(deathLines[4] ?? "")?.classification).toBe("self_inflicted");
    expect(parseDeathEvent(deathLines[5] ?? "")).toMatchObject({
      victimName: "Velmira",
      classification: "unknown",
    });
  });

  it("renders natural community messages", () => {
    const creatureDeath = parseDeathEvent(deathLines[1] ?? "");
    const environmentalDeath = parseDeathEvent(deathLines[3] ?? "");
    const unknownDeath = parseDeathEvent(deathLines[5] ?? "");
    expect(creatureDeath && renderDeathNotification(creatureDeath)).toBe(
      "Torven was killed by a Rocknose.",
    );
    expect(environmentalDeath && renderDeathNotification(environmentalDeath)).toBe(
      "Mirelda died from falling.",
    );
    expect(unknownDeath && renderDeathNotification(unknownDeath)).toBe("Velmira died.");
  });

  it("keeps separate legitimate deaths distinct while rejecting unrelated input", () => {
    const first = parseDeathEvent(
      "[2026.08.21-21.00.00:000]LogGameEvent: Drenik died from poison.",
    );
    const later = parseDeathEvent(
      "[2026.08.21-21.05.00:000]LogGameEvent: Drenik died from poison.",
    );
    expect(first?.sourceFingerprint).not.toBe(later?.sourceFingerprint);
    expect(parseDeathEvent("[2026.08.21-21.00.00:000]LogNet: Rhovan disconnected")).toBeUndefined();
  });

  it("identifies only event-source death candidates for degraded-format reporting", () => {
    expect(
      isPotentialDeathEvent(
        "[2026.08.21-21.06.00:000][Pippi]EventLog: Elsyra met a fatal death event in the volcano.",
      ),
    ).toBe(true);
    expect(
      isPotentialDeathEvent(
        "[2026.08.21-21.06.00:000][Pippi]PippiChat: Elsyra said in channel [Global]: That fall nearly killed me.",
      ),
    ).toBe(false);
  });
});
