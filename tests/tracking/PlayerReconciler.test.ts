import { describe, expect, it } from "vitest";

import type { ConanPlayer } from "../../src/conan/players/parsePlayerListResponse.js";
import { PlayerReconciler } from "../../src/tracking/PlayerReconciler.js";

function player(identityKey: string, characterName: string): ConanPlayer {
  return { identityKey, characterName };
}

describe("player reconciliation", () => {
  it("establishes a silent baseline, then emits one join and one threshold-confirmed leave", () => {
    const reconciler = new PlayerReconciler(2);
    expect(reconciler.reconcile([player("funcom:brannoc", "Brannoc")]).baselineEstablished).toBe(
      true,
    );

    const joined = reconciler.reconcile([
      player("funcom:brannoc", "Brannoc"),
      player("funcom:nyssara", "Nyssara"),
    ]);
    expect(joined.joins.map(({ characterName }) => characterName)).toEqual(["Nyssara"]);
    expect(reconciler.reconcile([player("funcom:nyssara", "Nyssara")]).leaves).toEqual([]);
    expect(
      reconciler
        .reconcile([player("funcom:nyssara", "Nyssara")])
        .leaves.map(({ characterName }) => characterName),
    ).toEqual(["Brannoc"]);
  });

  it("tracks a rename by stable identity without inventing a leave and join", () => {
    const reconciler = new PlayerReconciler(1);
    reconciler.reconcile([player("platform:76561198000000010", "Corveth")]);
    const renamed = reconciler.reconcile([
      player("platform:76561198000000010", "Corveth Ash-Walker"),
    ]);

    expect(renamed.joins).toEqual([]);
    expect(renamed.leaves).toEqual([]);
    expect(renamed.renamed).toEqual([
      {
        previousName: "Corveth",
        player: {
          identityKey: "platform:76561198000000010",
          characterName: "Corveth Ash-Walker",
        },
      },
    ]);
  });

  it("invalidates an outage baseline while retaining a stale last-known snapshot", () => {
    const reconciler = new PlayerReconciler(1);
    reconciler.reconcile([
      player("funcom:velmira", "Velmira"),
      player("funcom:dravenor", "Dravenor"),
    ]);
    expect(reconciler.invalidateBaseline().map(({ characterName }) => characterName)).toEqual([
      "Dravenor",
      "Velmira",
    ]);
    const returned = reconciler.reconcile([player("funcom:velmira", "Velmira")]);
    expect(returned.baselineEstablished).toBe(true);
    expect(returned.joins).toEqual([]);
  });
});
