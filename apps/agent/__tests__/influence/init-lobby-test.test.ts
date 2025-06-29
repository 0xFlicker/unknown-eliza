import path from "path";
import { describe, it, expect } from "vitest";
import { ConversationSimulator } from "../utils/conversation-simulator";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../src/socialStrategy";
import alexCharacter from "../../src/characters/alex";
import houseCharacter from "../../src/characters/house";
import { housePlugin } from "../../src/house";
import { influencerPlugin } from "../../src/influencer";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import fs from "fs";
import os from "os";
import { start } from "repl";

describe("Influence Game INIT → LOBBY Flow", () => {
  function getTestPlugins() {
    const basePlugins = [
      sqlPlugin,
      bootstrapPlugin,
      socialStrategyPlugin,
      openaiPlugin,
    ];
    return basePlugins;
  }

  function getHousePlugins() {
    const basePlugins = [sqlPlugin, bootstrapPlugin, openaiPlugin]; // No socialStrategyPlugin for House
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
      const house = await sim.addAgent("House", houseCharacter, [
        ...getHousePlugins(),
      ]);

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
          [...getTestPlugins(), influencerPlugin]
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
          ["House"], // Send to House only
          "I want to join the game",
          true // Trigger House response
        );
        expectSoft(message.content).toContain("join");

        // Wait for House to respond
        const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
        const timeout = isRecordMode ? 5000 : 2000; // Shorter timeout in playback
        await sim.waitForMessages(i * 2 + 1, timeout); // Each join should produce 2 messages (player + house)
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay to simulate real-time interaction

        // // Debug: Inspect game state after each join
        // try {
        //   const gameState = await sim.inspectHouseGameState();
        //   console.log(`=== After P${i} joins - House State ===`);
        //   console.log(gameState);
        //   console.log(`=======================================`);
        // } catch (error) {
        //   console.log(
        //     `Failed to inspect game state after P${i} joins:`,
        //     error.message
        //   );
        // }
      }

      // Test Phase 2: Host starts the game
      console.log("=== PHASE 2: Starting Game ===");

      // Wait a little to ensure all joins are processed
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const { message: startMessage } = await sim.sendMessage(
        "P1", // First player is typically the host
        ["House"], // Send to House only
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
      expectSoft(summary.messageCount).toBeGreaterThanOrEqual(8);
      console.log("Init-Lobby test summary:", summary);

      // Check that the last house message has "INFLUENCE GAME STARTED!" in content
      const finalHouseMessage = history
        .filter((m) => m.authorName === "House")
        .slice(-1)[0];

      expectSoft(finalHouseMessage?.content).toContain("INFLUENCE");
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
      await sim.addAgent("House", houseCharacter, [
        ...getHousePlugins(),
        housePlugin,
      ]);

      // Add only 2 players (below minimum of 4)
      await sim.addAgent("P1", { ...alexCharacter, name: "P1" }, [
        ...getTestPlugins(),
        influencerPlugin,
      ]);
      await sim.addAgent("P2", { ...alexCharacter, name: "P2" }, [
        ...getTestPlugins(),
        influencerPlugin,
      ]);

      // Players join
      await sim.sendMessage("P1", ["House"], "I want to join the game", true);
      await sim.sendMessage("P2", ["House"], "I want to join the game", true);
      const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
      await sim.waitForMessages(7, isRecordMode ? 5000 : 2000);

      // Try to start with insufficient players
      await sim.sendMessage("P1", ["House"], "Let's start the game", true);
      await sim.waitForMessages(4, isRecordMode ? 5000 : 2000);

      const history = sim.getConversationHistory();
      console.log("Conversation history:");
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });
      const houseResponses = history.filter(
        (m) => m.authorName === "House" && m.content.includes("INFLUENCER")
      );

      // House should be silent
      expectSoft(houseResponses.length).toBe(0);
      console.log("✓ House correctly rejected start with insufficient players");
    } finally {
      await sim.cleanup();
    }
  }, 720000);
});
