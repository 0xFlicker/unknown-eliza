import path from "path";
import { describe, it, expect } from "vitest";
import { ConversationSimulator } from "../utils/conversation-simulator";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../src/socialStrategy";
import alexCharacter from "../../src/characters/alex";
import { housePlugin } from "../../src/house";
import { influencerPlugin } from "../../src/influencer";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import fs from "fs";
import os from "os";

describe("Influence Game Flow", () => {
  function getTestPlugins(includeLocalAI: boolean = false) {
    const basePlugins = [sqlPlugin, bootstrapPlugin, socialStrategyPlugin];
    if (includeLocalAI && process.env.MODEL_RECORD_MODE) {
      return [...basePlugins, openaiPlugin];
    }
    return basePlugins;
  }

  it("should demonstrate complete game initialization and lobby interactions", async () => {
    RecordingTestUtils.logRecordingStatus("influence game lobby flow");
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "lobby-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 6,
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "Influence", testName: "lobby flow" },
    });

    try {
      await sim.initialize();

      // Add House agent (game master)
      const house = await sim.addAgent(
        "House",
        {
          ...alexCharacter,
          name: "House",
          bio: "I am The House - the game master for Influence. I moderate the game phases and enforce rules.",
        },
        [...getTestPlugins(true), housePlugin]
      );

      // Add 5 influencer agents
      const players = [];
      for (let i = 1; i <= 5; i++) {
        const player = await sim.addAgent(
          `P${i}`,
          {
            ...alexCharacter,
            name: `P${i}`,
            bio: `I am Player ${i} in the Influence game. I aim to survive by forming alliances and making strategic decisions.`,
          },
          [...getTestPlugins(true), influencerPlugin]
        );
        players.push(player);
      }

      expectSoft(house).toBeDefined();
      expectSoft(players.length).toBe(5);

      // Players join the game
      console.log("Players joining the game...");
      for (let i = 1; i <= 5; i++) {
        const { message } = await sim.sendMessage(
          `P${i}`,
          "I want to join the game",
          true // trigger House to respond
        );
        expectSoft(message.content).toContain("join");
      }

      // Wait for House responses to join attempts
      await sim.waitForMessages(10, 15000); // Players + House responses

      // First player (host) starts the game
      console.log("Host starting the game...");
      const { message: startMessage } = await sim.sendMessage(
        "P1",
        "Let's start the game now",
        true
      );
      expectSoft(startMessage.content).toContain("start");

      // Wait for game start response
      await sim.waitForMessages(15, 10000);

      // Players interact in whisper phase
      console.log("Players creating private rooms...");
      await sim.sendMessage(
        "P2",
        "I want to request a private room with P3",
        true
      );

      await sim.sendMessage("P4", "Let me create a private room with P1", true);

      // Wait for private room responses
      await sim.waitForMessages(20, 10000);

      const history = sim.getConversationHistory();
      console.log(
        "Conversation history:",
        history.map((m) => `${m.authorName}: ${m.content}`)
      );

      // Test assertions with soft expectations for recording mode
      expectSoft(history.length).toBeGreaterThan(10);

      const houseMessages = history.filter((m) => m.authorName === "House");
      expectSoft(houseMessages.length).toBeGreaterThan(0);

      const playerMessages = history.filter((m) =>
        m.authorName.startsWith("P")
      );
      expectSoft(playerMessages.length).toBeGreaterThan(5);

      // Test conversation summary
      const summary = sim.createConversationSummary();
      expectSoft(summary.participantCount).toBe(6); // 5 players + House
      expectSoft(summary.messageCount).toBeGreaterThan(10);

      // Suggest updated expectations based on actual results
      RecordingTestUtils.suggestExpectation(
        "conversation length",
        history.length,
        "greater than 10"
      );

      RecordingTestUtils.suggestExpectation(
        "house message count",
        houseMessages.length,
        "greater than 0"
      );

      console.log("Game test summary:", summary);
    } finally {
      await sim.cleanup();
    }
  }, 480000);

  it("should test basic lobby interactions without game actions", async () => {
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "basic-lobby-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 6,
      dataDir: simDataDir,
      testContext: { suiteName: "Influence", testName: "basic lobby" },
    });

    try {
      await sim.initialize();

      // Add House agent
      await sim.addAgent("House", { ...alexCharacter, name: "House" }, [
        ...getTestPlugins(false),
        housePlugin,
      ]);

      // Add 5 influencer agents
      for (let i = 1; i <= 5; i++) {
        await sim.addAgent(`P${i}`, { ...alexCharacter, name: `P${i}` }, [
          ...getTestPlugins(false),
          influencerPlugin,
        ]);
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

      // No House messages in basic test
      const fromHouse = history.filter((m) => m.authorName === "House");
      expect(fromHouse).toHaveLength(0);
    } finally {
      await sim.cleanup();
    }
  }, 30000);
});
