import { character } from "../src/index.ts";
import { v4 as uuidv4 } from "uuid";
import {
  trackConversation,
  socialStrategyPlugin,
  getPlayerInfoHandler,
} from "@0xflicker/plugin-social-strategy";
import { MemoryType } from "@elizaos/core";

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
type UUID = `${string}-${string}-${string}-${string}-${string}`;

interface Memory {
  entityId: UUID;
  roomId: UUID;
  content: {
    text: string;
    source: string;
    actions?: string[];
  };
}

interface State {
  values: Record<string, any>;
  data: Record<string, any>;
  text: string;
}

interface Content {
  text: string;
  source?: string;
  actions?: string[];
}

export class StarterTestSuite implements TestSuite {
  name = "starter";
  description = "E2E tests for the starter project";

  tests = [
    {
      name: "Character configuration test",
      fn: async (runtime: any) => {
        const requiredFields = [
          "name",
          "bio",
          "plugins",
          "system",
          "messageExamples",
        ];
        const missingFields = requiredFields.filter(
          (field) => !(field in character)
        );

        if (missingFields.length > 0) {
          throw new Error(
            `Missing required fields: ${missingFields.join(", ")}`
          );
        }

        if (!Array.isArray(character.plugins)) {
          throw new Error("Character plugins should be an array");
        }
        if (!character.system) {
          throw new Error("Character system prompt is required");
        }
        if (!Array.isArray(character.bio)) {
          throw new Error("Character bio should be an array");
        }
        if (!Array.isArray(character.messageExamples)) {
          throw new Error("Character message examples should be an array");
        }
      },
    },
    {
      name: "Agent conversation and memory update (local Ollama model)",
      fn: async (runtime: any) => {
        // Use the local UUID type for test UUIDs
        const testRoomId = uuidv4() as UUID;
        const otherPlayerId = uuidv4() as UUID;

        // Explicitly type as 'any' for test context
        const testMessage: any = {
          id: uuidv4() as UUID,
          entityId: otherPlayerId,
          roomId: testRoomId,
          content: {
            text: "@TestPlayer has shown me that they can be trusted",
          },
          metadata: {
            type: MemoryType.CUSTOM,
            entityName: "OtherPlayer",
            source: "test",
            username: "OtherPlayer",
            discriminator: "1234",
          },
        };

        const initialState: any = {
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

        // Cast result to expected type
        const result = (await trackConversation.handler(
          runtime,
          testMessage,
          initialState
        )) as {
          success: boolean;
          data: {
            players: Record<UUID, any>;
            relationships: any[];
            statements: any[];
            [key: string]: any;
          };
        };

        if (!result.success) {
          throw new Error("Agent did not process conversation as expected");
        }

        const players = result.data.players;
        const statements = result.data.statements;
        if (!players || Object.keys(players).length === 0) {
          throw new Error("No players were created in agent state");
        }
        if (!statements || statements.length === 0) {
          throw new Error("No statements were created in agent state");
        }

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
    {
      name: "Social-context provider and getPlayerInfo action validation",
      fn: async (runtime: any) => {
        // ---------------------------------------------
        // 1. Simulate a conversation to populate state
        // ---------------------------------------------
        const testRoomId = uuidv4() as UUID;
        const otherPlayerId = uuidv4() as UUID;

        const convoMessage: any = {
          id: uuidv4() as UUID,
          entityId: otherPlayerId,
          roomId: testRoomId,
          content: {
            text: "@TestPlayer just saved me from elimination, we should keep them around!",
          },
          metadata: {
            type: MemoryType.CUSTOM,
            entityName: "OtherPlayer",
            source: "test",
            username: "OtherPlayer",
            discriminator: "1234",
          },
        };

        const baseState: any = {
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

        // Run trackConversation to update state with TestPlayer
        const convoResult = (await trackConversation.handler(
          runtime,
          convoMessage,
          baseState
        )) as {
          success: boolean;
          data: {
            players: Record<UUID, any>;
            relationships: any[];
            statements: any[];
          };
        };

        if (!convoResult.success) {
          throw new Error("trackConversation failed during setup phase");
        }

        // Find TestPlayer ID from updated players
        const testPlayerEntry = (
          Object.entries(convoResult.data.players) as Array<[string, any]>
        ).find(([, p]) => p.handle === "TestPlayer");
        if (!testPlayerEntry) {
          throw new Error("TestPlayer entity was not created as expected");
        }
        const [testPlayerId] = testPlayerEntry as [string, any];

        // ---------------------------------------------------------
        // 2. Validate getPlayerInfo action
        // ---------------------------------------------------------
        // Locate the getPlayerInfo action from the plugin definition
        const getPlayerInfoMessage: any = {
          id: uuidv4() as UUID,
          entityId: otherPlayerId,
          roomId: testRoomId,
          content: {
            playerId: testPlayerId,
          },
        };

        // The getPlayerInfo handler expects the social strategy state to be nested under `socialStrategyState`
        const nestedState = {
          socialStrategyState: convoResult.data,
          values: {},
          data: {},
          text: "",
        };

        const playerInfoResult = await getPlayerInfoHandler(
          runtime,
          getPlayerInfoMessage,
          nestedState
        );

        console.log("playerInfoResult", playerInfoResult);

        if (!playerInfoResult.success) {
          throw new Error("getPlayerInfo action returned unsuccessful result");
        }
        if (playerInfoResult.data?.player.handle !== "TestPlayer") {
          throw new Error(
            `getPlayerInfo returned wrong player handle: ${playerInfoResult.data?.player.handle}`
          );
        }

        // ---------------------------------------------------------
        // 3. Validate social-context provider
        // ---------------------------------------------------------
        const socialContextProvider = socialStrategyPlugin.providers?.find(
          (p: any) => p.name === "social-context"
        );
        if (!socialContextProvider) {
          throw new Error("social-context provider not found in plugin");
        }

        const providerMessage = {
          id: uuidv4() as UUID,
          entityId: otherPlayerId,
          roomId: testRoomId,
          content: {
            text: "Requesting social context",
          },
        };

        const providerResult = await socialContextProvider.get(
          runtime,
          providerMessage,
          baseState
        );

        console.log("providerResult", providerResult);

        if (!providerResult || !providerResult.values?.socialContext) {
          throw new Error("Provider did not return socialContext value");
        }

        // Ensure socialContext is valid JSON with required keys
        let parsedContext: any;
        try {
          parsedContext = JSON.parse(providerResult.values.socialContext);
        } catch {
          throw new Error("socialContext value is not valid JSON");
        }

        const requiredKeys = ["players", "relationships", "recentStatements"];
        for (const key of requiredKeys) {
          if (!(key in parsedContext)) {
            throw new Error(`socialContext JSON missing required key: ${key}`);
          }
        }

        console.log(
          "✅ social-context provider and getPlayerInfo action validated successfully"
        );
      },
    },
  ];
}

// Export a default instance of the test suite for the E2E test runner
export default new StarterTestSuite();
