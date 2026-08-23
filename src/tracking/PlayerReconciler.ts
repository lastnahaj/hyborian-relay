import type { ConanPlayer } from "../conan/players/parsePlayerListResponse.js";

interface TrackedPlayer {
  player: ConanPlayer;
  missingPolls: number;
}

export interface PlayerReconciliation {
  joins: ConanPlayer[];
  leaves: ConanPlayer[];
  renamed: Array<{ previousName: string; player: ConanPlayer }>;
  currentPlayers: ConanPlayer[];
  baselineEstablished: boolean;
}

export class PlayerReconciler {
  readonly #missingPollsBeforeLeave: number;
  readonly #trackedPlayers = new Map<string, TrackedPlayer>();
  #hasBaseline = false;

  public constructor(missingPollsBeforeLeave: number) {
    this.#missingPollsBeforeLeave = missingPollsBeforeLeave;
  }

  public reconcile(observedPlayers: ConanPlayer[]): PlayerReconciliation {
    if (!this.#hasBaseline) {
      this.#trackedPlayers.clear();
      for (const player of observedPlayers) {
        this.#trackedPlayers.set(player.identityKey, { player, missingPolls: 0 });
      }
      this.#hasBaseline = true;
      return {
        joins: [],
        leaves: [],
        renamed: [],
        currentPlayers: observedPlayers,
        baselineEstablished: true,
      };
    }

    const observedIdentities = new Set(observedPlayers.map((player) => player.identityKey));
    const joins: ConanPlayer[] = [];
    const leaves: ConanPlayer[] = [];
    const renamed: Array<{ previousName: string; player: ConanPlayer }> = [];

    for (const player of observedPlayers) {
      const tracked = this.#trackedPlayers.get(player.identityKey);
      if (tracked === undefined) {
        joins.push(player);
        this.#trackedPlayers.set(player.identityKey, { player, missingPolls: 0 });
        continue;
      }
      if (tracked.player.characterName !== player.characterName) {
        renamed.push({ previousName: tracked.player.characterName, player });
      }
      tracked.player = player;
      tracked.missingPolls = 0;
    }

    for (const [identityKey, tracked] of this.#trackedPlayers) {
      if (observedIdentities.has(identityKey)) continue;
      tracked.missingPolls += 1;
      if (tracked.missingPolls >= this.#missingPollsBeforeLeave) {
        leaves.push(tracked.player);
        this.#trackedPlayers.delete(identityKey);
      }
    }

    return {
      joins,
      leaves,
      renamed,
      currentPlayers: this.currentPlayers,
      baselineEstablished: false,
    };
  }

  public invalidateBaseline(): ConanPlayer[] {
    const previouslyOnline = this.currentPlayers;
    this.#hasBaseline = false;
    return previouslyOnline;
  }

  public get currentPlayers(): ConanPlayer[] {
    return [...this.#trackedPlayers.values()]
      .map(({ player }) => player)
      .sort((left, right) => left.characterName.localeCompare(right.characterName));
  }
}
