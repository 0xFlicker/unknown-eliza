import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { ChannelType } from "@elizaos/core";
import path from "path";
import os from "os";
import fs from "fs";
import alexCharacter from "../src/characters/alex";
import bethanyCharacter from "../src/characters/bethany";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import { socialStrategyPlugin } from "../src/plugins/socialStrategy/index";
import { killProcessOnPort } from "./utils/process-utils";
import { TEST_TIMEOUTS } from "./utils/test-timeouts";
import {
  createAgentServer,
  InfluenceApp,
  ParticipantMode,
  ParticipantState,
  StreamedMessage,
} from "../src/server";
import { expectSoft, RecordingTestUtils } from "./utils/recording-test-utils";
import { ModelMockingService } from "./utils/model-mocking-service";
import { lastValueFrom, take, toArray } from "rxjs";

describe("AgentServer V3 Integration", () => {
  let dataDir: string;
  let testServerPort: number;

  // Utility function to create test-safe plugin arrays
  function getTestPlugins() {
    const basePlugins = [sqlPlugin, bootstrapPlugin, openaiPlugin];

    return basePlugins;
  }

  beforeAll(async () => {
    testServerPort = 3333; // Use different port from other tests
    await killProcessOnPort(testServerPort);
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_TIMEOUTS.SHORT_WAIT)
    );
    dataDir = path.join(os.tmpdir(), `eliza-test-${Date.now()}`);
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

    const modelMockingService = new ModelMockingService({
      mode: "record",
      recordingsDir: path.join(__dirname, "../recordings"),
    });

    const app = new InfluenceApp({
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

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const agentManager = app.getAgentManager();
    const channelManager = app.getChannelManager();

    console.log("🔄 Creating Alex agent...");
    const alex = await agentManager.addAgent({
      character: alexCharacter,
      plugins: [sqlPlugin as any, bootstrapPlugin, openaiPlugin],
    });
    console.log(`✅ Alex created with ID: ${alex.id}`);

    console.log("🔄 Creating Bethany agent...");
    const bethany = await agentManager.addAgent({
      character: bethanyCharacter,
      plugins: [sqlPlugin as any, bootstrapPlugin, openaiPlugin],
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
      toArray()
    );

    await app.sendMessage(
      channelId,
      "Greetings players and welcome to the pre-game! I'm the house, and I'll be your host for the night. Let's get started!\n\nFirst things first, let's get to know each other. @Bethany, please introduce yourself to the group and then ask another player to introduce themselves!",
      bethany.id
    );

    // Wait for threeMessages to be emitted
    const receivedMessages = await lastValueFrom(threeMessages);

    // Get the final conversation
    const messages = await channelManager.getMessages(channelId);
    console.log("\n📊 Final conversation summary:");
    console.log(`Total messages: ${messages.length}`);
    messages.forEach((msg, idx) => {
      console.log(`${idx + 1}. ${msg.authorId}: ${msg.content}`);
    });

    console.log("\n📡 Real-time message stream summary:");
    console.log(`Total streamed messages: ${receivedMessages.length}`);
    receivedMessages.forEach((msg, idx) => {
      console.log(
        `${idx + 1}. [${msg.source}] ${msg.authorId}: ${msg.content}`
      );
    });

    // Verify the conversation worked through AgentServer
    expectSoft(messages.length).toBeGreaterThan(1); // At least Alex's message + Bethany's response

    // Verify Bethany responded
    if (messages.length > 1) {
      expectSoft(messages[0]?.authorId).toBe(alex.id);
      expectSoft(messages[0]?.content?.length).toBeGreaterThan(0);
      console.log("✅ Alex responded to Bethany");
    }

    // Verify real-time streaming worked
    expectSoft(receivedMessages.length).toBeGreaterThan(0);
    console.log("✅ Real-time message streaming is working");

    // Verify reply-to linkage: agent response should reference the prompt message ID
    if (messages.length > 1) {
      const firstMsgId = messages[1].id;
      const replyMeta = messages[0].metadata;
      expectSoft(replyMeta?.in_reply_to_message_id).toBe(firstMsgId);
      console.log(
        `✅ Reply-to metadata set: ${replyMeta?.in_reply_to_message_id}`
      );
    }
  }, 90000); // Allow plenty of time for real model interactions
});
