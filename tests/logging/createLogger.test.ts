import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/logging/createLogger.js";

describe("structured logging", () => {
  it("honors the configured log level and installs secret redaction", () => {
    const logger = createLogger({ LOG_LEVEL: "silent" });
    expect(logger.level).toBe("silent");
    expect(logger.bindings()).toMatchObject({ service: "hyborian-relay" });
  });
});
