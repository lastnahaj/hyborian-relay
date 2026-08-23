import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

type LogStartPosition = "beginning" | "end";

export interface ConanLogFollowerOptions {
  path: string;
  startPosition: LogStartPosition;
  pollIntervalMilliseconds?: number;
  onLine: (line: string) => void | Promise<void>;
  onError: (error: Error) => void;
  onHealthy?: () => void;
}

function fileSignature(device: number, inode: number): string {
  return `${device}:${inode}`;
}

export class ConanLogFollower {
  readonly #options: ConanLogFollowerOptions;
  #pollTimer: NodeJS.Timeout | undefined;
  #signature: string | undefined;
  #offset = 0;
  #partialLine = "";
  #decoder = new StringDecoder("utf8");
  #tailBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #firstPoll = true;
  #polling = false;

  public constructor(options: ConanLogFollowerOptions) {
    this.#options = options;
  }

  public start(): void {
    if (this.#pollTimer !== undefined) return;
    void this.pollOnce();
    this.#pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.#options.pollIntervalMilliseconds ?? 500);
  }

  public async pollOnce(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      await this.#pollFile();
      this.#options.onHealthy?.();
    } catch (error: unknown) {
      this.#options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#firstPoll = false;
      this.#polling = false;
    }
  }

  async #pollFile(): Promise<void> {
    let fileStatus;
    try {
      fileStatus = await stat(this.#options.path);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.#signature = undefined;
        this.#offset = 0;
        this.#partialLine = "";
        this.#decoder = new StringDecoder("utf8");
        this.#tailBytes = Buffer.alloc(0);
        return;
      }
      throw error;
    }

    if (!fileStatus.isFile())
      throw new Error(`Conan log path is not a regular file: ${this.#options.path}`);

    const currentSignature = fileSignature(fileStatus.dev, fileStatus.ino);
    if (this.#signature === undefined) {
      this.#signature = currentSignature;
      this.#offset = this.#firstPoll && this.#options.startPosition === "end" ? fileStatus.size : 0;
      this.#tailBytes = await this.#readTail(this.#offset);
    } else if (
      this.#signature !== currentSignature ||
      fileStatus.size < this.#offset ||
      !(await this.#previousTailMatches())
    ) {
      this.#signature = currentSignature;
      this.#offset = 0;
      this.#partialLine = "";
      this.#decoder = new StringDecoder("utf8");
      this.#tailBytes = Buffer.alloc(0);
    }
    if (fileStatus.size <= this.#offset) return;
    await this.#readAppendedData(fileStatus.size);
    this.#tailBytes = await this.#readTail(this.#offset);
  }

  async #previousTailMatches(): Promise<boolean> {
    if (this.#tailBytes.length === 0) return true;
    const currentTail = await this.#readTail(this.#offset, this.#tailBytes.length);
    return currentTail.equals(this.#tailBytes);
  }

  async #readTail(endOffset: number, maximumBytes = 256): Promise<Buffer> {
    const byteCount = Math.min(endOffset, maximumBytes);
    if (byteCount === 0) return Buffer.alloc(0);
    const file = await open(this.#options.path, "r");
    try {
      const buffer = Buffer.allocUnsafe(byteCount);
      const { bytesRead } = await file.read(buffer, 0, byteCount, endOffset - byteCount);
      return Buffer.from(buffer.subarray(0, bytesRead));
    } finally {
      await file.close();
    }
  }

  async #readAppendedData(targetSize: number): Promise<void> {
    const file = await open(this.#options.path, "r");
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (this.#offset < targetSize) {
        const requestedBytes = Math.min(buffer.length, targetSize - this.#offset);
        const { bytesRead } = await file.read(buffer, 0, requestedBytes, this.#offset);
        if (bytesRead === 0) break;
        this.#offset += bytesRead;
        await this.#consumeText(this.#decoder.write(buffer.subarray(0, bytesRead)));
      }
    } finally {
      await file.close();
    }
  }

  async #consumeText(text: string): Promise<void> {
    const lines = `${this.#partialLine}${text}`.split(/\r?\n/u);
    this.#partialLine = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) await this.#options.onLine(line);
    }
  }

  public stop(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }
}
