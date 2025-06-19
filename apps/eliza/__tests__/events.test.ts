import { describe, expect, it } from "vitest";
import { socialStrategyPlugin as plugin } from "@0xflicker/plugin-social-strategy";

describe("Plugin Events", () => {
  it("should not define any events", () => {
    expect(plugin.events).toBeUndefined();
  });
});
