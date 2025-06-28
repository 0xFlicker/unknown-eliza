import { describe, it, expect, vi, beforeEach } from "vitest";
import { socialStrategyPlugin } from "../../../src/socialStrategy/index";
import { resetAnalysisCache } from "../../../src/socialStrategy/providers/socialContext";
import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import { MemoryType } from "@elizaos/core";

// Clear analysis caches between tests
beforeEach(() => {
  resetAnalysisCache();
});

describe("social-context provider", () => {
  const provider = socialStrategyPlugin.providers!.find(
    (p: any) => p.name === "SOCIAL_CONTEXT",
  );

  it("should be defined", () => {
    expect(provider).toBeDefined();
  });

  it("returns empty context when no memory is found", async () => {
    const runtime = {
      agentId: "agent1",
      getMemoriesByIds: vi.fn().mockResolvedValue([]),
      getEntityById: vi.fn().mockResolvedValue(null),
      createEntity: vi.fn().mockResolvedValue(null),
      getCache: vi.fn().mockResolvedValue(undefined),
      setCache: vi.fn().mockResolvedValue(true),
    } as unknown as IAgentRuntime;
    const message = {} as Memory;

    const result = await (provider as any).get(runtime, message);
    expect(result).toEqual({
      text: "",
      values: expect.objectContaining({
        players: expect.any(Object),
        relationships: expect.any(Array),
        statements: expect.any(Array),
      }),
    });
  });

  it("caches analysis results and avoids duplicate model calls", async () => {
    const useModel = vi.fn().mockResolvedValue("[]");
    const runtime = {
      agentId: "agent1",
      getParticipantsForRoom: vi.fn().mockResolvedValue([]),
      getEntityById: vi.fn().mockResolvedValue(null),
      createEntity: vi.fn().mockResolvedValue(true),
      getRelationships: vi.fn().mockResolvedValue([]),
      getComponents: vi.fn().mockResolvedValue([]),
      getCache: vi.fn().mockResolvedValue(undefined),
      setCache: vi.fn().mockResolvedValue(true),
      useModel,
    } as unknown as IAgentRuntime;

    const message = {
      id: "msg1",
      roomId: "room1",
      entityId: "entity1",
      content: { text: "@Alice hi" },
      metadata: {},
    } as unknown as Memory;

    const provider = socialStrategyPlugin.providers!.find(
      (p: any) => p.name === "SOCIAL_CONTEXT",
    ) as Provider;

    // Provide an empty initial state
    const initialState = { values: {}, data: {}, text: "" } as State;
    // First call should trigger useModel once
    await provider.get(runtime, message, initialState);
    // Second call with same message should use cached result
    await provider.get(runtime, message, initialState);

    expect(useModel).toHaveBeenCalledTimes(1);
  });

  it("expires cache after TTL and retries analysis", async () => {
    vi.useFakeTimers();
    const useModel = vi.fn().mockResolvedValue("[]");
    const runtime = {
      agentId: "agent1",
      getParticipantsForRoom: vi.fn().mockResolvedValue([]),
      getEntityById: vi.fn().mockResolvedValue(null),
      createEntity: vi.fn().mockResolvedValue(true),
      getRelationships: vi.fn().mockResolvedValue([]),
      getComponents: vi.fn().mockResolvedValue([]),
      getCache: vi.fn().mockResolvedValue(undefined),
      setCache: vi.fn().mockResolvedValue(true),
      useModel,
    } as unknown as IAgentRuntime;

    const message = {
      id: "msg1",
      roomId: "room1",
      entityId: "entity1",
      content: { text: "@Alice hi" },
      metadata: {},
    } as unknown as Memory;

    const provider = socialStrategyPlugin.providers!.find(
      (p: any) => p.name === "SOCIAL_CONTEXT",
    ) as Provider;
    const initialState = { values: {}, data: {}, text: "" } as State;

    // Initial call uses model
    await provider.get(runtime, message, initialState);
    expect(useModel).toHaveBeenCalledTimes(1);

    // Advance time beyond TTL (60_000ms)
    vi.setSystemTime(Date.now() + 60_001);
    await provider.get(runtime, message, initialState);
    expect(useModel).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
