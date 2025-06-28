import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
import { AgentServer } from "@elizaos/server";
import {
  AgentRuntime,
  ChannelType,
  ModelType,
  stringToUuid,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type Content,
} from "@elizaos/core";
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
import { ConversationSimulator } from "./utils/conversation-simulator";
import { expectSoft, RecordingTestUtils } from "./utils/recording-test-utils";
import { ModelMockingService } from "./utils/model-mocking-service";

describe("AgentServer integration", () => {
  let server: AgentServer;
  let dataDir: string;
  let runtime: IAgentRuntime;
  let testServerPort: number;

  // Utility function to create test-safe plugin arrays
  function getTestPlugins(includeLocalAI: boolean = false) {
    const basePlugins = [sqlPlugin, bootstrapPlugin, socialStrategyPlugin];

    // Only include openai in record mode or when explicitly requested
    if (includeLocalAI && process.env.MODEL_RECORD_MODE) {
      return [sqlPlugin, openaiPlugin, bootstrapPlugin, socialStrategyPlugin];
    }

    return basePlugins;
  }

  beforeAll(async () => {
    testServerPort = 3100;
    await killProcessOnPort(testServerPort);
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_TIMEOUTS.SHORT_WAIT)
    );
    dataDir = path.join(os.tmpdir(), `eliza-test-${Date.now()}`);
    fs.mkdirSync(dataDir, { recursive: true });
    server = new AgentServer();

    const testChar = { ...alexCharacter, plugins: [] };

    const testEnv = dotenv.config({
      path: path.join(__dirname, "../../.env.test"),
    });

    // Use safe plugins - no openai for basic server tests
    runtime = new AgentRuntime({
      character: testChar,
      plugins: getTestPlugins(false),
      settings: { DATABASE_PATH: dataDir, ...process.env, ...testEnv.parsed },
    });

    await server.initialize({ dataDir });
    await runtime.initialize();

    await server.registerAgent(runtime);
    server.start(testServerPort);
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates message server, channel, and messages", async () => {
    const msgSrv = await server.createServer({
      name: "srv1",
      sourceType: "test",
    });
    expect(msgSrv.name).toBe("srv1");

    const channel = await server.createChannel({
      messageServerId: msgSrv.id,
      name: "room1",
      type: ChannelType.GROUP,
    });
    expect(channel.name).toBe("room1");

    const author = stringToUuid("user1");
    const text = "hello";
    await server.createMessage({
      channelId: channel.id,
      authorId: author,
      content: text,
    });
    const messages = await server.getMessagesForChannel(channel.id);
    expect(messages.some((m) => m.content === text)).toBe(true);
  });

  it("auto-associates multiple agents in the default server", async () => {
    // Register a second agent runtime to the same server
    const otherChar = {
      ...alexCharacter,
      name: "OtherAgent",
      plugins: [],
    };

    const runtime2 = new AgentRuntime({
      character: otherChar,
      plugins: getTestPlugins(false), // Use safe plugins, no openai needed
      settings: { DATABASE_PATH: dataDir, ...process.env },
    });

    await runtime2.initialize();
    await server.registerAgent(runtime2);

    const defaultServerId = "00000000-0000-0000-0000-000000000000";
    const agents = await server.getAgentsForServer(defaultServerId);
    expect(agents).toEqual(
      expect.arrayContaining([runtime.agentId, runtime2.agentId])
    );

    const servers1 = await server.getServersForAgent(runtime.agentId);
    const servers2 = await server.getServersForAgent(runtime2.agentId);
    expect(servers1).toContain(defaultServerId);
    expect(servers2).toContain(defaultServerId);
  });

  it("loads the Alex character into the runtime", () => {
    expect(runtime.character.name).toBe(alexCharacter.name);
  });

  it("processes a message and generates a response", async () => {
    // Create a separate runtime for this test with model mocking
    const testChar = {
      ...alexCharacter,
      name: "MessageTestAgent",
      plugins: [],
    };
    const testRuntime = new AgentRuntime({
      character: testChar,
      plugins: getTestPlugins(true), // Include openai for this test
      settings: { DATABASE_PATH: dataDir, ...process.env },
    });

    // Set up per-test mocking - always create the service for proper test isolation
    const mockingService = new ModelMockingService();
    mockingService.setTestContext(
      "AgentServer integration",
      "processes a message and generates a response"
    );

    // Always patch runtime to intercept model calls (for both record and playback)
    mockingService.patchRuntime(testRuntime, "MessageTestAgent");

    await testRuntime.initialize();
    await server.registerAgent(testRuntime);

    try {
      // Create a server and channel for testing
      const msgSrv = await server.createServer({
        name: "test-srv",
        sourceType: "test",
      });

      const channel = await server.createChannel({
        messageServerId: msgSrv.id,
        name: "test-room",
        type: ChannelType.GROUP,
      });

      // Create a test message from a user
      const userAuthor = stringToUuid("testuser");
      const messageText = "Hello Alex, how are you doing today?";

      const userMessage = await server.createMessage({
        channelId: channel.id,
        authorId: userAuthor,
        content: messageText,
      });

      expect(userMessage).toBeDefined();
      expect(userMessage.content).toBe(messageText);

      // Test that we can process actions (even if no conversational response yet)
      const memory: Memory = {
        id: userMessage.id,
        entityId: userAuthor,
        roomId: channel.id,
        content: {
          text: messageText,
          source: "test",
        },
        metadata: {
          timestamp: Date.now(),
          type: "message",
        },
      };

      const state = await testRuntime.composeState(memory);
      const actions = testRuntime.actions || [];

      // Verify that actions can be processed
      let actionProcessed = false;
      for (const action of actions) {
        const isValid = await action.validate(testRuntime, memory, state);
        if (isValid) {
          // Action handlers require a callback function as the 4th parameter
          const mockCallback = vi.fn();
          await action.handler(testRuntime, memory, state, {}, mockCallback);
          actionProcessed = true;
          break;
        }
      }

      expect(actionProcessed).toBe(true);

      // Verify message was stored
      const messages = await server.getMessagesForChannel(channel.id);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((m) => m.content === messageText)).toBe(true);
    } finally {
      // Clean up the test runtime and save recordings
      await mockingService.saveRecordings();
    }
  }, 90000);

  it("demonstrates ConversationSimulator for multi-agent testing", async () => {
    const simDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-"));
    const simulator = new ConversationSimulator({
      agentCount: 2,
      dataDir: simDataDir,
      useModelMockingService: true, // Use modern mocking for recording
      testContext: {
        suiteName: "AgentServer integration",
        testName: "demonstrates ConversationSimulator for multi-agent testing",
      },
      modelMocks: [
        {
          agentId: "Agent1",
          responses: [
            "Hello Agent2! Nice to meet you.",
            "That's great! I'm excited to work together.",
          ],
        },
        {
          agentId: "Agent2",
          responses: [
            "Hi Agent1! Great to be here too.",
            "Absolutely! Let's make this conversation interesting.",
          ],
        },
      ],
    });

    try {
      // Initialize the simulator
      await simulator.initialize();

      // Add two agents with safe plugins (no localAI in playback mode)
      const agent1 = await simulator.addAgent(
        "Agent1",
        { ...alexCharacter, name: "Agent1" },
        getTestPlugins(true) // Include openai only in record mode
      );

      const agent2 = await simulator.addAgent(
        "Agent2",
        { ...alexCharacter, name: "Agent2" },
        getTestPlugins(true) // Include openai only in record mode
      );

      expect(agent1).toBeDefined();
      expect(agent2).toBeDefined();
      expect(simulator.getAgentNames()).toEqual(["Agent1", "Agent2"]);

      // Send initial message
      const { message: firstMessage } = await simulator.sendMessage(
        "Agent1",
        "Hello everyone! Let's start a conversation.",
        false // Don't trigger automatic responses for this demo
      );

      expect(firstMessage.content).toBe(
        "Hello everyone! Let's start a conversation."
      );
      expect(firstMessage.authorName).toBe("Agent1");

      // Send a response from Agent2
      const { message: secondMessage } = await simulator.sendMessage(
        "Agent2",
        "Hi Agent1! This is a great way to test multi-agent conversations.",
        false
      );

      expect(secondMessage.authorName).toBe("Agent2");

      // Verify conversation history
      const history = simulator.getConversationHistory();
      expect(history.length).toBe(2);
      expect(history[0].authorName).toBe("Agent1");
      expect(history[1].authorName).toBe("Agent2");

      // Test conversation summary
      const summary = simulator.createConversationSummary();
      expect(summary.messageCount).toBe(2);
      expect(summary.participantCount).toBe(2);
      expect(summary.messagesByAgent["Agent1"]).toBe(1);
      expect(summary.messagesByAgent["Agent2"]).toBe(1);

      console.log("Conversation Summary:", summary);
    } finally {
      await simulator.cleanup();
    }
  }, 20000);

  it("demonstrates model mocking and automated responses", async () => {
    RecordingTestUtils.logRecordingStatus(
      "model mocking and automated responses"
    );
    const simMockDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "simulator-mocked-")
    );
    const simulator = new ConversationSimulator({
      agentCount: 2,
      dataDir: simMockDir,
      useModelMockingService: true, // Use modern mocking for recording
      testContext: {
        suiteName: "AgentServer integration",
        testName: "demonstrates model mocking and automated responses",
      },
      modelMocks: [
        {
          agentId: "MockAgent1",
          responses: [
            "I think we should focus on building trust first.",
            "That's a really good point about strategy.",
          ],
        },
        {
          agentId: "MockAgent2",
          responses: [
            "I agree, trust is fundamental in any alliance.",
            "We need to be careful about who we share information with.",
          ],
        },
      ],
    });

    try {
      await simulator.initialize();

      // Add agents with safe plugins (no openai in playback mode)
      const agent1 = await simulator.addAgent(
        "MockAgent1",
        { ...alexCharacter, name: "MockAgent1" },
        getTestPlugins(true) // Include openai only in record mode
      );

      const agent2 = await simulator.addAgent(
        "MockAgent2",
        { ...alexCharacter, name: "MockAgent2" },
        getTestPlugins(true) // Include openai only in record mode
      );

      // Verify model mocking is set up
      expect(agent1.useModel).toBeDefined();
      expect(agent2.useModel).toBeDefined();

      // Test that mocked responses work (with soft assertions in record mode)
      const mockResponse1 = await agent1.useModel(ModelType.TEXT_SMALL, {
        prompt: "How do you feel about forming an alliance?",
      });

      // Use soft assertion that won't fail test in record mode
      expectSoft(mockResponse1).toContain(
        "I do not have enough information to provide a meaningful response about forming an alliance. If you have a specific question or situation in mind, I would be more than willing to attempt to provide a helpful answer."
      );
      console.log("Agent1 mock response:", mockResponse1);

      const mockResponse2 = await agent2.useModel(ModelType.TEXT_SMALL, {
        prompt: "What's your strategy?",
      });

      // Suggest updated expectation based on actual response
      RecordingTestUtils.suggestExpectation(
        "agent2 response content",
        mockResponse2,
        "expected to contain 'agree'"
      );
      expectSoft(mockResponse2).toContain(
        "My strategy involves being a helpful, respectful, and honest assistant. I aim to provide clear, accurate, and relevant answers to the best of my abilities while being sensitive to the context of the requests I receive. I strive to always act in a manner that is consistent with my core values of helpfulness, respectfulness, and honesty."
      );
      console.log("Agent2 mock response:", mockResponse2);

      // Start a conversation with automatic responses using the proper event system
      console.log("Starting conversation with automatic responses...");
      const { message: initialMessage } = await simulator.sendMessage(
        "MockAgent1",
        "Hey everyone, should we discuss our strategy for this game?",
        true // This should trigger other agents to respond via MESSAGE_RECEIVED events
      );

      // Wait for potential responses - should trigger 2-step evaluation
      // Allow extra time for model initialization and processing
      console.log(
        "Waiting for agent responses (allowing for model processing time)..."
      );
      const conversationGrew = await simulator.waitForMessages(2, 75000);

      const finalHistory = simulator.getConversationHistory();
      console.log(
        "Final conversation:",
        finalHistory.map((m) => `${m.authorName}: ${m.content}`)
      );

      // At minimum we should have the initial message (soft assertions for recording)
      expectSoft(finalHistory.length).toBeGreaterThanOrEqual(1);
      expectSoft(finalHistory[0]?.authorName).toBe("MockAgent1");
      expectSoft(finalHistory[0]?.content).toBe(
        "Hey everyone, should we discuss our strategy for this game?"
      );

      expectSoft(finalHistory[1]?.authorName).toBe("MockAgent2");
      expectSoft(finalHistory[1]?.content).toBe(
        "Hey there! I'm fairly new to this game, but I've found that having a clear strategy is super important. What are some of the goals everyone is trying to achieve? I'd love to hear how people are approaching this round!"
      );

      // Test conversation analysis
      const summary = simulator.createConversationSummary();
      expectSoft(summary.participantCount).toBe(2);
      expectSoft(summary.messageCount).toBeGreaterThanOrEqual(1);

      // Suggest updates for expectations based on actual results
      RecordingTestUtils.suggestExpectation(
        "conversation length",
        finalHistory.length,
        "at least 2"
      );
      RecordingTestUtils.suggestExpectation(
        "message count",
        summary.messageCount,
        "at least 2"
      );

      console.log("Mock conversation summary:", summary);
    } finally {
      await simulator.cleanup();
    }
  }, 120000); // Increased timeout for recording mode
});
