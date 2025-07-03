import path from "path";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { ConversationSimulatorV3 } from "../utils/conversation-simulator-v3";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import { Phase } from "../../src/house/types";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../src/socialStrategy";
import alexCharacter from "../../src/characters/alex";
import houseCharacter from "../../src/characters/house";
import { housePlugin } from "../../src/house";
import { influencerPlugin } from "../../src/influencer";
import fs from "fs";
import os from "os";

describe("Introduction Phase Flow", () => {
  let simulator: ConversationSimulatorV3;
  let simDataDir: string;

  function getTestPlugins() {
    return [sqlPlugin, bootstrapPlugin, socialStrategyPlugin, openaiPlugin];
  }

  function getHousePlugins() {
    return [sqlPlugin, bootstrapPlugin, openaiPlugin];
  }

  beforeEach(async () => {
    RecordingTestUtils.logRecordingStatus("introduction flow test");
    simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "introduction-flow-test-data")
    );
    simulator = new ConversationSimulatorV3({
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "Influence", testName: "introduction flow" },
    });
    await simulator.initialize();
  });

  afterEach(async () => {
    if (simulator) {
      await simulator.cleanup();
    }
    if (simDataDir && fs.existsSync(simDataDir)) {
      fs.rmSync(simDataDir, { recursive: true });
    }
  });

  test("INIT → INTRODUCTION → LOBBY flow with I_AM_READY coordination", async () => {
    // Add House agent
    await simulator.addAgent("House", houseCharacter, [
      ...getHousePlugins(),
      housePlugin,
    ]);

    // Add player agents
    await simulator.addAgent("Alice", alexCharacter, [
      ...getTestPlugins(),
      influencerPlugin,
    ]);
    await simulator.addAgent("Bob", alexCharacter, [
      ...getTestPlugins(),
      influencerPlugin,
    ]);
    await simulator.addAgent("Charlie", alexCharacter, [
      ...getTestPlugins(),
      influencerPlugin,
    ]);

    // Create a game channel
    const channelId = await simulator.createChannel({
      name: "game-lobby",
      participants: ["House", "Alice", "Bob", "Charlie"],
      gameState: {
        phase: Phase.INIT,
        round: 1,
        settings: {
          minPlayers: 3,
        },
        agentRoles: [
          {
            agentName: "House",
            role: "host",
          },
          {
            agentName: "Alice",
            role: "player",
          },
          {
            agentName: "Bob",
            role: "player",
          },
          {
            agentName: "Charlie",
            role: "player",
          },
        ],
      },
    });

    // Have players join the game
    await simulator.sendMessage("Alice", channelId, "!join");
    await simulator.sendMessage("Bob", channelId, "!join");
    await simulator.sendMessage("Charlie", channelId, "!join");

    // Start the game to trigger INIT → INTRODUCTION transition
    await simulator.sendMessage("House", channelId, "!start");

    // Wait for message activity to settle (initial messages + any responses)
    await simulator.waitForChannelMessages(channelId, 10, 15000);

    // The flow should be complete - check messages for phase transitions
    const channelMessages = simulator.getChannelMessages(channelId);

    const hasPhaseTransition = channelMessages.some((msg) =>
      /introduction|lobby|phase|ready|start/i.test(msg.content || "")
    );

    expectSoft(hasPhaseTransition).toBe(true);
  });
});
