import { character } from "../src/index.ts";
import { v4 as uuidv4 } from "uuid";
import { type UUID, type Memory, MemoryType } from "@elizaos/core";
import { trackConversation } from "@0xflicker/plugin-social-strategy";

// Define a minimal TestSuite interface that matches what's needed
interface TestSuite {
  name: string;
  description: string;
  tests: Array<{
    name: string;
    fn: (runtime: any) => Promise<any>;
  }>;
}

// Define minimal interfaces for the types we need
interface State {
  values: Record<string, unknown>;
  data: Record<string, unknown>;
  text: string;
}

interface Content {
  text: string;
  source?: string;
  actions?: string[];
}

interface HandlerResult {
  success: boolean;
  data: {
    players: Record<UUID, unknown>;
    relationships: unknown[];
    statements: unknown[];
    [key: string]: unknown;
  };
}

export class ProjectTestSuite implements TestSuite {
  name = "project";
  description = "E2E tests for project-specific features";

  tests = [
    {
      name: "Project runtime environment test",
      fn: async (runtime: any) => {
        // Test that the project's runtime environment is set up correctly
        try {
          // Verify character is loaded
          if (!runtime.character) {
            throw new Error("Character not loaded in runtime");
          }

          // Verify expected character properties
          const character = runtime.character;
          if (!character.name) {
            throw new Error("Character name is missing");
          }

          // No need to return anything - assertions above will throw on failure
        } catch (error) {
          throw new Error(
            `Project runtime environment test failed: ${error.message}`
          );
        }
      },
    },
    {
      name: "Agent conversation and memory update (local Ollama model)",
      fn: async (runtime: any) => {
        // Create a message from player2 mentioning player1
        const testRoomId = uuidv4() as UUID;
        const otherPlayerId = uuidv4() as UUID;

        const testMessage = {
          id: uuidv4() as UUID,
          entityId: otherPlayerId,
          roomId: testRoomId,
          content: {
            text: "Great move, @TestPlayer!", // Mentions player1 by handle
          },
          metadata: {
            type: MemoryType.CUSTOM,
            entityName: "OtherPlayer",
            source: "test",
            username: "OtherPlayer",
            discriminator: "1234",
          },
        };

        // Initial empty state
        const initialState = {
          players: {},
          relationships: [],
          statements: [],
          metadata: {
            lastAnalysis: Date.now(),
            version: "1.0.0",
          },
          values: {},
          data: {},
          text: "",
        };

        // Call the trackConversation action
        const result = (await trackConversation.handler(
          runtime,
          testMessage,
          initialState
        )) as HandlerResult;

        // Check result structure
        if (!result.success) {
          throw new Error("Agent did not process conversation as expected");
        }

        // Check that a player and statement were created
        const players = result.data.players;
        const statements = result.data.statements;
        if (!players || Object.keys(players).length === 0) {
          throw new Error("No players were created in agent state");
        }
        if (!statements || statements.length === 0) {
          throw new Error("No statements were created in agent state");
        }

        // Verify that the TestPlayer was created
        const createdTestPlayer = Object.values(players).find(
          (p: any) => p.handle === "TestPlayer"
        );
        if (!createdTestPlayer) {
          throw new Error("TestPlayer was not created in agent state");
        }

        console.log(
          "✅ Agent conversation test passed - players and statements created successfully"
        );
      },
    },
  ];
}

// Export a default instance of the test suite for the E2E test runner
export default new ProjectTestSuite();
