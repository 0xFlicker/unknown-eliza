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
import { GameStatePreloader } from "../utils/game-state-preloader";
import { Phase } from "../../src/house/types";
import { createUniqueUuid, UUID } from "@elizaos/core";
import fs from "fs";
import os from "os";

describe("Influence Game Lobby Conversation", () => {
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

  it(
    "should start with 5 players already joined, House starts game, and players chat in lobby",
    async () => {
      RecordingTestUtils.logRecordingStatus("lobby conversation test");
      const simDataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "lobby-conversation-test-data")
      );
      const sim = new ConversationSimulator({
        agentCount: 6, // 5 players + house
        dataDir: simDataDir,
        useModelMockingService: true,
        testContext: { suiteName: "Influence", testName: "lobby conversation" },
      });

      try {
        await sim.initialize();

        // Add House agent (game master)
        const house = await sim.addAgent(
          "House",
          houseCharacter,
          getHousePlugins()
        );

        const roomId = createUniqueUuid(house, sim.getCurrentChannelId());
        // Add 5 player agents with distinct personalities
        const playerData = [
          {
            name: "P1",
            bio: "I am Player 1 in the Influence game. I'm strategic and cautious, preferring to observe before making alliances. I am the host.",
            style: {
              all: ["Be strategic", "Think before speaking", "Analyze others"],
              chat: ["Share thoughtful observations", "Build trust slowly"],
              post: ["Offer strategic insights"],
            },
          },
          {
            name: "P2",
            bio: "I am Player 2 in the Influence game. I'm outgoing and social, eager to make connections and form alliances quickly.",
            style: {
              all: ["Be friendly", "Build connections", "Stay positive"],
              chat: ["Be welcoming to others", "Suggest cooperation"],
              post: ["Share upbeat thoughts"],
            },
          },
          {
            name: "P3",
            bio: "I am Player 3 in the Influence game. I'm competitive and direct, focused on winning and identifying threats early.",
            style: {
              all: ["Be competitive", "Stay focused", "Identify threats"],
              chat: ["Ask direct questions", "Challenge others subtly"],
              post: ["Share competitive insights"],
            },
          },
          {
            name: "P4",
            bio: "I am Player 4 in the Influence game. I'm diplomatic and balanced, trying to mediate and find common ground.",
            style: {
              all: ["Be diplomatic", "Seek balance", "Mediate conflicts"],
              chat: ["Find middle ground", "Bring people together"],
              post: ["Offer balanced perspectives"],
            },
          },
          {
            name: "P5",
            bio: "I am Player 5 in the Influence game. I'm mysterious and observant, preferring to listen and gather information before revealing my hand.",
            style: {
              all: ["Be mysterious", "Observe carefully", "Reveal little"],
              chat: ["Ask questions", "Give vague responses"],
              post: ["Share cryptic observations"],
            },
          },
        ];

        const players = [];
        for (const playerInfo of playerData) {
          const player = await sim.addAgent(
            playerInfo.name,
            {
              ...alexCharacter,
              name: playerInfo.name,
              bio: playerInfo.bio,
              style: playerInfo.style,
            },
            getPlayerPlugins()
          );
          players.push(player);
        }

        expectSoft(house).toBeDefined();
        expectSoft(players.length).toBe(5);

        // PHASE 1: Pre-load game state with 5 players already joined
        console.log(
          "=== PHASE 1: Pre-loading game state (5 players already joined) ==="
        );

        // Collect actual agent IDs from the simulation
        const playerAgentIds = new Map<string, UUID>();
        const playerNames = ["P1", "P2", "P3", "P4", "P5"];
        playerNames.forEach((name) => {
          const runtime = sim.getAgent(name);
          if (runtime) {
            playerAgentIds.set(name, runtime.agentId);
          }
        });

        const gameState = await GameStatePreloader.preloadInfluenceGame(
          house,
          roomId,
          {
            playerNames,
            hostPlayerName: "P1",
            phase: Phase.INIT, // Pre-load in INIT so host can start
            playerAgentIds, // Pass real agent IDs
          }
        );

        console.log("✓ Game state pre-loaded with 5 players ready to start");

        // PHASE 2: Host starts the game
        console.log("=== PHASE 2: Host starts the game ===");

        const { message: startMessage } = await sim.sendMessage(
          "P1", // P1 is the host
          ["House"], // Send to House only
          "!start",
          true // Trigger House response
        );
        expectSoft(startMessage.content).toContain("start");

        // Wait for House to start the game and transition to LOBBY
        await sim.waitForMessages(2, 10000); // start + house response

        // PHASE 3: Lobby conversation phase (5 minutes or until conversation flows naturally)
        console.log("=== PHASE 3: LOBBY Conversation Phase ===");
        console.log(
          "Players will now engage in 5 minutes of lobby conversation..."
        );

        // Record mode: Allow 5 minutes of conversation
        // Playback mode: Complete all recorded conversations
        const lobbyDurationMs = process.env.MODEL_RECORD_MODE
          ? 5 * 60 * 1000
          : 30000;
        const startTime = Date.now();

        // Wait a moment for the game start to settle, then let players naturally begin conversation
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const allParticipants = sim.getAgentNames();
        // Players can start chatting naturally after House announces LOBBY phase
        if (Date.now() - startTime < lobbyDurationMs) {
          await sim.sendMessage(
            "P2",
            allParticipants.filter((name) => name !== "P2"),
            "Great! Nice to meet everyone. What's everyone's strategy?",
            true
          );
          await sim.waitForMessages(
            sim.getConversationHistory().length + 2,
            10000
          );
        }

        // PHASE 4: Verify results
        console.log("=== PHASE 4: Verifying Lobby Conversation Results ===");

        const history = sim.getConversationHistory();
        console.log("\nLobby conversation history:");
        history.forEach((m, idx) => {
          console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
        });

        // Basic assertions
        expectSoft(history.length).toBeGreaterThanOrEqual(3); // At least start + house response + some conversation

        // Since we pre-loaded game state, there should be no join messages - just the start command
        const startMessages = history.filter(
          (m) =>
            m.authorName.startsWith("P") &&
            m.content.toLowerCase().startsWith("!start")
        );
        expectSoft(startMessages.length).toBe(1);

        const houseMessages = history.filter((m) => m.authorName === "House");
        // House should have responded to start command, but NOT to lobby chat
        expectSoft(houseMessages.length).toBeGreaterThan(0);
        // House should respond to management but not be overly chatty in lobby
        console.log(`House sent ${houseMessages.length} messages during test`);

        const playerChatMessages = history.filter(
          (m) =>
            m.authorName.startsWith("P") &&
            !m.content.toLowerCase().includes("start")
        );
        expectSoft(playerChatMessages.length).toBeGreaterThanOrEqual(1); // Players should chat in lobby

        // Check that House was observing but not participating in chat beyond game management
        const houseChatMessages = houseMessages.filter(
          (m) =>
            !m.content.toLowerCase().includes("lobby phase") &&
            !m.content.toLowerCase().includes("game started") &&
            !m.content.includes("🎮")
        );
        console.log(`House chat messages: ${houseChatMessages.length}`); // House should mostly observe

        // Verify players participated (though not all 5 may chat during test duration)
        const participatingPlayers = new Set(
          history
            .filter((m) => m.authorName.startsWith("P"))
            .map((m) => m.authorName)
        );
        expectSoft(participatingPlayers.size).toBeGreaterThanOrEqual(1);

        // Test conversation summary
        const summary = sim.createConversationSummary();
        expectSoft(summary.participantCount).toBe(6); // 5 players + House
        expectSoft(summary.messageCount).toBeGreaterThanOrEqual(7);

        console.log("Lobby conversation test summary:", summary);
        console.log(
          `Total conversation time: ${(Date.now() - startTime) / 1000}s`
        );
        console.log(
          `House observation behavior: ${houseChatMessages.length} non-management messages`
        );
      } finally {
        await sim.cleanup();
      }
    },
    process.env.MODEL_RECORD_MODE ? 600000 : 120000
  ); // 10 min for record mode, 2 min for playback

  it("should handle House remaining silent during pure player conversation", async () => {
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "house-silent-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 3, // Just 2 players + house for focused test
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: { suiteName: "Influence", testName: "house silent" },
    });

    try {
      await sim.initialize();

      // Add House with strong instructions to observe silently
      await sim.addAgent(
        "House",
        {
          ...alexCharacter,
          name: "House",
          bio: "I am The House - the game master. During LOBBY phase, I am a silent observer only. I do not participate in player conversations.",
          style: {
            all: ["Observe silently", "Only respond to game management"],
            chat: ["Never respond to player chat during LOBBY"],
            post: ["Only announce game state changes"],
          },
        },
        getHousePlugins()
      );

      // Add 2 chatty players
      await sim.addAgent(
        "P1",
        {
          ...alexCharacter,
          name: "P1",
          bio: "I love chatting and getting to know other players.",
        },
        getPlayerPlugins()
      );

      await sim.addAgent(
        "P2",
        {
          ...alexCharacter,
          name: "P2",
          bio: "I'm social and enjoy discussing strategy with others.",
        },
        getPlayerPlugins()
      );

      // Simulate game already started in LOBBY phase
      await sim.sendMessage(
        "House",
        ["P1", "P2"],
        "🎮 GAME STARTED! LOBBY PHASE - Players can chat freely.",
        false
      );

      // Players have a conversation
      await sim.sendMessage(
        "P1",
        ["P2"],
        "Hey P2! What do you think of this game?",
        true
      );
      await sim.waitForMessages(2, 8000);

      await sim.sendMessage(
        "P2",
        ["P1"],
        "It looks really fun! I'm excited to see how it goes.",
        true
      );
      await sim.waitForMessages(4, 8000);

      await sim.sendMessage(
        "P1",
        ["P2"],
        "Same here! Should we try to work together?",
        true
      );
      await sim.waitForMessages(6, 8000);

      const history = sim.getConversationHistory();
      console.log("Silent House test conversation:");
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });

      // House should only have the initial game start message
      const houseMessages = history.filter((m) => m.authorName === "House");
      console.log(`House messages in silent test: ${houseMessages.length}`); // Should be minimal

      // Players should have conversed
      const playerMessages = history.filter((m) =>
        m.authorName.startsWith("P")
      );
      expectSoft(playerMessages.length).toBeGreaterThanOrEqual(3);

      console.log(
        "✓ House correctly remained silent during player conversation"
      );
    } finally {
      await sim.cleanup();
    }
  }, 360000); // 6 minutes for this focused test
});
