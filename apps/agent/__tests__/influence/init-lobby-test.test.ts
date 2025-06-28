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
import { start } from "repl";

describe("Influence Game INIT → LOBBY Flow", () => {
  function getTestPlugins(includeLocalAI: boolean = false) {
    const basePlugins = [sqlPlugin, bootstrapPlugin, socialStrategyPlugin];
    if (includeLocalAI) {
      // Always include OpenAI plugin when requested to ensure consistent embedding dimensions
      // between record and playback modes (mocking service will handle the calls)
      return [...basePlugins, openaiPlugin];
    }
    return basePlugins;
  }

  it("should handle 5 players joining and host starting game", async () => {
    RecordingTestUtils.logRecordingStatus("init lobby flow test");
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "init-lobby-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 6, // 5 players + house
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "Influence", testName: "init lobby flow" },
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

      // Test Phase 1: Players joining one by one
      console.log("=== PHASE 1: Players Joining ===");

      for (let i = 1; i <= 5; i++) {
        console.log(`Player P${i} joining...`);
        const { message } = await sim.sendMessage(
          `P${i}`,
          "I want to join the game",
          true // Trigger House response
        );
        expectSoft(message.content).toContain("join");

        // Wait for House to respond
        const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
        const timeout = isRecordMode ? 5000 : 2000; // Shorter timeout in playback
        await sim.waitForMessages(i * 2, timeout); // Each join should produce 2 messages (player + house)
      }

      // Test Phase 2: Host starts the game
      console.log("=== PHASE 2: Starting Game ===");

      const { message: startMessage } = await sim.sendMessage(
        "P1", // First player is typically the host
        "Let's start the game now",
        true
      );
      expectSoft(startMessage.content).toContain("start");

      // Wait for game start response
      const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
      const gameStartTimeout = isRecordMode ? 10000 : 3000; // Shorter timeout in playback
      await sim.waitForMessages(12, gameStartTimeout); // Should have 5 joins + 5 house responses + 1 start + 1 house response

      // Test Phase 3: Verify conversation history
      console.log("=== PHASE 3: Verifying Results ===");

      const history = sim.getConversationHistory();
      console.log("Conversation history:");
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });

      // Basic assertions with soft expectations for recording mode
      expectSoft(history.length).toBeGreaterThanOrEqual(6); // At least 5 joins + house responses

      const playerJoinMessages = history.filter(
        (m) =>
          m.authorName.startsWith("P") &&
          m.content.toLowerCase().includes("join")
      );
      expectSoft(playerJoinMessages.length).toBe(5);
      const startMessages = history.filter(
        (m) =>
          m.authorName.startsWith("P1") &&
          m.content.toLowerCase().includes("start")
      );
      expectSoft(startMessages.length).toBe(1);

      // Test conversation summary
      const summary = sim.createConversationSummary();
      expectSoft(summary.participantCount).toBe(6); // 5 players + House
      expectSoft(summary.messageCount).toBeGreaterThanOrEqual(10);
      console.log("Init-Lobby test summary:", summary);

      // Check that the last house message has "INFLUENCE GAME STARTED!" in content
      const finalHouseMessage = history
        .filter((m) => m.authorName === "House")
        .slice(-1)[0];

      expectSoft(finalHouseMessage?.content).toContain(
        "INFLUENCE GAME STARTED!"
      );
      console.log("✓ House successfully transitioned to LOBBY phase");
    } finally {
      await sim.cleanup();
    }
  }, 720000);

  it("should reject start attempts before minimum players", async () => {
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "min-players-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 3, // Only 2 players + house (below minimum)
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "Influence", testName: "min players test" },
    });

    try {
      await sim.initialize();

      // Add House agent
      await sim.addAgent("House", { ...alexCharacter, name: "House" }, [
        ...getTestPlugins(true),
        housePlugin,
      ]);

      // Add only 2 players (below minimum of 4)
      await sim.addAgent("P1", { ...alexCharacter, name: "P1" }, [
        ...getTestPlugins(true),
        influencerPlugin,
      ]);
      await sim.addAgent("P2", { ...alexCharacter, name: "P2" }, [
        ...getTestPlugins(true),
        influencerPlugin,
      ]);

      // Players join
      await sim.sendMessage("P1", "I want to join the game", true);
      await sim.sendMessage("P2", "I want to join the game", true);
      const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
      await sim.waitForMessages(7, isRecordMode ? 5000 : 2000);

      // Try to start with insufficient players
      await sim.sendMessage("P1", "Let's start the game", true);
      await sim.waitForMessages(10, isRecordMode ? 5000 : 2000);

      const history = sim.getConversationHistory();
      console.log("Conversation history:");
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });
      const houseResponses = history.filter((m) => m.authorName === "House");

      // Should have rejection message
      const rejectionResponse = houseResponses.some(
        (m) =>
          m.content.toLowerCase().includes("need") ||
          m.content.toLowerCase().includes("minimum") ||
          m.content.toLowerCase().includes("at least") ||
          m.content.toLowerCase().includes("wait for a few more to join")
      );
      // console.log(
      //   "House responses:",
      //   houseResponses.map((m) => `${m.authorName}: ${m.content}`)
      // );
      expectSoft(rejectionResponse).toBe(true);
      console.log("✓ House correctly rejected start with insufficient players");
    } finally {
      await sim.cleanup();
    }
  }, 720000);
});
