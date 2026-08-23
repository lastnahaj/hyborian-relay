import { RelayError } from "../../errors/RelayError.js";

export type RconCommandPriority = "chat" | "interactive-status" | "background-tracking";

const priorityOrder: Record<RconCommandPriority, number> = {
  chat: 0,
  "interactive-status": 1,
  "background-tracking": 2,
};

interface QueuedCommand {
  priority: number;
  sequence: number;
  execute: () => Promise<void>;
  reject: (error: Error) => void;
}

export class RconCommandQueue {
  readonly #maximumPendingCommands: number;
  readonly #pendingCommands: QueuedCommand[] = [];
  readonly #idleWaiters = new Set<() => void>();
  #executing = false;
  #closed = false;
  #sequence = 0;

  public constructor(maximumPendingCommands: number) {
    if (!Number.isInteger(maximumPendingCommands) || maximumPendingCommands < 1) {
      throw new RangeError("RCON queue capacity must be a positive integer.");
    }
    this.#maximumPendingCommands = maximumPendingCommands;
  }

  public enqueue<T>(operation: () => Promise<T>, priority: RconCommandPriority): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("RCON command queue is closed."));
    if (this.#pendingCommands.length >= this.#maximumPendingCommands) {
      return Promise.reject(
        new RelayError(
          "RCON_QUEUE_FULL",
          `RCON command queue reached its limit of ${this.#maximumPendingCommands} pending commands.`,
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      this.#pendingCommands.push({
        priority: priorityOrder[priority],
        sequence: this.#sequence,
        execute: async () => {
          try {
            resolve(await operation());
          } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject,
      });
      this.#sequence += 1;
      this.#pendingCommands.sort(
        (left, right) => left.priority - right.priority || left.sequence - right.sequence,
      );
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#executing) return;
    this.#executing = true;
    try {
      while (this.#pendingCommands.length > 0) {
        const command = this.#pendingCommands.shift();
        if (command !== undefined) await command.execute();
      }
    } finally {
      this.#executing = false;
      if (this.#pendingCommands.length === 0) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
    }
  }

  public async close(): Promise<void> {
    this.#closed = true;
    const closeError = new Error("RCON command queue closed before the command could run.");
    for (const command of this.#pendingCommands.splice(0)) command.reject(closeError);
    if (!this.#executing) return;
    await new Promise<void>((resolve) => this.#idleWaiters.add(resolve));
  }

  public get pendingCount(): number {
    return this.#pendingCommands.length;
  }
}
