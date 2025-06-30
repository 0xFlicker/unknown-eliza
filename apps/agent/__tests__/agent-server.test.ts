import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { ChannelType } from "@elizaos/core";
import path from "path";
import os from "os";
import fs from "fs";
import alexCharacter from "../src/characters/alex";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import { socialStrategyPlugin } from "../src/socialStrategy/index";
import { killProcessOnPort } from "./utils/process-utils";
import { TEST_TIMEOUTS } from "./utils/test-timeouts";
import { ConversationSimulatorV3 } from "./utils/conversation-simulator-v3";
import { expectSoft, RecordingTestUtils } from "./utils/recording-test-utils";

describe("AgentServer V3 Integration", () => {
  let dataDir: string;
  let testServerPort: number;

  // Utility function to create test-safe plugin arrays
  function getTestPlugins() {
    const basePlugins = [sqlPlugin, bootstrapPlugin, openaiPlugin];

    return basePlugins;
  }

  beforeAll(async () => {
    testServerPort = 3200; // Use different port from other tests
    await killProcessOnPort(testServerPort);
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_TIMEOUTS.SHORT_WAIT)
    );
    dataDir = path.join(os.tmpdir(), `eliza-test-v3-${Date.now()}`);
    fs.mkdirSync(dataDir, { recursive: true });

    const testEnv = dotenv.config({
      path: path.join(__dirname, "../../.env.test"),
    });
  });

  afterAll(async () => {
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("demonstrates 2 agents having a basic conversation through AgentServer infrastructure", async () => {
    RecordingTestUtils.logRecordingStatus(
      "2 agents conversation via AgentServer"
    );

    const simulator = new ConversationSimulatorV3({
      dataDir,
      serverPort: testServerPort,
      enableRealTime: true,
      useModelMockingService: true,
      testContext: {
        suiteName: "AgentServer V3 Integration",
        testName:
          "demonstrates 2 agents having a basic conversation through AgentServer infrastructure",
      },
    });

    try {
      // Initialize the V3 simulator with real AgentServer infrastructure
      await simulator.initialize();
      console.log(
        "✅ V3 Simulator initialized with AgentServer infrastructure"
      );

      // Add two agents that will chat with each other
      const alice = await simulator.addAgent(
        "Alice",
        {
          ...alexCharacter,
          name: "Alice",
          bio: "Alice is a friendly and thoughtful agent who enjoys collaborative conversations and building relationships.",
        },
        getTestPlugins() // Include openai for record mode
      );

      const bob = await simulator.addAgent(
        "Bob",
        {
          ...alexCharacter,
          name: "Bob",
          bio: "Bob is friendly and talkative, but is also an analytical and strategic agent who likes to discuss plans and share insights.",
        },
        getTestPlugins() // Include openai for record mode
      );

      expect(alice).toBeDefined();
      expect(bob).toBeDefined();
      expect(simulator.getAgentNames()).toEqual(["Alice", "Bob"]);
      console.log("✅ Added Alice and Bob agents");

      // Create a conversation channel using AgentServer infrastructure
      const channelId = await simulator.createChannel({
        name: "general-chat",
        participants: ["Alice", "Bob"],
        type: ChannelType.DM,
        maxMessages: 6, // Limit conversation length for testing
      });

      expect(channelId).toBeDefined();
      console.log(`✅ Created channel: ${channelId}`);

      // Set up real-time observation of the conversation
      const conversationLog: string[] = [];
      const unsubscribe = simulator.observeChannel(channelId, (message) => {
        const logEntry = `${message.authorName}: ${message.content}`;
        conversationLog.push(logEntry);
        console.log(`📝 ${logEntry}`);
      });

      // Alice starts the conversation
      console.log("🚀 Alice starting conversation...");
      await simulator.sendMessage(
        "Alice",
        channelId,
        "Hey Bob! Nice to meet you. How are you doing today?"
      );

      // Wait a moment for messages to be processed
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Get the final conversation
      const messages = simulator.getChannelMessages(channelId);
      console.log("\n📊 Final conversation summary:");
      console.log(`Total messages: ${messages.length}`);
      messages.forEach((msg, idx) => {
        console.log(`${idx + 1}. ${msg.authorName}: ${msg.content}`);
      });

      // Verify the conversation worked through AgentServer
      expectSoft(messages.length).toBeGreaterThan(1); // At least Alice's message + Bob's response + something else
      expectSoft(messages[0]?.authorName).toBe("Alice");
      expectSoft(messages[0]?.content).toBe(
        "Hey Bob! Nice to meet you. How are you doing today?"
      );

      // Verify Bob responded
      if (messages.length > 1) {
        expectSoft(messages[1]?.authorName).toBe("Bob");
        expectSoft(messages[1]?.content?.length).toBeGreaterThan(0);
        console.log("✅ Bob responded to Alice");
      }

      // Test conversation summary
      const summary = simulator.createConversationSummary();
      expectSoft(summary.channelCount).toBe(1);
      expectSoft(summary.participantCount).toBe(2);
      expectSoft(summary.totalMessages).toBeGreaterThanOrEqual(2);
      expectSoft(summary.messagesByAgent["Alice"]).toBeGreaterThanOrEqual(1);
      expectSoft(summary.messagesByAgent["Bob"]).toBeGreaterThanOrEqual(1);

      console.log("\n📈 Conversation Summary:", {
        channels: summary.channelCount,
        participants: summary.participantCount,
        totalMessages: summary.totalMessages,
        messagesByAgent: summary.messagesByAgent,
        messagesByChannel: summary.messagesByChannel,
      });

      // Clean up observer
      unsubscribe();

      // Verify AgentServer infrastructure was used properly
      expect(simulator.getChannels().size).toBe(1);
      expect(Array.from(simulator.getChannels().values())[0].name).toBe(
        "general-chat"
      );

      console.log(
        "✅ Successfully demonstrated 2-agent conversation via AgentServer infrastructure"
      );

      // Provide recording suggestions for better test expectations
      RecordingTestUtils.suggestExpectation(
        "total messages in conversation",
        messages.length,
        "should be exactly 2 for Alice + Bob exchange"
      );
    } finally {
      await simulator.cleanup();
      console.log("🧹 Cleaned up V3 simulator");
    }
  }, 90000); // Allow plenty of time for real model interactions
});
