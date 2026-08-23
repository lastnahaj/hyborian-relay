import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseChatEvent } from "../../src/conan/logs/parseChatEvent.js";

const fixtureLines = readFileSync(
  new URL("../fixtures/conan-chat-events.log", import.meta.url),
  "utf8",
)
  .trim()
  .split("\n");

describe("Pippi chat event parser", () => {
  it("parses a verified Global event with timestamp, punctuation, and spaces", () => {
    expect(parseChatEvent(fixtureLines[0] ?? "")).toEqual({
      playerName: "Vaelric",
      message: "Anyone running the Wine Cellar?",
      channel: "global",
      occurredAt: new Date("2026-08-21T18:10:01.120Z"),
      source: "pippi-chat-log",
    });
  });

  it("classifies private channels and unfamiliar channels without guessing", () => {
    expect(parseChatEvent(fixtureLines[1] ?? "")?.channel).toBe("clan");
    expect(parseChatEvent(fixtureLines[2] ?? "")?.channel).toBe("whisper");
    expect(parseChatEvent(fixtureLines[3] ?? "")?.channel).toBe("unknown");
  });

  it("preserves Unicode names and rejects malformed or unrelated lines", () => {
    const unicodeLine =
      "[2026.08.21-18.20.01:010][Pippi]PippiChat: Kessíra of Asura said in channel [Global]: Привет, exiles!";
    expect(parseChatEvent(unicodeLine)?.playerName).toBe("Kessíra of Asura");
    expect(parseChatEvent("[2026.08.21-18.20.01:010]LogNet: Connection accepted")).toBeUndefined();
    expect(
      parseChatEvent("[Pippi]PippiChat: Selvara said in channel [Global]: Missing timestamp"),
    ).toBeUndefined();
  });
});
