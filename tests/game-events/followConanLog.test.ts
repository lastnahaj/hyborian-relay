import { appendFile, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConanLogFollower } from "../../src/conan/logs/followConanLog.js";

const temporaryDirectories: string[] = [];

async function temporaryLogPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hyborian-relay-log-"));
  temporaryDirectories.push(directory);
  return join(directory, "ConanSandbox.log");
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Conan log follower", () => {
  it("does not replay a large pre-existing log when starting at the end", async () => {
    const logPath = await temporaryLogPath();
    await writeFile(logPath, `${"old event\n".repeat(20_000)}`, "utf8");
    const lines: string[] = [];
    const follower = new ConanLogFollower({
      path: logPath,
      startPosition: "end",
      onLine: (line) => void lines.push(line),
      onError: vi.fn(),
    });

    await follower.pollOnce();
    await appendFile(logPath, "Vaelric entered Global chat.\n", "utf8");
    await follower.pollOnce();
    expect(lines).toEqual(["Vaelric entered Global chat."]);
  });

  it("holds partial lines, preserves UTF-8, and handles multiple lines per read", async () => {
    const logPath = await temporaryLogPath();
    await writeFile(logPath, "", "utf8");
    const lines: string[] = [];
    const follower = new ConanLogFollower({
      path: logPath,
      startPosition: "beginning",
      onLine: (line) => void lines.push(line),
      onError: vi.fn(),
    });

    await appendFile(logPath, "Kessíra began", "utf8");
    await follower.pollOnce();
    expect(lines).toEqual([]);
    await appendFile(logPath, " scouting.\nTorven returned.\nNyssara waved.\n", "utf8");
    await follower.pollOnce();
    expect(lines).toEqual(["Kessíra began scouting.", "Torven returned.", "Nyssara waved."]);
  });

  it("follows truncation, rotation, deletion, and recreation", async () => {
    const logPath = await temporaryLogPath();
    await writeFile(logPath, "Brannoc arrived.\n", "utf8");
    const lines: string[] = [];
    const follower = new ConanLogFollower({
      path: logPath,
      startPosition: "beginning",
      onLine: (line) => void lines.push(line),
      onError: vi.fn(),
    });
    await follower.pollOnce();

    await writeFile(logPath, "Selvara survived truncation.\n", "utf8");
    await follower.pollOnce();
    await rename(logPath, `${logPath}.1`);
    await writeFile(logPath, "Odran entered the rotated log.\n", "utf8");
    await follower.pollOnce();
    await rm(logPath);
    await follower.pollOnce();
    await writeFile(logPath, "Maerwyn entered the recreated log.\n", "utf8");
    await follower.pollOnce();

    expect(lines).toEqual([
      "Brannoc arrived.",
      "Selvara survived truncation.",
      "Odran entered the rotated log.",
      "Maerwyn entered the recreated log.",
    ]);
  });

  it("waits when the file is absent at startup and reports inaccessible paths", async () => {
    const logPath = await temporaryLogPath();
    const lines: string[] = [];
    const errors: Error[] = [];
    const follower = new ConanLogFollower({
      path: logPath,
      startPosition: "end",
      onLine: (line) => void lines.push(line),
      onError: (error) => void errors.push(error),
    });
    await follower.pollOnce();
    await writeFile(logPath, "Corveth appeared with the new server log.\n", "utf8");
    await follower.pollOnce();
    expect(lines).toEqual(["Corveth appeared with the new server log."]);
    expect(errors).toEqual([]);

    const directoryPath = dirname(logPath);
    const invalidFollower = new ConanLogFollower({
      path: directoryPath,
      startPosition: "end",
      onLine: vi.fn(),
      onError: (error) => void errors.push(error),
    });
    await invalidFollower.pollOnce();
    expect(errors.length).toBeGreaterThan(0);
  });
});
