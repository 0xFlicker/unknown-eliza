import { character } from "../src/index.ts";
import { v4 as uuidv4 } from "uuid";
import {
  trackConversationHandler,
  getPlayerInfoHandler,
  socialStrategyPlugin,
} from "@0xflicker/plugin-social-strategy";
import { ChannelType } from "@elizaos/core";
import { ConversationSimulator } from "./ConversationSimulator";

// Minimal TestSuite definition expected by ElizaOS E2E runner
interface TestSuite {
  name: string;
  description: string;
  tests: Array<{
    name: string;
    fn: (runtime: any) => Promise<any>;
  }>;
}

export class StarterTestSuite implements TestSuite {
  name = "starter";
  description = "E2E tests for the starter project (social-strategy plugin)";

  tests = [
    // ------------------------------------------------------------------
    // 1. Basic character definition sanity check (unchanged)
    // ------------------------------------------------------------------
    {
      name: "Character configuration test",
      fn: async () => {
        const requiredFields = [
          "name",
          "bio",
          "plugins",
          "system",
          "messageExamples",
        ];
        const missing = requiredFields.filter((f) => !(f in character));
        if (missing.length) {
          throw new Error(`Missing required fields: ${missing.join(", ")}`);
        }
        if (!Array.isArray(character.plugins))
          throw new Error("Character plugins should be an array");
        if (!character.system) throw new Error("System prompt is required");
        if (!Array.isArray(character.bio))
          throw new Error("Character bio should be an array");
        if (!Array.isArray(character.messageExamples))
          throw new Error("Character messageExamples should be an array");
      },
    },

    // ------------------------------------------------------------------
    // 2. Track a simple mention using ConversationSimulator + action handler
    // ------------------------------------------------------------------
    {
      name: "Agent conversation and memory update (ConversationSimulator)",
      fn: async (runtime: any) => {
        const sim = new ConversationSimulator(runtime);
        // Build minimal room & participant
        const other = await sim.createUser({ name: "OtherPlayer" });
        const room = await sim.getOrCreateRoom({
          name: "test-room",
          type: ChannelType.GROUP,
        });

        // Send a message that mentions @TestPlayer
        const memory = await sim.sendMessage(
          other,
          "@TestPlayer has shown me that they can be trusted",
          room
        );

        // Call the social-strategy action handler so it can update state
        const sharedState: any = {};
        const result = (await trackConversationHandler(
          runtime,
          memory,
          sharedState
        )) as {
          success: boolean;
          data: {
            players: Record<string, any>;
            statements: any[];
          };
        };

        if (!result.success) throw new Error("trackConversation failed");
        const players = Object.values(result.data.players);
        if (!players.length) throw new Error("No players detected");
        const testPlayer = players.find((p: any) => p.handle === "TestPlayer");
        if (!testPlayer) throw new Error("TestPlayer not created");
      },
    },

    // ------------------------------------------------------------------
    // 3. Validate getPlayerInfo action + provider using simulated chat
    // ------------------------------------------------------------------
    {
      name: "Social-context provider and getPlayerInfo action validation",
      fn: async (runtime: any) => {
        const sim = new ConversationSimulator(runtime);
        const speaker = await sim.createUser({ name: "Narrator" });
        const room = await sim.getOrCreateRoom({
          name: "round-chat",
          type: ChannelType.GROUP,
        });

        // Message creating relationship
        const memory = await sim.sendMessage(
          speaker,
          "@TestPlayer just saved me from elimination, we should keep them around!",
          room
        );

        // Build state via handler so provider/action can consume it
        const sharedState: any = {};
        const convoResult = await trackConversationHandler(
          runtime,
          memory,
          sharedState
        );
        if (!convoResult.success)
          throw new Error("Conversation tracking failed");

        // Extract TestPlayer ID
        const testEntry = Object.entries(
          (convoResult.data as any).players
        ).find(([, p]: [string, any]) => p.handle === "TestPlayer");
        if (!testEntry) throw new Error("TestPlayer not found after convo");
        const [testPlayerId] = testEntry as [string, any];

        // ----- Validate getPlayerInfo action -----
        const getInfoMessage: any = {
          id: uuidv4(),
          entityId: speaker.id,
          roomId: room.id,
          content: { playerId: testPlayerId },
        };
        const playerInfo = await getPlayerInfoHandler(runtime, getInfoMessage, {
          socialStrategyState: convoResult.data,
        } as any);
        if (!playerInfo.success) throw new Error("getPlayerInfo failed");
        if (playerInfo.data?.player.handle !== "TestPlayer")
          throw new Error("getPlayerInfo returned wrong player");

        // ----- Validate provider -----
        const provider = socialStrategyPlugin.providers?.find(
          (p) => p.name === "social-context"
        );
        if (!provider) throw new Error("social-context provider missing");

        const providerMessage: any = {
          id: uuidv4(),
          entityId: speaker.id,
          roomId: room.id,
          content: { text: "Requesting social context" },
        };

        const providerResult = await provider.get(runtime, providerMessage, {
          socialStrategyState: convoResult.data,
        } as any);

        if (!providerResult.values?.socialContext)
          throw new Error("socialContext missing from provider output");

        // JSON validity & keys
        const ctx = JSON.parse(providerResult.values.socialContext);
        for (const key of ["players", "relationships", "recentStatements"]) {
          if (!(key in ctx)) throw new Error(`socialContext missing ${key}`);
        }
      },
    },
  ];
}

export default new StarterTestSuite();
