import path from "path";
import { describe, it, expect } from "vitest";
import {
  ConversationSimulatorV3,
  ChannelParticipantV3,
  ParticipantModeV3,
  GameEventObserver,
  ConversationMessageV3,
} from "../utils/conversation-simulator-v3";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../plugins/socialStrategy";
import alexCharacter from "../../characters/alex";
import houseCharacter from "../../characters/house";
import { housePlugin } from "../../plugins/house";
import { influencerPlugin } from "../../plugins/influencer";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import { StrategyService } from "../../plugins/socialStrategy/service/addPlayer";
import { Phase } from "../../plugins/house/types";
import {
  createUniqueUuid,
  UUID,
  ChannelType,
  IAgentRuntime,
} from "@elizaos/core";
import { GameEventType } from "../../plugins/house/events/types";
import fs from "fs";
import os from "os";
import { CoordinationService } from "../../plugins/coordinator/service";
import { InfluenceApp } from "../../server/influence-app";
import type { GameEvent } from "../../server/influence-app";
import {
  Agent,
  AppServerConfig,
  ParticipantMode,
  ParticipantState,
  StreamedMessage,
} from "../../server/types";
import { ModelMockingService } from "../utils/model-mocking-service";
import { GameStatePreloader } from "../utils/game-state-preloader";
import { firstValueFrom, take, takeLast, tap, toArray } from "rxjs";

describe("Social Strategy Plugin - Diary Room & Strategic Intelligence", () => {
  function getTestPlugins() {
    return [sqlPlugin, bootstrapPlugin, socialStrategyPlugin, openaiPlugin];
  }

  function getHousePlugins() {
    return [sqlPlugin, bootstrapPlugin, openaiPlugin];
  }

  it("should demonstrate strategic thinking and diary room functionality with diverse players", async () => {
    RecordingTestUtils.logRecordingStatus("strategy diary room test");
    const simDataDir = path.join(`.elizaos/strategy-diary-test-${Date.now()}`);
    const modelMockingService = new ModelMockingService({
      mode: "record",
      recordingsDir: path.join(__dirname, "../../recordings"),
    });

    const app = new InfluenceApp({
      dataDir: simDataDir,
      serverPort: 2455,
      runtimeConfig: {
        runtime: (runtime) => {
          modelMockingService.patchRuntime(runtime);
          return runtime;
        },
      },
      context: { suiteName: "Strategy", testName: "diary room" },
    });

    try {
      await app.initialize();
      await app.start();

      // Subscribe to game events for E2E verification
      const gameEvents: Array<GameEvent<any>> = [];
      const phaseTransitions: Array<{
        from: Phase;
        to: Phase;
        timestamp: number;
      }> = [];
      app.getGameEventStream().subscribe((event) => {
        gameEvents.push(event);
        if (event.type === GameEventType.PHASE_STARTED) {
          const payload: any = event.payload;
          phaseTransitions.push({
            from: payload.previousPhase,
            to: payload.phase,
            timestamp: event.timestamp,
          });
        }
      });

      // Add House agent (game master)
      const house = await app.addAgent({
        character: houseCharacter,
        plugins: [...getHousePlugins(), housePlugin],

        metadata: {
          name: "House",
        },
      });

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

      const players: Agent<Record<string, unknown>>[] = [];
      for (const config of playerConfigs) {
        const player = await app.addAgent({
          character: {
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
          plugins: [...getTestPlugins(), influencerPlugin],
        });
        players.push(player);
      }

      const gameStatePreloader = GameStatePreloader.createGameState({
        houseRuntime: app.getHouseAgent(),
        playerAgents: players,
        phase: Phase.INIT,
        round: 1,
        settings: {
          minPlayers: 3,
          timers: {
            lobby: 300, // 5 minutes for LOBBY phase
          },
        },
      });

      // await sim.createCoordinationChannel(["House", "Alpha", "Beta"]);

      expectSoft(house).toBeDefined();
      expectSoft(players.length).toBe(5);

      // Phase 1: Create main game channel and start in LOBBY phase
      console.log(
        "=== PHASE 1: Creating Game Channel and Starting in LOBBY ==="
      );

      const playerNames = playerConfigs.map((c) => c.name);

      // Create main game channel with all participants and pre-loaded LOBBY game state
      const mainChannelId = await app.createChannel({
        name: "main-game-channel",
        participants: [
          {
            agentId: house.id,
            mode: ParticipantMode.BROADCAST_ONLY,
            state: ParticipantState.FOLLOWED,
          },
          ...players.map((player) => ({
            agentId: player.id,
            mode: ParticipantMode.BROADCAST_ONLY,
            state: ParticipantState.FOLLOWED,
          })),
        ],
        type: ChannelType.GROUP,
        // gameState: {
        //   phase: Phase.LOBBY,
        //   round: 1,
        //   settings: {
        //     minPlayers: 3,
        //   },
        //   agentRoles: [
        //     { agentName: "House", role: "house" },
        //     { agentName: playerNames[0], role: "host" },
        //     ...playerNames
        //       .slice(1)
        //       .map((name) => ({ agentName: name, role: "player" as const })),
        //   ],
        // },
        runtimeDecorators: [
          async (runtime, channelId) => {
            await GameStatePreloader.preloadGamePhase({
              houseRuntime: app.getHouseAgent(),
              roomId: channelId,
              phase: Phase.LOBBY,
              playerAgents: players,
            });
            return runtime;
          },
        ],
      });

      // Observe channel messages for debugging and collect them
      app.getChannelMessageStream(mainChannelId).subscribe((message) => {
        console.log(
          `📩 ${players.find((p) => p.id === message.authorId)?.character.name}: ${message.content}`
        );
      });

      console.log(
        "✓ Game state pre-loaded: players joined, now in LOBBY phase"
      );

      // Phase 2: House announces LOBBY phase to all players
      console.log("=== PHASE 2: House Announces LOBBY Phase ===");

      let messageCount = 0;
      let messageStream = app.getMessageStream().pipe(
        take(10),
        toArray(),
        tap((messages) => {
          messageCount = messages.length;
        })
      );

      // House broadcasts LOBBY phase announcement
      await app.sendMessage(
        mainChannelId,
        "🎮 LOBBY PHASE BEGINS! Welcome players. You have 5 minutes to get to know each other before private conversations begin. This is your chance to introduce yourself to the other players!"
      );

      // Phase 3: Brief LOBBY interactions to establish personalities
      console.log("=== PHASE 3: Strategic LOBBY Interactions ===");

      await firstValueFrom(messageStream);

      // Phase 4: Event-Driven Phase Transition LOBBY → WHISPER
      console.log("=== PHASE 4: Coordinated LOBBY → WHISPER Transition ===");
    } finally {
      await app.stop();
    }
  }, 720000); // 12 minute timeout for comprehensive testing
});
