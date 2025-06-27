import path from "path";
import { describe, it, expect } from "vitest";
import { ConversationSimulator } from "../utils/conversation-simulator";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import { socialStrategyPlugin } from "../../src/socialStrategy";
import alexCharacter from "../../src/characters/alex";
import { housePlugin } from "../../src/house";
import { influencerPlugin } from "../../src/influencer";

describe("Influence Lobby Phase", () => {
  it(
    "should allow house and 5 players to join lobby and each send 3 messages",
    async () => {
    const sim = new ConversationSimulator({
      agentCount: 6,
      dataDir: path.join(__dirname, "lobby-test-data"),
      testContext: { suiteName: "Influence", testName: "lobby flow" },
    });
    try {
      await sim.initialize();

      // Add House agent
      await sim.addAgent(
        "House",
        { ...alexCharacter, name: "House" },
        [sqlPlugin, bootstrapPlugin, socialStrategyPlugin, housePlugin]
      );

      // Add 5 influencer agents
      for (let i = 1; i <= 5; i++) {
        await sim.addAgent(
          `P${i}`,
          { ...alexCharacter, name: `P${i}` },
          [sqlPlugin, bootstrapPlugin, socialStrategyPlugin, influencerPlugin]
        );
      }

      // Each player posts 3 lobby chat messages
      for (let i = 1; i <= 5; i++) {
        for (let j = 1; j <= 3; j++) {
          await sim.sendMessage(`P${i}`, `Hello from P${i} (${j})`, false);
        }
      }

      const history = sim.getConversationHistory();
      // Expect exactly 5 * 3 messages in history
      expect(history.length).toBe(15);

      // No House messages yet
      const fromHouse = history.filter((m) => m.authorName === "House");
      expect(fromHouse).toHaveLength(0);
    } finally {
      await sim.cleanup();
    }
  }, { timeout: 30000 });
});