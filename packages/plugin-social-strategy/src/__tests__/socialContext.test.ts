import { describe, it, expect, vi } from "vitest";
import { socialStrategyPlugin } from "../socialStrategy/index";
import type { IAgentRuntime, Memory } from "@elizaos/core";
import { MemoryType } from "@elizaos/core";

describe("social-context provider", () => {
  const provider = socialStrategyPlugin.providers!.find(
    (p: any) => p.name === "social-context"
  );

  it("should be defined", () => {
    expect(provider).toBeDefined();
  });

  it("returns empty context when no memory is found", async () => {
    const runtime = {
      agentId: "agent1",
      getMemoriesByIds: vi.fn().mockResolvedValue([]),
    } as unknown as IAgentRuntime;
    const message = {} as Memory;

    const result = await (provider as any).get(runtime, message);
    expect(result).toEqual({
      text: "",
      values: {
        players: [],
        relationships: [],
        statements: [],
      },
    });
  });
});
