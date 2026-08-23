import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { RelayError } from "../errors/RelayError.js";

interface LockOwner {
  processIdentifier: number;
  linuxStartIdentifier?: string;
}

function readLinuxProcessStartIdentifier(processIdentifier: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const processStatus = readFileSync(`/proc/${processIdentifier}/stat`, "utf8");
    const fieldsAfterName = processStatus
      .slice(processStatus.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/u);
    return fieldsAfterName[19];
  } catch {
    return undefined;
  }
}

function currentLockOwner(): LockOwner {
  const linuxStartIdentifier = readLinuxProcessStartIdentifier(process.pid);
  return {
    processIdentifier: process.pid,
    ...(linuxStartIdentifier === undefined ? {} : { linuxStartIdentifier }),
  };
}

function readLockOwner(path: string): LockOwner | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("processIdentifier" in value) ||
      typeof value.processIdentifier !== "number" ||
      !Number.isInteger(value.processIdentifier)
    ) {
      return undefined;
    }
    const linuxStartIdentifier =
      "linuxStartIdentifier" in value && typeof value.linuxStartIdentifier === "string"
        ? value.linuxStartIdentifier
        : undefined;
    return {
      processIdentifier: value.processIdentifier,
      ...(linuxStartIdentifier === undefined ? {} : { linuxStartIdentifier }),
    };
  } catch {
    return undefined;
  }
}

function isLockOwnerAlive(owner: LockOwner): boolean {
  try {
    process.kill(owner.processIdentifier, 0);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) return false;
  }
  if (owner.linuxStartIdentifier !== undefined && process.platform === "linux") {
    const currentStartIdentifier = readLinuxProcessStartIdentifier(owner.processIdentifier);
    return (
      currentStartIdentifier === undefined || currentStartIdentifier === owner.linuxStartIdentifier
    );
  }
  return true;
}

export class InstanceLock {
  readonly #path: string;
  #held = false;

  public constructor(databasePath: string) {
    this.#path = join(dirname(databasePath), "hyborian-relay.lock");
  }

  public acquire(): void {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = openSync(this.#path, "wx", 0o600);
        try {
          writeFileSync(descriptor, `${JSON.stringify(currentLockOwner())}\n`, "utf8");
        } finally {
          closeSync(descriptor);
        }
        this.#held = true;
        return;
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        const existingOwner = readLockOwner(this.#path);
        if (existingOwner !== undefined && isLockOwnerAlive(existingOwner)) {
          throw new RelayError(
            "INSTANCE_ALREADY_RUNNING",
            "Another Hyborian Relay instance is already using this data directory.",
          );
        }
        try {
          unlinkSync(this.#path);
        } catch (unlinkError: unknown) {
          if (!(
            unlinkError instanceof Error &&
            "code" in unlinkError &&
            unlinkError.code === "ENOENT"
          )) {
            throw unlinkError;
          }
        }
      }
    }
    throw new RelayError(
      "INSTANCE_ALREADY_RUNNING",
      "Another Hyborian Relay instance is already using this data directory.",
    );
  }

  public release(): void {
    if (!this.#held) return;
    try {
      const recordedOwner = readLockOwner(this.#path);
      if (recordedOwner?.processIdentifier === process.pid) unlinkSync(this.#path);
    } finally {
      this.#held = false;
    }
  }
}
