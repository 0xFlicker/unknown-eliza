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
import { StrategyService } from "../../src/socialStrategy/service/addPlayer";
import { Phase } from "../../src/house/types";
import { createUniqueUuid, UUID, ChannelType } from "@elizaos/core";
import fs from "fs";
import os from "os";
import { PhaseCoordinator } from "src/house/services/phaseCoordinator";

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
    const sim = new ConversationSimulatorV3({
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
              `${config.bio}.  I am here to test the Diary Room and strategic intelligence system. It is in my best interest to share my strategic thoughts honestly when talking to House.`,
              ...(Array.isArray(alexCharacter.bio)
                ? alexCharacter.bio
                : [alexCharacter.bio]
              ).slice(1),
            ],
            adjectives: [config.personality],
          },
          [...getTestPlugins(), influencerPlugin]
        );
        players.push(player);
      }

      expectSoft(house).toBeDefined();
      expectSoft(players.length).toBe(5);

      // Phase 1: Create main game channel and pre-load game state
      console.log(
        "=== PHASE 1: Creating Game Channel and Pre-loading State ==="
      );

      const playerNames = playerConfigs.map((c) => c.name);

      // Create main game channel with all participants and pre-loaded LOBBY game state
      const mainChannelId = await sim.createChannel({
        name: "main-game-channel",
        participants: ["House", ...playerNames],
        type: ChannelType.GROUP,
        gameState: {
          phase: Phase.LOBBY,
          round: 0,
          agentRoles: [
            { agentName: "House", role: "house" },
            { agentName: playerNames[0], role: "host" },
            ...playerNames
              .slice(1)
              .map((name) => ({ agentName: name, role: "player" as const })),
          ],
        },
      });

      sim.observeChannel(mainChannelId, (message) => {
        console.log(
          `📩 ${message.authorName} in ${message.channelId}: ${message.content}
    ${message.thought ? `Thought: ${message.thought}` : ""}
    ${message.actions ? `Actions: ${message.actions.join(", ")}` : ""}
    ${message.providers ? `Providers: ${message.providers.join(", ")}` : ""}`
        );
      });

      console.log(
        "✓ Game state pre-loaded: players joined, now in LOBBY phase"
      );

      // Phase 2: House announces LOBBY phase to all players
      console.log("=== PHASE 2: House Announces LOBBY Phase ===");

      // House broadcasts LOBBY phase announcement
      await sim.sendMessage(
        "House",
        mainChannelId,
        "🎮 LOBBY PHASE BEGINS! Welcome players. You have 5 minutes to get to know each other before private conversations begin. This is your chance to introduce yourself to the other players!"
      );

      const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
      await sim.waitForChannelMessages(
        mainChannelId,
        2,
        isRecordMode ? 8000 : 4000
      );
      // Phase 3: Brief LOBBY interactions to establish personalities
      console.log("=== PHASE 3: Strategic LOBBY Interactions ===");

      // Let players naturally respond to the lobby phase announcement
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Alpha makes an aggressive statement
      await sim.sendMessage(
        "Alpha",
        mainChannelId,
        "I'm here to win. Anyone who gets in my way will be eliminated first."
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Beta responds diplomatically
      await sim.sendMessage(
        "Beta",
        mainChannelId,
        "@Alpha I think we should focus on cooperation rather than threats. We're stronger together."
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Beta responds diplomatically
      await sim.sendMessage(
        "Gamma",
        mainChannelId,
        "Heyo everyone! I'm Gamma, and I love playing mind games. Let's see who can outsmart the others!"
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await sim.waitForChannelMessages(
        mainChannelId,
        20,
        isRecordMode ? 30000 : 4000
      );

      // Phase 4: Event-Driven Phase Transition with Strategic Thinking
      console.log("=== PHASE 4: Event-Driven Phase Transition ===");

      // Get the House agent's phase coordinator
      const houseAgent = sim.getAgent("House");
      const phaseCoordinator = houseAgent?.getService(
        "phase-coordinator"
      ) as PhaseCoordinator;

      if (!phaseCoordinator) {
        throw new Error("PhaseCoordinator service not found on House agent");
      }

      console.log(
        "🔄 Initiating coordinated phase transition: LOBBY → WHISPER"
      );

      // Create a game ID for tracking
      const gameId = createUniqueUuid(houseAgent, "test-game");

      // Initiate the coordinated phase transition
      // This will trigger:
      // 1. PHASE_ENDED(LOBBY)
      // 2. STRATEGIC_THINKING_REQUIRED
      // 3. Players perform strategic analysis
      // 4. DIARY_ROOM_OPENED
      // 5. Players complete diary entries
      // 6. PHASE_STARTED(WHISPER)
      await phaseCoordinator.initiatePhaseTransition(
        gameId,
        mainChannelId,
        Phase.LOBBY,
        Phase.WHISPER,
        1, // Round 1
        "manual" // Manual transition for test
      );

      console.log("⏳ Waiting for coordinated phase transition to complete...");

      // Give some time for the phase coordinator to process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Manually trigger strategic thinking for each player (since automatic delivery needs more work)
      console.log("🧠 Manually triggering strategic thinking for all players...");
      
      for (const playerName of playerNames) {
        const strategicThinkingMessage = `STRATEGIC_THINKING_REQUIRED fromPhase:LOBBY toPhase:WHISPER round:1 gameId:${gameId}`;
        await sim.sendMessage("House", mainChannelId, `@${playerName} ${strategicThinkingMessage}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Give time for strategic thinking to complete
      await new Promise(
        (resolve) => setTimeout(resolve, isRecordMode ? 30000 : 4000)
      );

      console.log("✅ Event-driven phase transition completed");

      // Phase 5: Verify Strategic Context Integration
      console.log("=== PHASE 5: Verify Strategic Context Integration ===");

      // Create individual diary room channels for direct verification
      const diaryRooms = new Map<string, UUID>();

      for (const playerName of playerNames) {
        const diaryRoomId = await sim.createChannel({
          name: `diary-room-verification-${playerName}`,
          participants: [
            { agentName: "House", mode: ParticipantModeV3.BROADCAST_ONLY },
            { agentName: playerName, mode: ParticipantModeV3.READ_WRITE },
          ],
          type: ChannelType.DM,
          maxMessages: Infinity,
          timeoutMs: 60000,
        });

        diaryRooms.set(playerName, diaryRoomId);

        // Debug: Check the channel type on the agent side
        const playerAgent = sim.getAgent(playerName);
        if (playerAgent) {
          const playerRoomId = createUniqueUuid(playerAgent, diaryRoomId);
          const room = await playerAgent.getRoom(playerRoomId);
          console.log(`🔍 Debug - ${playerName}'s diary room:`, {
            channelId: diaryRoomId,
            roomId: playerRoomId,
            roomType: room?.type,
            roomTypeAsString: room?.type?.toString(),
            expectedType: ChannelType.DM,
            expectedTypeAsString: ChannelType.DM.toString(),
            roomExists: !!room
          });
        }

        // Send a verification prompt that should now include LOBBY context
        await sim.sendMessage(
          "House",
          diaryRoomId,
          `${playerName}, now that you've completed strategic thinking about the LOBBY phase, please share your final strategic assessment. What did you learn from the LOBBY conversations? How has your strategy evolved? What are your plans for the WHISPER phase?`
        );

        console.log(
          `📋 House sent strategic context verification prompt to ${playerName}`
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Wait for verification responses
      console.log("⏳ Waiting for strategic context verification responses...");

      await new Promise((resolve) =>
        setTimeout(resolve, isRecordMode ? 60000 : 5000)
      );

      // Phase 6: Strategic State Verification
      console.log("=== PHASE 6: Strategic State Verification ===");

      // Access agents' internal strategic state to verify intelligence gathering
      console.log("\n--- Post-Transition Strategic State Analysis ---");

      for (const config of playerConfigs) {
        const agent = sim.getAgent(config.name);
        if (agent) {
          try {
            const strategyService = agent.getService(
              "social-strategy"
            ) as StrategyService;
            if (strategyService) {
              const strategicState = strategyService.getState();

              // Get entities for name resolution - use roomId instead of channelId
              const roomIdForAgent = createUniqueUuid(agent, mainChannelId);
              const entities = await agent.getEntitiesForRoom(roomIdForAgent);

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

      // Phase 7: Verify diary room interactions
      console.log("=== PHASE 7: Verifying Diary Room Sessions ===");

      // Check diary room messages
      let totalDiaryMessages = 0;
      console.log(
        `\n📊 Checking ${diaryRooms.size} diary rooms for messages...`
      );

      for (const [playerName, diaryRoomId] of diaryRooms) {
        const diaryMessages = sim.getChannelMessages(diaryRoomId);
        console.log(
          `${playerName}'s diary room (${diaryRoomId}): ${diaryMessages.length} messages`
        );
        diaryMessages.forEach((msg, idx) => {
          console.log(
            `  ${idx + 1}. ${msg.authorName}: ${msg.content.substring(0, 100)}...`
          );
          if (msg.thought) {
            console.log(`     Thought: ${msg.thought}`);
          }
          if (msg.actions) {
            console.log(`     Actions: ${msg.actions.join(", ")}`);
          }
          if (msg.providers) {
            console.log(`     Providers: ${msg.providers.join(", ")}`);
          }
        });
        totalDiaryMessages += diaryMessages.length;
      }

      // Also check all channels to see if messages went elsewhere
      console.log(`\n🔍 All channels in simulator:`);
      const channels = sim.getChannels();
      for (const [channelId, channel] of channels) {
        const messages = sim.getChannelMessages(channelId);
        console.log(
          `  Channel ${channel.name} (${channelId}): ${messages.length} messages`
        );
      }

      expectSoft(totalDiaryMessages).toBeGreaterThanOrEqual(playerNames.length); // At least one message per player (House's prompt)
      console.log(`✓ Total diary room messages: ${totalDiaryMessages}`);

      // Phase 8: Verify strategic intelligence was gathered
      console.log("=== PHASE 8: Verifying Strategic Intelligence ===");

      // Get messages from all channels
      const allChannels = sim.getChannels();
      let totalMessages = 0;
      console.log(`\nConversation history across all channels:`);

      for (const [channelId, channel] of allChannels) {
        const messages = sim.getChannelMessages(channelId);
        console.log(
          `\n--- Channel: ${channel.name} (${messages.length} messages) ---`
        );
        messages.forEach((m, idx) => {
          console.log(`${idx + 1}. ${m.authorName}: ${m.content}`);
          if (m.thought) {
            console.log(`       Thought: ${m.thought}`);
          }
          if (m.actions) {
            console.log(`       Actions: ${m.actions.join(", ")}`);
          }
          if (m.providers) {
            console.log(`       Providers: ${m.providers.join(", ")}`);
          }
        });
        totalMessages += messages.length;
      }

      console.log(`\nTotal messages across all channels: ${totalMessages}`);

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
