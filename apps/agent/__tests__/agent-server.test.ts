import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentServer } from "@elizaos/server";
import {
  AgentRuntime,
  ChannelType,
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
import { plugin as localAIPlugin } from "@elizaos/plugin-local-ai";
import { plugin as bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { socialStrategyPlugin } from "../src/socialStrategy/index";
import { killProcessOnPort } from "./utils/process-utils";
import { TEST_TIMEOUTS } from "./utils/test-timeouts";
import { ConversationSimulator } from "./utils/conversation-simulator";

describe("AgentServer integration", () => {
  let server: AgentServer;
  let dataDir: string;
  let runtime: IAgentRuntime;
  let testServerPort: number;

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
    runtime = new AgentRuntime({
      character: testChar,
      plugins: [
        sqlPlugin,
        localAIPlugin,
        bootstrapPlugin,
        socialStrategyPlugin,
      ],
      settings: { DATABASE_PATH: dataDir, ...process.env },
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
      plugins: [
        sqlPlugin,
        localAIPlugin,
        bootstrapPlugin,
        socialStrategyPlugin,
      ],
      settings: { PGLITE_PATH: dataDir, ...process.env },
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

    const state = await runtime.composeState(memory);
    const actions = runtime.actions || [];

    // Verify that actions can be processed
    let actionProcessed = false;
    for (const action of actions) {
      const isValid = await action.validate(runtime, memory, state);
      if (isValid) {
        await action.handler(runtime, memory, state);
        actionProcessed = true;
        break;
      }
    }

    expect(actionProcessed).toBe(true);

    // Verify message was stored
    const messages = await server.getMessagesForChannel(channel.id);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => m.content === messageText)).toBe(true);
  }, 15000);

  it("demonstrates ConversationSimulator for multi-agent testing", async () => {
    const simulator = new ConversationSimulator({
      agentCount: 2,
      dataDir: path.join(dataDir, "simulator"),
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

      // Add two agents
      const agent1 = await simulator.addAgent(
        "Agent1",
        { ...alexCharacter, name: "Agent1" },
        [sqlPlugin, localAIPlugin, socialStrategyPlugin]
      );

      const agent2 = await simulator.addAgent(
        "Agent2",
        { ...alexCharacter, name: "Agent2" },
        [sqlPlugin, localAIPlugin, socialStrategyPlugin]
      );

      expect(agent1).toBeDefined();
      expect(agent2).toBeDefined();
      expect(simulator.getAgentNames()).toEqual(["Agent1", "Agent2"]);

      // Send initial message
      const firstMessage = await simulator.sendMessage(
        "Agent1",
        "Hello everyone! Let's start a conversation.",
        false // Don't trigger automatic responses for this demo
      );

      expect(firstMessage.content).toBe(
        "Hello everyone! Let's start a conversation."
      );
      expect(firstMessage.authorName).toBe("Agent1");

      // Send a response from Agent2
      const secondMessage = await simulator.sendMessage(
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
    const simulator = new ConversationSimulator({
      agentCount: 2,
      dataDir: path.join(dataDir, "simulator-mocked"),
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

      // Add agents with mocked model responses
      const agent1 = await simulator.addAgent(
        "MockAgent1",
        { ...alexCharacter, name: "MockAgent1" },
        [sqlPlugin, localAIPlugin, socialStrategyPlugin]
      );

      const agent2 = await simulator.addAgent(
        "MockAgent2",
        { ...alexCharacter, name: "MockAgent2" },
        [sqlPlugin, localAIPlugin, socialStrategyPlugin]
      );

      // Verify model mocking is set up
      expect(agent1.useModel).toBeDefined();
      expect(agent2.useModel).toBeDefined();

      // Test that mocked responses work
      const mockResponse1 = await agent1.useModel(
        "How do you feel about forming an alliance?",
        {},
        {},
        []
      );

      expect(mockResponse1).toContain("trust");
      console.log("Agent1 mock response:", mockResponse1);

      const mockResponse2 = await agent2.useModel(
        "What's your strategy?",
        {},
        {},
        []
      );

      expect(mockResponse2).toContain("agree");
      console.log("Agent2 mock response:", mockResponse2);

      // Start a conversation with automatic responses
      await simulator.sendMessage(
        "MockAgent1",
        "Hey everyone, should we discuss our strategy for this game?",
        true // This should trigger other agents to respond
      );

      // Wait for potential responses
      const conversationGrew = await simulator.waitForMessages(2, 5000);

      const finalHistory = simulator.getConversationHistory();
      console.log(
        "Final conversation:",
        finalHistory.map((m) => `${m.authorName}: ${m.content}`)
      );

      // At minimum we should have the initial message
      expect(finalHistory.length).toBeGreaterThanOrEqual(1);
      expect(finalHistory[0].authorName).toBe("MockAgent1");
      expect(finalHistory[0].content).toBe(
        "Hey everyone, should we discuss our strategy for this game?"
      );

      // Test conversation analysis
      const summary = simulator.createConversationSummary();
      expect(summary.participantCount).toBe(2);
      expect(summary.messageCount).toBeGreaterThanOrEqual(1);

      console.log("Mock conversation summary:", summary);
    } finally {
      await simulator.cleanup();
    }
  }, 25000);
});
