import { afterAll, beforeAll, describe, expect, it, jest } from "bun:test";
import dotenv from "dotenv";
import { ChannelType, IAgentRuntime, logger } from "@elizaos/core";
import path from "path";
import os from "os";
import fs from "fs";
import alexCharacter from "../characters/alex";
import bethanyCharacter from "../characters/bethany";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import { killProcessOnPort } from "./utils/process-utils";
import { TEST_TIMEOUTS } from "./utils/test-timeouts";
import {
  createAgentServer,
  DefaultAgentContext,
  InfluenceApp,
  ParticipantMode,
  ParticipantState,
  StreamedMessage,
} from "../server";
import { expectSoft, RecordingTestUtils } from "./utils/recording-test-utils";
import { ModelMockingService } from "./utils/model-mocking-service";
import { lastValueFrom, take, toArray } from "rxjs";

logger.success = jest.fn();

describe("AgentServer V3 Integration", () => {
  let dataDir: string;
  let testServerPort: number;

  // Utility function to create test-safe plugin arrays
  function getTestPlugins() {
    const basePlugins = [sqlPlugin, bootstrapPlugin, openaiPlugin];

    return basePlugins;
  }

  let modelMockingService: ModelMockingService;
  let app: InfluenceApp<
    DefaultAgentContext,
    {
      testName: string;
      suiteName: string;
    },
    IAgentRuntime
  >;

  beforeAll(async () => {
    testServerPort = 6431; // Use different port from other tests
    await killProcessOnPort(testServerPort);
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_TIMEOUTS.SHORT_WAIT),
    );
    dataDir = path.join(os.tmpdir(), `eliza-test-${Date.now()}`);
    fs.mkdirSync(dataDir, { recursive: true });

    dotenv.config({
      path: path.join(__dirname, "../../.env.test"),
    });

    modelMockingService = new ModelMockingService({
      mode: "record",
      recordingsDir: path.join(__dirname, "../recordings"),
    });

    app = new InfluenceApp({
      serverPort: testServerPort,
      runtimeConfig: {
        runtime: (runtime) => {
          modelMockingService.patchRuntime(runtime);
          return runtime;
        },
      },
      dataDir,
      context: {
        testName:
          "demonstrates 2 agents having a basic conversation through AgentServer infrastructure",
        suiteName: "AgentServer V3 Integration",
      },
    });

    await app.initialize();
    await app.start();
  });

  afterAll(async () => {
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    await app.stop();
    await modelMockingService.saveRecordings();
  });

  it("demonstrates 2 agents having a basic conversation through AgentServer infrastructure", async () => {
    RecordingTestUtils.logRecordingStatus(
      "2 agents conversation via AgentServer",
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const agentManager = app.getAgentManager();
    const channelManager = app.getChannelManager();

    console.log("🔄 Creating Alex agent...");
    const alex = await agentManager.addAgent({
      character: alexCharacter,
      plugins: [sqlPlugin, bootstrapPlugin, openaiPlugin],
    });
    console.log(`✅ Alex created with ID: ${alex.id}`);

    console.log("🔄 Creating Bethany agent...");
    const bethany = await agentManager.addAgent({
      character: bethanyCharacter,
      plugins: [sqlPlugin, bootstrapPlugin, openaiPlugin],
    });
    console.log(`✅ Bethany created with ID: ${bethany.id}`);

    // Add a brief delay to ensure both agents are fully registered
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const channelId = await app.createChannel({
      name: "general-chat",
      participants: [
        {
          agentId: alex.id,
          mode: ParticipantMode.READ_WRITE,
          state: ParticipantState.FOLLOWED,
        },
        {
          agentId: bethany.id,
          mode: ParticipantMode.READ_WRITE,
          state: ParticipantState.FOLLOWED,
        },
      ],
      type: ChannelType.GROUP,
      maxMessages: 6,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Set up message streaming to observe real-time messages
    const messageStream = app.getChannelMessageStream(channelId);

    // Send initial message from Alex
    console.log(`🔍 Alex ID: ${alex.id}, Bethany ID: ${bethany.id}`);
    console.log(`🔍 Sending message from House to channel ${channelId}`);

    const threeMessages = messageStream.pipe(
      // take 3
      take(3),
      toArray(),
    );

    await app.sendMessage(
      channelId,
      "Greetings players and welcome to the pre-game! I'm the house, and I'll be your host for the night. Let's get started!\n\nFirst things first, let's get to know each other. @Bethany, please introduce yourself to the group and then ask another player to introduce themselves!",
      bethany.id,
    );

    // Wait for threeMessages to be emitted
    const receivedMessages = await lastValueFrom(threeMessages);

    // Get the final conversation
    const messages = await channelManager.getMessages(channelId);
    console.log("\n📡 Real-time message stream summary:");
    console.log(`Total streamed messages: ${receivedMessages.length}`);
    receivedMessages.forEach((msg, idx) => {
      console.log(
        `${idx + 1}. [${agentManager.getAgent(msg.authorId)?.character.name}]: ${msg.content}`,
      );
    });

    // Verify the conversation worked through AgentServer
    expectSoft(messages.length).toBeGreaterThan(1); // At least Alex's message + Bethany's response

    // Verify Bethany responded somewhere in the conversation
    expectSoft(messages.some((msg) => msg.authorId === bethany.id)).toBe(true);
    console.log("✅ Bethany responded somewhere in the conversation");

    // Verify Alex responded somewhere in the conversation
    expectSoft(messages.some((msg) => msg.authorId === alex.id)).toBe(true);
    console.log("✅ Alex responded somewhere in the conversation");

    // Verify real-time streaming worked
    expectSoft(receivedMessages.length).toBeGreaterThan(0);
    console.log("✅ Real-time message streaming is working");

    // Verify reply-to linkage: agent response should reference the prompt message ID
    if (messages.length > 1) {
      const firstMsgId = messages[1].id;
      const replyMeta = messages[0].metadata;
      expectSoft(replyMeta?.in_reply_to_message_id).toBe(firstMsgId);
      console.log(
        `✅ Reply-to metadata set: ${replyMeta?.in_reply_to_message_id}`,
      );
    }
  }, 90000); // Allow plenty of time for real model interactions
});
