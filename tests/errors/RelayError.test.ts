import { describe, expect, it } from "vitest";

import { describeUnknownError, RelayError } from "../../src/errors/RelayError.js";

describe("application errors", () => {
  it("keeps a stable operator error code and safely describes unknown failures", () => {
    const error = new RelayError("RCON_CONNECTION_FAILED", "RCON closed for Thalric's poll.");
    expect(error.name).toBe("RelayError");
    expect(error.code).toBe("RCON_CONNECTION_FAILED");
    expect(describeUnknownError(error)).toBe("RCON closed for Thalric's poll.");
    expect(describeUnknownError("database unavailable")).toBe("database unavailable");
  });
});
