import { describe, it, expect, vi } from "vitest";
import type { IAgentRuntime, Memory, UUID } from "@elizaos/core";
import type { PlayerStatement } from "../src/socialStrategy/types";
import { addFact } from "../src/socialStrategy/runtime/memory";
import { v4 as uuidv4 } from "uuid";
import { asUUID } from "@elizaos/core";

describe("addFact helper", () => {
  it("embeds and persists a fact memory based on a statement", async () => {
    // Mock runtime methods
    const addEmbeddingToMemory = vi.fn().mockImplementation(async (mem) => {
      return { ...mem, embedding: [0.1, 0.2, 0.3] };
    });
    const createMemory = vi.fn().mockResolvedValue("fact-id");
    const agentId = asUUID(uuidv4());
    const runtime = {
      agentId,
      addEmbeddingToMemory,
      createMemory,
    } as unknown as IAgentRuntime;

    // Create a dummy statement
    const speakerId = asUUID(uuidv4());
    const targetId = asUUID(uuidv4());
    const statementId = asUUID(uuidv4());
    const roomId = asUUID(uuidv4());
    const worldId = asUUID(uuidv4());
    const statement: PlayerStatement = {
      id: statementId,
      agentId,
      createdAt: Date.now(),
      data: {
        content: "Test statement content",
        speakerEntityId: speakerId,
        targetEntityId: targetId,
        timestamp: Date.now(),
        sentiment: "positive",
        confidence: 0.9,
        trustScore: 75,
      },
      type: "social-strategy-statement",
      entityId: speakerId,
      roomId: roomId,
      worldId: worldId,
      sourceEntityId: targetId,
    };

    const message = { roomId: roomId } as unknown as Memory;

    await addFact({ runtime, statement, message });

    // Should call addEmbeddingToMemory once
    expect(addEmbeddingToMemory).toHaveBeenCalledTimes(1);
    const factArg = addEmbeddingToMemory.mock.calls[0][0] as Memory;
    // The fact's content should match the statement content
    expect(factArg.content.text).toBe(statement.data.content);
    // Should persist with createMemory to facts table
    expect(createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: [0.1, 0.2, 0.3] }),
      "facts",
      true,
    );
  });
});
