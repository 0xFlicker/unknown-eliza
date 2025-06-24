import { v4 as uuidv4 } from "uuid";
import { type TestSuite, ChannelType, type State } from "@elizaos/core";
import {
  socialStrategyPlugin,
  SocialStrategyState,
} from "../../../src/socialStrategy/index";
import { ConversationSimulator } from "../../../e2e/ConversationSimulator";
import { ScenarioVerifier } from "../../../e2e/ScenarioVerifier";

// -----------------------------------------------------------------------------
// Trust-score update scenario (OtherPlayer praises @TestPlayer)
// -----------------------------------------------------------------------------

export const trustScenarioSuite: TestSuite = {
  name: "Social-Strategy trust adjustment",
  tests: [
    {
      name: "Positive mention increases trust & creates ally relationship",
      fn: async (runtime) => {
        // Ensure plugin registered
        if (!runtime.plugins.find((p) => p.name === "social-strategy")) {
          await runtime.registerPlugin(socialStrategyPlugin);
        }

        const simulator = new ConversationSimulator(runtime);

        const script = {
          name: "trust-update",
          description: "OtherPlayer compliments TestPlayer",
          room: { name: "trust-room", type: ChannelType.GROUP },
          participants: [{ name: "OtherPlayer" }, { name: "TestPlayer" }],
          steps: [
            {
              from: "OtherPlayer",
              content: "@TestPlayer has shown me that they can be trusted",
            },
          ],
        };

        // State container shared across onMessage handler
        const sharedState: State = { values: {}, data: {}, text: "" };

        await simulator.runConversation(script, async (memory) => {
          // Let the runtime invoke registered actions instead of calling handler directly
          await runtime.processActions(memory, [], sharedState);
        });

        await simulator.waitForEvaluators();

        const verifier = new ScenarioVerifier(runtime);

        const otherEntityId = simulator.getUser("OtherPlayer")!.entity.id!;

        // Find TestPlayer ID via socialState
        const socialState = sharedState as SocialStrategyState;
        const testPlayerEntry = Object.values(socialState.values.players).find(
          (p) => p.names.includes("TestPlayer")
        );
        if (!testPlayerEntry) throw new Error("TestPlayer not detected");

        const testPlayerId = testPlayerEntry.id;

        // Relationship verification via ScenarioVerifier
        await verifier.verifyRelationship(otherEntityId, testPlayerId, {
          exists: true,
          type: "ally",
        });
      },
    },
  ],
};

export default trustScenarioSuite;
