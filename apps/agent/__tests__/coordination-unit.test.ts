import { describe, it, expect, vi } from "vitest";
import { CoordinationService } from "../src/coordinator/service";
import { createGameEventMessage } from "../src/coordinator/types";
import { GameEventType } from "../src/house/events/types";
import { stringToUuid } from "@elizaos/core";

// Mock runtime
const mockRuntime = {
  agentId: "test-agent-id",
  character: { name: "TestAgent" },
  getService: vi.fn(),
  createMemory: vi.fn(),
} as any;

// Mock AgentServer
const mockAgentServer = {
  createMessage: vi.fn(),
};

describe("Coordination Service Unit Tests", () => {
  it("should create coordination service", async () => {
    const service = new CoordinationService(mockRuntime);
    await service.initialize(mockRuntime);

    expect(service).toBeDefined();
    console.log("✅ CoordinationService can be created");
  });

  it("should use AgentServer when available", async () => {
    const service = new CoordinationService(mockRuntime);
    await service.initialize(mockRuntime);

    // Set AgentServer
    service.setAgentServer(mockAgentServer);
    service.setCoordinationChannelId(stringToUuid("test-channel-id"));

    // Mock the role check to return true
    vi.doMock("../src/coordinator/roles", () => ({
      canSendMessage: () => true,
    }));

    await service.sendGameEvent(GameEventType.I_AM_READY, {
      gameId: "game-123",
      playerId: "player-1",
      playerName: "Alpha",
    });

    // Verify AgentServer.createMessage was called
    expect(mockAgentServer.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "test-channel-id",
        authorId: "test-agent-id",
        sourceType: "coordination",
        metadata: expect.objectContaining({
          coordinationMessage: true,
          messageType: "game_event",
          gameEventType: GameEventType.I_AM_READY,
        }),
      })
    );

    console.log("✅ CoordinationService uses AgentServer when available");
  });
});
