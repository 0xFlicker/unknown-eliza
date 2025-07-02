import path from "path";
import { describe, it, expect } from "vitest";
import {
  ConversationSimulatorV3,
  ChannelParticipantV3,
  ParticipantModeV3,
} from "../utils/conversation-simulator-v3";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../src/socialStrategy";
import alexCharacter from "../../src/characters/alex";
import houseCharacter from "../../src/characters/house";
import { housePlugin } from "../../src/house";
import { influencerPlugin } from "../../src/influencer";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import { createUniqueUuid, UUID, ChannelType } from "@elizaos/core";
import fs from "fs";
import os from "os";

describe("Simple Diary Room Test", () => {
  function getTestPlugins() {
    return [sqlPlugin, bootstrapPlugin, socialStrategyPlugin, openaiPlugin];
  }

  function getHousePlugins() {
    return [sqlPlugin, bootstrapPlugin, openaiPlugin];
  }

  it("should respond to House in DM/diary room channels", async () => {
    RecordingTestUtils.logRecordingStatus("simple diary room test");
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "simple-diary-test-data")
    );
    const sim = new ConversationSimulatorV3({
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: {
        suiteName: "SimpleDiary",
        testName: "diary room response test",
      },
    });

    try {
      await sim.initialize();

      // Add House agent
      const house = await sim.addAgent("House", houseCharacter, [
        ...getHousePlugins(),
        housePlugin,
      ]);

      // Add one player for simplicity
      const player = await sim.addAgent(
        "TestPlayer",
        {
          ...alexCharacter,
          name: "TestPlayer",
          bio: [
            "I am TestPlayer. I will respond to House prompts in diary room settings.",
            ...(Array.isArray(alexCharacter.bio)
              ? alexCharacter.bio
              : [alexCharacter.bio]
            ).slice(1),
          ],
        },
        [...getTestPlugins(), influencerPlugin]
      );

      console.log("=== Creating Diary Room Channel ===");

      // Create diary room as DM channel
      const diaryRoomId = await sim.createChannel({
        name: "diary-room-testplayer",
        participants: [
          { agentName: "House", mode: ParticipantModeV3.BROADCAST_ONLY },
          { agentName: "TestPlayer", mode: ParticipantModeV3.READ_WRITE },
        ],
        type: ChannelType.DM,
        maxMessages: Infinity,
        timeoutMs: 30000,
      });

      // Debug: Check the channel type on the agent side
      const playerRoomId = createUniqueUuid(player, diaryRoomId);
      const room = await player.getRoom(playerRoomId);
      console.log(`🔍 Debug - TestPlayer's diary room:`, {
        channelId: diaryRoomId,
        roomId: playerRoomId,
        roomType: room?.type,
        roomTypeAsString: room?.type?.toString(),
        expectedType: ChannelType.DM,
        expectedTypeAsString: ChannelType.DM.toString(),
        roomExists: !!room,
        roomSource: room?.source
      });

      // Set up message observation
      sim.observeChannel(diaryRoomId, (message) => {
        console.log(
          `📩 ${message.authorName}: ${message.content}${
            message.thought ? `\n    Thought: ${message.thought}` : ""
          }${
            message.actions ? `\n    Actions: ${message.actions.join(", ")}` : ""
          }${
            message.providers ? `\n    Providers: ${message.providers.join(", ")}` : ""
          }`
        );
      });

      console.log("=== Sending Diary Room Prompt ===");

      // Send diary room prompt
      await sim.sendMessage(
        "House",
        diaryRoomId,
        "TestPlayer, please share your strategic assessment. What are your thoughts on the game so far?"
      );

      console.log("=== Waiting for Response ===");

      // Wait for response with longer timeout in record mode
      const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
      const timeout = isRecordMode ? 30000 : 10000; // 30s in record mode, 10s in playback
      console.log(`Waiting up to ${timeout/1000}s for response...`);
      
      const success = await sim.waitForChannelMessages(diaryRoomId, 2, timeout);
      console.log(`Response received: ${success}`);

      // Check messages
      const messages = sim.getChannelMessages(diaryRoomId);
      console.log(`Total messages in diary room: ${messages.length}`);
      messages.forEach((msg, idx) => {
        console.log(`${idx + 1}. ${msg.authorName}: ${msg.content}`);
        if (msg.thought) console.log(`   Thought: ${msg.thought}`);
        if (msg.actions) console.log(`   Actions: ${msg.actions.join(", ")}`);
      });

      // Verify we got a response from the player
      const playerResponses = messages.filter(m => m.authorName === "TestPlayer");
      expectSoft(playerResponses.length).toBeGreaterThanOrEqual(1);
      console.log(`✓ TestPlayer made ${playerResponses.length} responses`);

    } finally {
      await sim.cleanup();
    }
  }, 120000); // 2 minute timeout to accommodate LLM API calls
});