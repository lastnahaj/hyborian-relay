import { describe, expect, it } from "vitest";

import { parsePlayerListResponse } from "../../src/conan/players/parsePlayerListResponse.js";

describe("Conan player-list parser", () => {
  it("parses stable identifiers, Unicode, spaces, headers, and whitespace variation", () => {
    const response = `
      Idx | Char name        | Player name | Platform ID       | Funcom ID
      ----+------------------+-------------+-------------------+----------------
      0   | Vaelric the Bold | VRelic      | 76561198000000001 | funcom-vaelric
      1   | Kessíra          | SandSeer    | 76561198000000002 |
    `;

    expect(parsePlayerListResponse(response)).toEqual([
      {
        identityKey: "funcom:funcom-vaelric",
        characterName: "Vaelric the Bold",
        platformIdentifier: "76561198000000001",
        funcomIdentifier: "funcom-vaelric",
      },
      {
        identityKey: "platform:76561198000000002",
        characterName: "Kessíra",
        platformIdentifier: "76561198000000002",
      },
    ]);
  });

  it.each(["", "No players online.", "Players Online: 0"])(
    "recognizes an empty server response: %s",
    (response) => {
      expect(parsePlayerListResponse(response)).toEqual([]);
    },
  );

  it("falls back to a normalized character identity only without a stable identifier", () => {
    const response = "Idx | Character Name\n0 | Maerwyn of Asura";
    expect(parsePlayerListResponse(response)[0]).toEqual({
      identityKey: "character:maerwyn of asura",
      characterName: "Maerwyn of Asura",
    });
  });

  it("rejects unknown formats and duplicate stable identities", () => {
    expect(() => parsePlayerListResponse("Rhovan is online somewhere")).toThrow(
      /recognized header/u,
    );
    expect(() =>
      parsePlayerListResponse(
        "Idx | Char name | Funcom ID\n0 | Selvara | one-key\n1 | Elsyra | one-key",
      ),
    ).toThrow(/repeated stable identity/u);
  });
});
