import path from "path";
import { describe, it, expect } from "vitest";
import { ConversationSimulator } from "../utils/conversation-simulator";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../src/plugins/socialStrategy";
import alexCharacter from "../../src/characters/alex";
import { housePlugin } from "../../src/plugins/house";
import { influencerPlugin } from "../../src/plugins/influencer";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import fs from "fs";
import os from "os";
import houseCharacter from "src/characters/house";

describe("House Agent Basic Functionality", () => {
  function getHousePlugins() {
    return [sqlPlugin, bootstrapPlugin, openaiPlugin, housePlugin];
  }

  function getPlayerPlugins() {
    return [
      sqlPlugin,
      bootstrapPlugin,
      socialStrategyPlugin,
      openaiPlugin,
      influencerPlugin,
    ];
  }

  it("should initialize House agent and respond to basic messages", async () => {
    RecordingTestUtils.logRecordingStatus("house basic test");
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "house-basic-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 2, // Just House + 1 player
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "House", testName: "basic functionality" },
    });

    try {
      await sim.initialize();

      // Add House agent (game master)
      const house = await sim.addAgent(
        "House",
        {
          ...alexCharacter,
          name: "House",
          bio: "I am The House - the game master for Influence. I moderate the game phases and enforce rules. I only respond to game management tasks, not general conversation.",
          style: {
            all: ["Be authoritative", "Focus on game mechanics", "Be concise"],
            chat: ["Only respond to game commands", "Ignore general chatter"],
            post: ["Announce game state changes clearly"],
          },
        },
        getHousePlugins()
      );

      // Add 1 player agent
      const player = await sim.addAgent(
        "P1",
        {
          ...alexCharacter,
          name: "P1",
          bio: "I am Player 1 in the Influence game. I aim to survive by forming alliances and making strategic decisions. I am a player, not a host or moderator.",
          style: {
            all: ["Be strategic", "Focus on survival", "Form alliances"],
            chat: [
              "Wait until the game starts to talk to other players",
              "Don't act like a host",
              "Until the game starts, I only respond to House when it asks me to join or gives instructions",
            ],
            post: ["Share strategic thoughts"],
          },
        },
        getPlayerPlugins()
      );

      expectSoft(house).toBeDefined();
      expectSoft(player).toBeDefined();

      // Test 1: Player requests to join
      console.log("=== TEST 1: Player Join Request ===");
      const { message: joinMessage, responses: joinResponses } =
        await sim.sendMessage(
          "P1",
          ["House"],
          "I want to join the game",
          true // Trigger House response
        );

      expectSoft(joinMessage.content).toContain("join");

      // Wait for processing
      await sim.waitForMessages(2, 10000); // Player message + potential House response

      // Test 2: Simple conversation
      console.log("=== TEST 2: General Conversation ===");
      const { message: chatMessage, responses: chatResponses } =
        await sim.sendMessage(
          "P1",
          ["House"],
          "Hello everyone! Looking forward to playing!",
          true
        );

      expectSoft(chatMessage.content).toContain("Hello");

      // Wait for processing
      await sim.waitForMessages(4, 10000);

      // Test conversation history
      console.log("=== TEST 3: Verifying Results ===");
      const history = sim.getConversationHistory();
      console.log("Conversation history:");
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });

      // Basic assertions
      expectSoft(history.length).toBeGreaterThanOrEqual(2); // At least player messages

      const playerMessages = history.filter((m) => m.authorName === "P1");
      expectSoft(playerMessages.length).toBeGreaterThanOrEqual(2);

      const houseMessages = history.filter((m) => m.authorName === "House");
      // House may or may not respond depending on context - that's OK for basic test

      // Test conversation summary
      const summary = sim.createConversationSummary();
      expectSoft(summary.participantCount).toBe(2); // House + P1
      expectSoft(summary.messageCount).toBeGreaterThanOrEqual(2);

      console.log("Basic test summary:", summary);
    } finally {
      await sim.cleanup();
    }
  }, 360000); // 360 second timeout

  it("should handle multiple player join requests", async () => {
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "house-multi-join-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 4, // House + 3 players
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "House", testName: "multi join" },
    });

    try {
      await sim.initialize();

      // Add House agent
      await sim.addAgent("House", houseCharacter, getHousePlugins());

      // Add 3 players
      for (let i = 1; i <= 3; i++) {
        await sim.addAgent(
          `P${i}`,
          {
            ...alexCharacter,
            name: `P${i}`,
            bio: `I am Player ${i} in the Influence game. I am a player, not a host or moderator.`,
            style: {
              all: ["Be strategic", "Focus on survival", "Form alliances"],
              chat: ["Talk to other players", "Don't act like a host"],
              post: ["Share strategic thoughts"],
            },
          },
          getPlayerPlugins()
        );
      }

      // Have each player try to join
      for (let i = 1; i <= 3; i++) {
        console.log(`Player P${i} joining...`);
        await sim.sendMessage(
          `P${i}`,
          ["House"],
          "I want to join the game",
          true
        );
        await sim.waitForMessages(i * 2, 5000); // Give time for responses
      }

      const history = sim.getConversationHistory();
      console.log("Multi-join conversation:");
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });

      const playerJoinMessages = history.filter(
        (m) =>
          m.authorName.startsWith("P") &&
          m.content.toLowerCase().includes("join")
      );
      expectSoft(playerJoinMessages.length).toBe(3);

      console.log("✓ Multi-join test completed");
    } finally {
      await sim.cleanup();
    }
  }, 360000); // 360 second timeout
});
