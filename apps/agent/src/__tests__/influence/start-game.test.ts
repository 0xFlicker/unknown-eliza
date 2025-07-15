import path from "path";
import { describe, it, expect } from "bun:test";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../plugins/socialStrategy";
import alexCharacter from "../../characters/alex";
import houseCharacter from "../../characters/house";
import { housePlugin } from "../../plugins/house";
import { influencerPlugin } from "../../plugins/influencer";
import { coordinatorPlugin } from "../../plugins/coordinator";
import { expectSoft, RecordingTestUtils } from "../utils/recording-test-utils";
import { Phase } from "../../plugins/house/types";
import {
  createUniqueUuid,
  UUID,
  ChannelType,
  IAgentRuntime,
  stringToUuid,
} from "@elizaos/core";
import { GameEventType } from "../../plugins/house/events/types";
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
import { firstValueFrom, take, takeLast, tap, toArray, filter } from "rxjs";

describe("Social Strategy Plugin - Diary Room & Strategic Intelligence", () => {
  function getTestPlugins() {
    return [
      sqlPlugin,
      bootstrapPlugin,
      socialStrategyPlugin,
      openaiPlugin,
      coordinatorPlugin,
    ];
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

      // await sim.createCoordinationChannel(["House", "Alpha", "Beta"]);

      expectSoft(house).toBeDefined();
      expectSoft(players.length).toBe(5);

      // Phase 1: Create main game channel and start in LOBBY phase
      console.log(
        "=== PHASE 1: Creating Game Channel and Starting in LOBBY ===",
      );

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
            mode: ParticipantMode.READ_WRITE,
            state: ParticipantState.FOLLOWED,
          })),
        ],
        type: ChannelType.GROUP,
        runtimeDecorators: [
          async (runtime, { channelId }) => {
            await GameStatePreloader.preloadGamePhase({
              runtime,
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
          `📩 ${players.find((p) => p.id === message.authorId)?.character.name}: ${message.content}`,
        );
      });

      console.log(
        "✓ Game state pre-loaded: players joined, now in LOBBY phase",
      );

      // Manually trigger House to send ARE_YOU_READY for WHISPER phase
      const houseRuntime = app.getAgentManager().getAgentRuntime(house.id);
      if (houseRuntime) {
        const { CoordinationService } = await import(
          "../../plugins/coordinator"
        );
        const coordinationService = houseRuntime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;

        if (coordinationService) {
          await coordinationService.sendGameEvent(GameEventType.ARE_YOU_READY, {
            gameId: stringToUuid(`test-game-${Date.now()}`),
            roomId: mainChannelId,
            readyType: "phase_action",
            targetPhase: Phase.WHISPER,
            timeoutMs: 300000, // 5 minutes
            timestamp: Date.now(),
            runtime: houseRuntime,
            source: "test-setup",
          });
        }
      }

      // Phase 2: House announces LOBBY phase to all players
      console.log("=== PHASE 2: House Announces LOBBY Phase ===");

      let messageCount = 0;
      let messageStream = app.getMessageStream().pipe(
        take(10),
        toArray(),
        tap((messages) => {
          messageCount = messages.length;
        }),
      );

      // House broadcasts LOBBY phase announcement
      await app.sendMessage(
        mainChannelId,
        "🎮 LOBBY PHASE BEGINS! Welcome players. You have 5 minutes to get to know each other before private conversations begin. This is your chance to introduce yourself to the other players!",
      );

      // Phase 3: Brief LOBBY interactions to establish personalities
      console.log("=== PHASE 3: Strategic LOBBY Interactions ===");

      await firstValueFrom(messageStream);

      // Phase 4: Event-Driven Phase Transition LOBBY → WHISPER
      console.log("=== PHASE 4: Coordinated LOBBY → WHISPER Transition ===");

      // Wait for the specific sequence: ARE_YOU_READY → 5x I_AM_READY → PHASE_STARTED
      // Total expected events: 1 + 5 + 1 = 7 events
      const expectedEventCount = 7;

      const transitionEventStream = app.getGameEventStream().pipe(
        filter(
          (e) =>
            e.type === GameEventType.ARE_YOU_READY ||
            e.type === GameEventType.I_AM_READY ||
            (e.type === GameEventType.PHASE_STARTED &&
              e.payload.phase === Phase.WHISPER),
        ),
        take(expectedEventCount),
        toArray(),
      );

      // Wait for the complete event sequence
      const transitionEvents = await firstValueFrom(transitionEventStream);

      // Verify House asked players if they're ready for WHISPER phase
      const areYouReadyEvents = transitionEvents.filter(
        (e) => e.type === GameEventType.ARE_YOU_READY,
      );
      expectSoft(areYouReadyEvents.length).toBe(1);
      const whisperReadyEvent = areYouReadyEvents[0];
      expectSoft(whisperReadyEvent?.payload.targetPhase).toBe(Phase.WHISPER);
      expectSoft(whisperReadyEvent?.payload.readyType).toBe("phase_action");

      // Verify all 5 players responded with I_AM_READY
      const readyResponses = transitionEvents.filter(
        (e) => e.type === GameEventType.I_AM_READY,
      );
      expectSoft(readyResponses.length).toBe(5);

      // Verify all responses are for WHISPER phase
      const whisperReadyResponses = readyResponses.filter(
        (e) => e.payload.targetPhase === Phase.WHISPER,
      );
      expectSoft(whisperReadyResponses.length).toBe(5);

      // Verify House transitioned to WHISPER phase
      const phaseStartedEvents = transitionEvents.filter(
        (e) => e.type === GameEventType.PHASE_STARTED,
      );
      expectSoft(phaseStartedEvents.length).toBe(1);
      const whisperPhaseEvent = phaseStartedEvents[0];
      expectSoft(whisperPhaseEvent?.payload.phase).toBe(Phase.WHISPER);
      expectSoft(whisperPhaseEvent?.payload.previousPhase).toBe(Phase.LOBBY);

      // Verify chronological order: ARE_YOU_READY → I_AM_READY responses → PHASE_STARTED
      if (whisperReadyEvent && whisperPhaseEvent) {
        expectSoft(whisperPhaseEvent.timestamp).toBeGreaterThan(
          whisperReadyEvent.timestamp,
        );

        whisperReadyResponses.forEach((response) => {
          expectSoft(response.timestamp).toBeGreaterThan(
            whisperReadyEvent.timestamp,
          );
          expectSoft(whisperPhaseEvent.timestamp).toBeGreaterThan(
            response.timestamp,
          );
        });
      }

      console.log(`✓ Event-driven phase transition completed: LOBBY → WHISPER`);
      console.log(
        `📊 Captured ${transitionEvents.length}/${expectedEventCount} expected events`,
      );
      console.log(`📝 Player ready responses: ${readyResponses.length}`);
      console.log(`🔄 Phase transitions: ${phaseStartedEvents.length}`);
    } finally {
      await app.stop();
    }
  }, 720000); // 12 minute timeout for comprehensive testing
});
