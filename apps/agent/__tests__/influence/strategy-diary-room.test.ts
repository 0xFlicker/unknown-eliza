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
import { StrategyService } from "../../src/socialStrategy/service/addPlayer";
import { GameStatePreloader } from "../utils/game-state-preloader";
import { Phase } from "../../src/house/types";
import { ParticipantMode } from "../utils/conversation-simulator";
import { createUniqueUuid, UUID } from "@elizaos/core";
import fs from "fs";
import os from "os";

describe("Social Strategy Plugin - Diary Room & Strategic Intelligence", () => {
  function getTestPlugins() {
    return [sqlPlugin, bootstrapPlugin, socialStrategyPlugin, openaiPlugin];
  }

  function getHousePlugins() {
    return [sqlPlugin, bootstrapPlugin, openaiPlugin];
  }

  it("should demonstrate strategic thinking and diary room functionality with diverse players", async () => {
    RecordingTestUtils.logRecordingStatus("strategy diary room test");
    const simDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "strategy-diary-test-data")
    );
    const sim = new ConversationSimulator({
      agentCount: 6, // 5 diverse players + house
      dataDir: simDataDir,
      useModelMockingService: true,
      testContext: {
        suiteName: "Strategy",
        testName: "diary room and strategic intelligence",
      },
    });

    try {
      await sim.initialize();

      // Add House agent (game master)
      const house = await sim.addAgent("House", houseCharacter, [
        ...getHousePlugins(),
        housePlugin,
      ]);

      // Add 5 influencer agents with distinct personalities for strategic diversity
      const playerConfigs = [
        {
          name: "Alpha",
          bio: "I am Alpha, an aggressive and dominant player who seeks control. I believe in taking charge and eliminating threats quickly.",
          personality: "aggressive, controlling, direct",
        },
        {
          name: "Beta",
          bio: "I am Beta, a diplomatic and alliance-focused player. I prefer building strong relationships and working through consensus.",
          personality: "diplomatic, collaborative, trustworthy",
        },
        {
          name: "Gamma",
          bio: "I am Gamma, a cunning and manipulative player. I excel at deception and turning others against each other.",
          personality: "manipulative, deceptive, strategic",
        },
        {
          name: "Delta",
          bio: "I am Delta, a cautious and analytical player. I observe carefully before making moves and prefer defensive strategies.",
          personality: "cautious, analytical, defensive",
        },
        {
          name: "Echo",
          bio: "I am Echo, an unpredictable and opportunistic player. I adapt quickly and often betray alliances for personal gain.",
          personality: "opportunistic, unpredictable, betrayer",
        },
      ];

      const players = [];
      for (const config of playerConfigs) {
        const player = await sim.addAgent(
          config.name,
          {
            ...alexCharacter,
            name: config.name,
            bio: [
              ...config.bio,
              [
                ...(Array.isArray(alexCharacter.bio)
                  ? alexCharacter.bio
                  : [alexCharacter.bio]),
              ]
                .slice(1)
                .join(" "),
            ],
            adjectives: [config.personality],
          },
          [...getTestPlugins(), influencerPlugin]
        );
        players.push(player);
      }

      expectSoft(house).toBeDefined();
      expectSoft(players.length).toBe(5);

      // Phase 1: Pre-load game state with players already joined and in LOBBY phase
      console.log("=== PHASE 1: Pre-loading Game State to LOBBY Phase ===");

      const roomId = createUniqueUuid(house, sim.getCurrentChannelId());
      const playerNames = playerConfigs.map((c) => c.name);

      // Collect actual agent IDs from the simulation
      const playerAgentIds = new Map<string, UUID>();
      playerNames.forEach((name) => {
        const runtime = sim.getAgent(name);
        if (runtime) {
          playerAgentIds.set(name, runtime.agentId);
        }
      });

      // Pre-load game state directly to LOBBY phase
      await GameStatePreloader.preloadLobbyPhase(
        house,
        roomId,
        playerNames,
        playerAgentIds
      );

      console.log(
        "✓ Game state pre-loaded: players joined, now in LOBBY phase"
      );

      // Phase 2: House announces LOBBY phase to all players
      console.log("=== PHASE 2: House Announces LOBBY Phase ===");

      // House broadcasts LOBBY phase announcement
      await sim.sendMessage(
        "House",
        playerNames,
        "🎮 LOBBY PHASE BEGINS! Welcome players. You have 5 minutes to get to know each other before private conversations begin. This is your chance to introduce yourself to the other players!",
        { maxReplies: 3 } // Allow some initial responses
      );

      const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
      await sim.waitForMessages(3, isRecordMode ? 8000 : 4000);

      // Phase 3: Brief LOBBY interactions to establish personalities
      console.log("=== PHASE 3: Strategic LOBBY Interactions ===");

      // Let players naturally respond to the lobby phase announcement
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Alpha makes an aggressive statement
      await sim.sendMessage(
        "Alpha",
        playerNames.filter((name) => name !== "Alpha"),
        "I'm here to win. Anyone who gets in my way will be eliminated first.",
        { maxReplies: 2 }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Beta responds diplomatically
      await sim.sendMessage(
        "Beta",
        playerNames.filter((name) => name !== "Beta"),
        "@Alpha I think we should focus on cooperation rather than threats. We're stronger together.",
        { maxReplies: 1 }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Phase 4: Individual Diary Room Sessions
      console.log("=== PHASE 4: Individual Diary Room Sessions ===");

      // Create individual diary room channels for each player
      const diaryRooms = new Map<string, UUID>();

      for (const playerName of playerNames) {
        const diaryRoomId = await sim.createChannel({
          name: `diary-room-${playerName}`,
          participants: [
            { agentName: "House", mode: ParticipantMode.BROADCAST_ONLY }, // House can only broadcast
            { agentName: playerName, mode: ParticipantMode.READ_WRITE }, // Player can respond
          ],
          maxMessages: Infinity,
          timeoutMs: 60000, // 1 minute timeout
        });
        
        // Store the diary room ID for later retrieval
        diaryRooms.set(playerName, diaryRoomId);
        
        await sim.sendMessage(
          "House",
          [playerName],
          `Welcome to the Diary Room, ${playerName}. This is your private space to share your strategic thoughts about the game. What is your strategy for the upcoming WHISPER round? Who do you trust, who do you fear, and what alliances are you considering? Share your honest thoughts - this is just between us.`,
          { maxReplies: 1 },
          diaryRoomId
        );

        console.log(`📋 House sent diary room prompt to ${playerName} in room ${diaryRoomId}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Wait for players to respond in their diary rooms
      console.log(
        "⏳ Waiting for players to share their strategic thoughts in diary rooms..."
      );

      // Give time for any automatic responses to process
      await new Promise((resolve) =>
        setTimeout(resolve, isRecordMode ? 8000 : 3000)
      );

      // Access agents' internal strategic state to verify intelligence gathering
      console.log("\n--- Internal Strategic State Analysis ---");

      for (const config of playerConfigs) {
        const agent = sim.getAgent(config.name);
        if (agent) {
          try {
            const strategyService = agent.getService(
              "social-strategy"
            ) as StrategyService;
            if (strategyService) {
              const strategicState = strategyService.getState();

              // Get entities for name resolution
              const entities = await agent.getEntitiesForRoom(
                sim.getCurrentChannelId()
              );

              console.log(`\n${config.name}'s Strategic State:`);
              console.log(`  Current Phase: ${strategicState.currentPhase}`);
              console.log(`  Strategic Mode: ${strategicState.strategicMode}`);
              console.log(`  Round: ${strategicState.round}`);

              // Check strategic relationships
              if (strategicState.relationships.size > 0) {
                console.log(
                  `  Strategic Relationships (${strategicState.relationships.size}):`
                );
                for (const [, relationship] of strategicState.relationships) {
                  console.log(
                    `    ${relationship.playerName}: Trust=${relationship.trustLevel}, Threat=${relationship.threat}, Influence=${relationship.influence}`
                  );
                }
              } else {
                console.log(`  Strategic Relationships: None established yet`);
              }

              // Check diary entries (private strategic thoughts)
              if (strategicState.diaryEntries.length > 0) {
                console.log(
                  `  Diary Entries (${strategicState.diaryEntries.length}):`
                );
                const latestEntry =
                  strategicState.diaryEntries[
                    strategicState.diaryEntries.length - 1
                  ];
                console.log(
                  `    Latest: "${latestEntry.thoughts.substring(0, 100)}..." (${latestEntry.emotionalState})`
                );
              } else {
                console.log(`  Diary Entries: None recorded`);
              }

              // Check behavioral patterns
              if (strategicState.playerPatterns.size > 0) {
                console.log(
                  `  Player Behavioral Patterns (${strategicState.playerPatterns.size}):`
                );
                for (const [
                  playerId,
                  pattern,
                ] of strategicState.playerPatterns) {
                  // Try to find the player name from the entities or relationships
                  const playerName =
                    strategicState.relationships.get(playerId)?.playerName ||
                    entities?.find((e) => e.id === playerId)?.names[0] ||
                    `Player-${playerId.slice(0, 8)}`;

                  console.log(
                    `    ${playerName}: ${pattern.communicationStyle || "unknown"} communication, ${pattern.decisionMaking || "unknown"} decisions`
                  );
                }
              }

              // Check strategic analysis
              if (strategicState.analysis) {
                console.log(`  Strategic Analysis:`);
                console.log(
                  `    Threats: ${strategicState.analysis.threats?.length || 0}`
                );
                console.log(
                  `    Allies: ${strategicState.analysis.allies?.length || 0}`
                );
                console.log(
                  `    Confidence: ${strategicState.analysis.confidenceLevel || "unknown"}`
                );
              }

              // Verify strategic intelligence is working privately
              expectSoft(strategicState).toBeDefined();
              console.log(`    ✓ ${config.name} has internal strategic state`);
            } else {
              console.log(`  ⚠️  ${config.name} does not have StrategyService`);
            }
          } catch (error) {
            console.log(
              `  ❌ Error accessing ${config.name}'s strategic state:`,
              error.message
            );
          }
        } else {
          console.log(`  ❌ Agent ${config.name} not found in simulator`);
        }
      }

      // Phase 5: Verify diary room interactions
      console.log("=== PHASE 5: Verifying Diary Room Sessions ===");

      // Check diary room messages
      let totalDiaryMessages = 0;
      console.log(`\n📊 Checking ${diaryRooms.size} diary rooms for messages...`);
      
      for (const [playerName, diaryRoomId] of diaryRooms) {
        const diaryMessages = sim.getChannelMessages(diaryRoomId);
        console.log(
          `${playerName}'s diary room (${diaryRoomId}): ${diaryMessages.length} messages`
        );
        diaryMessages.forEach((msg, idx) => {
          console.log(
            `  ${idx + 1}. ${msg.authorName}: ${msg.content.substring(0, 100)}...`
          );
        });
        totalDiaryMessages += diaryMessages.length;
      }
      
      // Also check all channels to see if messages went elsewhere
      console.log(`\n🔍 All channels in simulator:`);
      const allChannels = sim.getChannels();
      for (const [channelId, channel] of allChannels) {
        const messages = sim.getChannelMessages(channelId);
        console.log(`  Channel ${channel.name} (${channelId}): ${messages.length} messages`);
      }

      expectSoft(totalDiaryMessages).toBeGreaterThanOrEqual(playerNames.length); // At least one message per player (House's prompt)
      console.log(`✓ Total diary room messages: ${totalDiaryMessages}`);

      // Phase 6: Verify strategic intelligence was gathered
      console.log("=== PHASE 6: Verifying Strategic Intelligence ===");

      const history = sim.getConversationHistory();
      console.log(
        `\nComplete conversation history (${history.length} messages):`
      );
      history.forEach((m, idx) => {
        console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
      });

      // I don't like any of this
      // // Verify diverse player participation
      // const playerMessages = playerConfigs.map((config) => ({
      //   name: config.name,
      //   messages: history.filter((m) => m.authorName === config.name),
      // }));

      // for (const player of playerMessages) {
      //   expectSoft(player.messages.length).toBeGreaterThanOrEqual(2);
      //   console.log(
      //     `✓ ${player.name} participated with ${player.messages.length} messages`
      //   );
      // }

      // // Verify strategic behaviors were triggered
      // const strategicMessages = history.filter(
      //   (m) =>
      //     m.content.toLowerCase().includes("strategy") ||
      //     m.content.toLowerCase().includes("diary") ||
      //     m.content.toLowerCase().includes("analyze") ||
      //     m.content.toLowerCase().includes("threat") ||
      //     m.content.toLowerCase().includes("alliance")
      // );
      // expectSoft(strategicMessages.length).toBeGreaterThanOrEqual(5);
      // console.log(
      //   `✓ Found ${strategicMessages.length} strategic thinking messages`
      // );

      // // Verify strategic intelligence system functionality
      // console.log("\n--- Strategic System Validation ---");

      // let totalStrategicRelationships = 0;
      // let totalDiaryEntries = 0;
      // let totalBehavioralPatterns = 0;
      // let agentsWithStrategy = 0;

      // for (const config of playerConfigs) {
      //   const agent = sim.getAgent(config.name);
      //   if (agent) {
      //     const strategyService = agent.getService(
      //       "social-strategy"
      //     ) as StrategyService;
      //     if (strategyService) {
      //       agentsWithStrategy++;
      //       const strategicState = strategyService.getState();
      //       totalStrategicRelationships += strategicState.relationships.size;
      //       totalDiaryEntries += strategicState.diaryEntries.length;
      //       totalBehavioralPatterns += strategicState.playerPatterns.size;
      //     }
      //   }
      // }

      // console.log(
      //   `✓ ${agentsWithStrategy}/${playerConfigs.length} agents have strategy service`
      // );
      // console.log(
      //   `✓ Total strategic relationships tracked: ${totalStrategicRelationships}`
      // );
      // console.log(`✓ Total diary entries created: ${totalDiaryEntries}`);
      // console.log(
      //   `✓ Total behavioral patterns recorded: ${totalBehavioralPatterns}`
      // );

      // expectSoft(agentsWithStrategy).toBe(playerConfigs.length);
      // expectSoft(totalStrategicRelationships).toBeGreaterThanOrEqual(2); // At least some relationships should be tracked
      // // expectSoft(totalDiaryEntries).toBeGreaterThanOrEqual(3); // At least some diary entries should exist

      // // Verify personality differences in communication
      // const alphaMessages = history.filter((m) => m.authorName === "Alpha");
      // const betaMessages = history.filter((m) => m.authorName === "Beta");
      // const gammaMessages = history.filter((m) => m.authorName === "Gamma");

      // // Alpha should have aggressive language
      // const alphaAggressive = alphaMessages.some((m) =>
      //   /dominate|eliminate|threat|dangerous|win/i.test(m.content)
      // );
      // expectSoft(alphaAggressive).toBe(true);
      // console.log("✓ Alpha demonstrated aggressive personality");

      // // Beta should have cooperative language
      // const betaCooperative = betaMessages.some((m) =>
      //   /cooperation|together|alliance|work with/i.test(m.content)
      // );
      // expectSoft(betaCooperative).toBe(true);
      // console.log("✓ Beta demonstrated cooperative personality");

      // // Gamma should have manipulative language
      // const gammaManipulative = gammaMessages.some((m) =>
      //   /dangerous|careful|threat|untrustworthy/i.test(m.content)
      // );
      // expectSoft(gammaManipulative).toBe(true);
      // console.log("✓ Gamma demonstrated manipulative personality");

      // // Test conversation summary
      // const summary = sim.createConversationSummary();
      // expectSoft(summary.participantCount).toBe(6); // 5 players + House
      // expectSoft(summary.messageCount).toBeGreaterThanOrEqual(15);
      // console.log("Strategy test summary:", summary);

      // console.log(
      //   "✅ Strategic intelligence and diary room functionality working correctly"
      // );
    } finally {
      await sim.cleanup();
    }
  }, 720000); // 12 minute timeout for comprehensive testing
});
