import { describe, it, expect } from "vitest";
import { socialStrategyPlugin } from "../socialStrategy/index";

describe("Social Strategy Plugin", () => {
  it("should export the plugin correctly", () => {
    expect(socialStrategyPlugin).toBeDefined();
    expect(socialStrategyPlugin.name).toBe("social-strategy");
    expect(socialStrategyPlugin.description).toBe(
      "Tracks and manages player relationships and trust scores for social strategy analysis"
    );
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
