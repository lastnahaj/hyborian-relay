import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InstanceLock } from "../../src/runtime/InstanceLock.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("single-instance protection", () => {
  it("rejects a second live process lock and releases the owned lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hyborian-relay-lock-"));
    temporaryDirectories.push(directory);
    const database = join(directory, "relay.db");
    const first = new InstanceLock(database);
    const second = new InstanceLock(database);

    first.acquire();
    expect(() => second.acquire()).toThrow(/Another Hyborian Relay instance/u);
    first.release();
    expect(() => second.acquire()).not.toThrow();
    second.release();
  });

  it("replaces a stale lock whose process no longer exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hyborian-relay-stale-lock-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "hyborian-relay.lock"), "2147483647\n", "utf8");
    const lock = new InstanceLock(join(directory, "relay.db"));

    expect(() => lock.acquire()).not.toThrow();
    lock.release();
  });

  it.runIf(process.platform === "linux")(
    "replaces a lock when the process identifier has been reused",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "hyborian-relay-reused-lock-"));
      temporaryDirectories.push(directory);
      await writeFile(
        join(directory, "hyborian-relay.lock"),
        `${JSON.stringify({ processIdentifier: process.pid, linuxStartIdentifier: "stale" })}\n`,
        "utf8",
      );
      const lock = new InstanceLock(join(directory, "relay.db"));

      expect(() => lock.acquire()).not.toThrow();
      lock.release();
    },
  );
});
