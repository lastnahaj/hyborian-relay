import { describe, expect, it } from "vitest";

import { selectValidationCategories } from "../../scripts/select-github-validation.mjs";

describe("change-aware GitHub validation selection", () => {
  it.each([
    ["README.md", ["documentation"]],
    ["src/conan/rcon/RconPacketCodec.ts", ["rcon", "typescript-source"]],
    [
      "src/conan/logs/parseDeathEvent.ts",
      ["chat", "death-tracking", "game-events", "typescript-source"],
    ],
    ["src/tracking/DeathTracker.ts", ["death-tracking", "player-tracking", "typescript-source"]],
    [
      "src/storage/RelayDatabase.ts",
      ["death-tracking", "player-tracking", "storage", "typescript-source"],
    ],
    ["Dockerfile", ["docker"]],
    ["packaging/hyborian-relay.service", ["linux-packaging"]],
    ["package.json", ["full"]],
    [".github/workflows/validation.yml", ["full"]],
  ])("maps %s to its required validation groups", (path, expected) => {
    expect(selectValidationCategories([path])).toEqual(expected);
  });

  it("runs the full suite for an unfamiliar path", () => {
    expect(selectValidationCategories(["operations/relay.policy"])).toEqual(["full"]);
  });
});
