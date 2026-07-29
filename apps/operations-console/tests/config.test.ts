import { describe, expect, it } from "vitest";

import { getConsoleConfig } from "../src/lib/config";

describe("getConsoleConfig", () => {
  it("uses a mobile-safe bounded timeout and two read attempts", () => {
    expect(getConsoleConfig()).toMatchObject({
      fetchTimeoutMs: 6000,
      fetchAttempts: 2,
    });
  });
});
