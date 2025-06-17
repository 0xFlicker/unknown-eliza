import { describe, expect, it } from "vitest";
import { socialStrategyPlugin as plugin } from "../src/plugin/socialStrategy";

describe("Plugin Events", () => {
  it("should not define any events", () => {
    expect(plugin.events).toBeUndefined();
  });
});
