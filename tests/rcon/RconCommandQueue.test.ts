import { describe, expect, it } from "vitest";

import { RconCommandQueue } from "../../src/conan/rcon/RconCommandQueue.js";

describe("RCON command queue", () => {
  it("serializes commands and lets chat pass queued background tracking", async () => {
    const queue = new RconCommandQueue(4);
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push("status-running");
            resolve();
          };
        }),
      "interactive-status",
    );
    await Promise.resolve();
    const background = queue.enqueue(async () => {
      order.push("players");
    }, "background-tracking");
    const chat = queue.enqueue(async () => {
      order.push("chat");
    }, "chat");

    releaseFirst?.();
    await Promise.all([first, background, chat]);
    expect(order).toEqual(["status-running", "chat", "players"]);
    await queue.close();
  });

  it("rejects work beyond the configured pending capacity", async () => {
    const queue = new RconCommandQueue(1);
    let release: (() => void) | undefined;
    const running = queue.enqueue(
      () => new Promise<void>((resolve) => (release = resolve)),
      "chat",
    );
    await Promise.resolve();
    const pending = queue.enqueue(async () => "Velmira", "background-tracking");

    await expect(queue.enqueue(async () => "Drenik", "chat")).rejects.toMatchObject({
      code: "RCON_QUEUE_FULL",
    });
    release?.();
    await expect(pending).resolves.toBe("Velmira");
    await running;
    await queue.close();
  });
});
