import { describe, it, expect } from "vitest";
import { socialStrategyPlugin } from "../../../src/socialStrategy/index";

describe("Social Strategy Plugin", () => {
  it("should export the plugin correctly", () => {
    expect(socialStrategyPlugin).toBeDefined();
    expect(socialStrategyPlugin.name).toBe("social-strategy");
  });

  it("should have actions defined", () => {
    expect(socialStrategyPlugin.actions).toBeDefined();
    expect(Array.isArray(socialStrategyPlugin.actions)).toBe(true);
  });

  it("should have providers defined", () => {
    expect(socialStrategyPlugin.providers).toBeDefined();
    expect(Array.isArray(socialStrategyPlugin.providers)).toBe(true);
  });
});
