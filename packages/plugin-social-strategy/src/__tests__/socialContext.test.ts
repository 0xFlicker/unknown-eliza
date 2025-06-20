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
      data: { socialContext: null },
      values: { socialContext: "" },
    });
  });

  it("returns correct context for a populated state", async () => {
    // Mock social strategy state
    const mockState = {
      players: {
        p1: {
          id: "p1",
          handle: "Alice",
          discriminator: "0001",
          trustScore: 70,
          relationship: "ally",
          lastSeen: 0,
          metadata: {},
        },
        p2: {
          id: "p2",
          handle: "Bob",
          discriminator: "0002",
          trustScore: 40,
          relationship: "rival",
          lastSeen: 0,
          metadata: {},
        },
      },
      relationships: [
        {
          sourceEntityId: "p1",
          targetEntityId: "p2",
          relationshipType: "ally",
          strength: 80,
          id: "r1",
          metadata: {},
        },
      ],
      statements: [
        {
          id: "s1",
          sourceEntityId: "p1",
          targetEntityId: "p2",
          content: "Hello Bob",
          statementType: "mention",
          sentiment: "neutral",
          confidence: 0.5,
          metadata: {},
        },
      ],
      metadata: { lastAnalysis: 0, version: "1.0.0" },
    };

    const runtime = {
      agentId: "agent1",
      getMemoriesByIds: vi.fn().mockResolvedValue([
        {
          metadata: { type: MemoryType.CUSTOM },
          content: { text: JSON.stringify(mockState) },
        },
      ]),
    } as unknown as IAgentRuntime;
    const message = {} as Memory;

    const result = await (provider as any).get(runtime, message);

    // Validate data structure
    expect(result.data.socialContext).toEqual({
      players: [
        { handle: "Alice", trustScore: 70 },
        { handle: "Bob", trustScore: 40 },
      ],
      relationships: [
        {
          source: "Alice",
          target: "Bob",
          relationshipType: "ally",
          strength: 80,
        },
      ],
      recentStatements: [
        { speaker: "Alice", target: "Bob", content: "Hello Bob" },
      ],
    });

    // Validate values and text
    const expectedString = JSON.stringify(result.data.socialContext);
    expect(result.values.socialContext).toBe(expectedString);
    expect(result.text).toBe(`Social Context: ${expectedString}`);
  });
});
