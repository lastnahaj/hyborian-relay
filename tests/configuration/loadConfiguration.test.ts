import { describe, expect, it } from "vitest";

import { loadConfiguration } from "../../src/configuration/loadConfiguration.js";

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    DISCORD_BOT_TOKEN: "fictional-token-kept-outside-repository-use",
    DISCORD_APPLICATION_ID: "123456789012345678",
    DISCORD_GUILD_ID: "223456789012345678",
    DISCORD_CHAT_CHANNEL_ID: "323456789012345678",
    DISCORD_EVENT_CHANNEL_ID: "423456789012345678",
    CONAN_RCON_PASSWORD: "local-rcon-secret",
    CONAN_LOG_PATH: "/srv/conan/ConanSandbox/Saved/Logs/ConanSandbox.log",
  };
}

describe("configuration validation", () => {
  it("loads safe defaults and the death-channel fallback", () => {
    const configuration = loadConfiguration(validEnvironment());

    expect(configuration.GAME_CHAT_TRANSPORT).toBe("automatic");
    expect(configuration.GAME_CHAT_ALLOWED_CHANNELS).toEqual(new Set(["global"]));
    expect(configuration.ALLOW_UNKNOWN_GAME_CHAT_CHANNEL).toBe(false);
    expect(configuration.DISCORD_DEATH_CHANNEL_ID).toBeUndefined();
  });

  it("rejects a missing bot token", () => {
    const environment = validEnvironment();
    delete environment.DISCORD_BOT_TOKEN;

    expect(() => loadConfiguration(environment)).toThrow(/DISCORD_BOT_TOKEN/u);
  });

  it("rejects malformed Discord identifiers and booleans", () => {
    expect(() =>
      loadConfiguration({
        ...validEnvironment(),
        DISCORD_GUILD_ID: "not-a-discord-id",
        TRACK_PLAYERS: "sometimes",
      }),
    ).toThrow(/DISCORD_GUILD_ID|TRACK_PLAYERS/u);
  });

  it("requires a webhook URL only when webhook rendering is selected", () => {
    expect(() =>
      loadConfiguration({ ...validEnvironment(), DISCORD_GAME_CHAT_RENDERING: "webhook" }),
    ).toThrow(/DISCORD_GAME_CHAT_WEBHOOK_URL/u);

    expect(
      loadConfiguration({
        ...validEnvironment(),
        DISCORD_GAME_CHAT_RENDERING: "webhook",
        DISCORD_GAME_CHAT_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
      }).DISCORD_GAME_CHAT_RENDERING,
    ).toBe("webhook");
  });

  it("requires a Conan log when event-backed features are enabled", () => {
    const environment = validEnvironment();
    delete environment.CONAN_LOG_PATH;

    expect(() => loadConfiguration(environment)).toThrow(/CONAN_LOG_PATH/u);
    expect(
      loadConfiguration({
        ...environment,
        GAME_TO_DISCORD_CHAT_ENABLED: "false",
        TRACK_PLAYER_DEATHS: "false",
      }).CONAN_LOG_PATH,
    ).toBeUndefined();
  });

  it("rejects sessions when player tracking is disabled", () => {
    expect(() => loadConfiguration({ ...validEnvironment(), TRACK_PLAYERS: "false" })).toThrow(
      /TRACK_PLAYER_SESSIONS/u,
    );
  });

  it("parses explicit limits and allowed channels", () => {
    const configuration = loadConfiguration({
      ...validEnvironment(),
      SERVER_MAXIMUM_PLAYERS: "40",
      GAME_CHAT_ALLOWED_CHANNELS: "global,unknown",
      ALLOW_UNKNOWN_GAME_CHAT_CHANNEL: "true",
    });

    expect(configuration.SERVER_MAXIMUM_PLAYERS).toBe(40);
    expect(configuration.GAME_CHAT_ALLOWED_CHANNELS).toEqual(new Set(["global", "unknown"]));
  });
});
