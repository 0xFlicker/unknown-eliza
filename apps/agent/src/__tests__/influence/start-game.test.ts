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
import {
  CoordinationService,
  coordinatorPlugin,
} from "../../plugins/coordinator";
import { RecordingTestUtils } from "../utils/recording-test-utils";
import {
  Phase,
  GameEventType,
  AnyCoordinationMessage,
  AreYouReadyPayload,
  PhaseEventPayload,
} from "../../plugins/coordinator/types";
import { ChannelType, stringToUuid } from "@elizaos/core";
import { InfluenceApp } from "../../server/influence-app";
import { Agent, ParticipantMode, ParticipantState } from "../../server/types";
import { ModelMockingService } from "../utils/model-mocking-service";
import { GameStatePreloader } from "../utils/game-state-preloader";
import { firstValueFrom, take, takeLast, tap, toArray, filter } from "rxjs";
import { gameEvent$ } from "@/plugins/coordinator/bus";

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
      const gameEvents: Array<AnyCoordinationMessage> = [];
      const phaseTransitions: Array<{
        from: Phase;
        to: Phase;
        timestamp: number;
      }> = [];
      gameEvent$.subscribe((event) => {
        gameEvents.push(event);
        if (
          event.type === "coordination_message" &&
          event.payload.type === GameEventType.PHASE_STARTED
        ) {
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

      expect(house).toBeDefined();
      expect(players.length).toBe(5);

      // Phase 1: Start a new game with proper initialization
      console.log("=== PHASE 1: Starting Game and Pre-loading LOBBY State ===");

      // Start game with all players - this creates gameId and saves state to all runtimes
      const gameId = await app.createGame({
        players: players.map((p) => p.id),
        settings: {
          minPlayers: 4,
          maxPlayers: 8,
          autoStartGame: true,
        },
        initialPhase: Phase.LOBBY,
      });

      console.log(
        `✓ Game ${gameId} started with ${players.length} players in LOBBY phase`,
      );

      // Phase 2: Create main game channel for this game
      console.log("=== PHASE 2: Creating Game Channel ===");

      const mainChannelId = await app.createGameChannel(gameId, {
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
      });

      // Observe channel messages for debugging and collect them
      app.getChannelMessageStream(mainChannelId).subscribe((message) => {
        console.log(
          `📩 ${players.find((p) => p.id === message.authorId)?.character.name}: ${message.content}`,
        );
      });

      console.log(`✓ Game channel ${mainChannelId} created`);

      // Phase 3: Manually trigger House to send ARE_YOU_READY for WHISPER phase
      console.log("=== PHASE 3: Triggering LOBBY → WHISPER Transition ===");

      const houseRuntime = app.getAgentManager().getAgentRuntime(house.id);
      expect(houseRuntime).toBeDefined();

      const coordinationService = houseRuntime.getService<CoordinationService>(
        CoordinationService.serviceType,
      );
      expect(coordinationService).toBeDefined();
      expect(coordinationService).not.toBeNull();

      await coordinationService.sendGameEvent({
        gameId,
        roomId: mainChannelId,
        readyType: "phase_action",
        targetPhase: Phase.WHISPER,
        timeoutMs: 300000, // 5 minutes
        timestamp: Date.now(),
        runtime: houseRuntime,
        source: "test-setup",
        type: GameEventType.ARE_YOU_READY,
      });

      // Phase 4: House announces LOBBY phase to all players
      console.log("=== PHASE 4: House Announces LOBBY Phase ===");

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

      // Phase 5: Brief LOBBY interactions to establish personalities
      console.log("=== PHASE 5: Strategic LOBBY Interactions ===");

      await firstValueFrom(messageStream);

      // Phase 6: Event-Driven Phase Transition LOBBY → WHISPER
      console.log("=== PHASE 6: Event-Driven LOBBY → WHISPER Transition ===");

      // Wait for the specific sequence: ARE_YOU_READY → 5x I_AM_READY → PHASE_STARTED
      // Total expected events: 1 + 5 + 1 = 7 events
      const expectedEventCount = 7;

      const transitionEventStream = gameEvent$.pipe(
        filter(
          (e) =>
            e.type === "coordination_message" &&
            (e.payload.type === GameEventType.ARE_YOU_READY ||
              e.payload.type === GameEventType.I_AM_READY ||
              (e.payload.type === GameEventType.PHASE_STARTED &&
                e.payload.phase === Phase.WHISPER)),
        ),
        take(expectedEventCount),
        toArray(),
      );

      // Wait for the complete event sequence
      const transitionEvents = await firstValueFrom(transitionEventStream);

      // Verify House asked players if they're ready for WHISPER phase
      const areYouReadyEvents = transitionEvents.filter(
        (e) =>
          e.type === "coordination_message" &&
          e.payload.type === GameEventType.ARE_YOU_READY,
      );
      expect(areYouReadyEvents.length).toBe(1);
      const whisperReadyEvent = areYouReadyEvents[0]
        .payload as AreYouReadyPayload;
      expect(whisperReadyEvent.targetPhase).toBe(Phase.WHISPER);
      expect(whisperReadyEvent.readyType).toBe("phase_action");

      // Verify all 5 players responded with I_AM_READY
      const readyResponses = transitionEvents.filter(
        (e) =>
          e.type === "coordination_message" &&
          e.payload.type === GameEventType.I_AM_READY,
      );
      expect(readyResponses.length).toBe(5);

      // Verify all responses are for WHISPER phase
      const whisperReadyResponses = readyResponses.filter(
        (e) =>
          e.type === "coordination_message" &&
          e.payload.type === GameEventType.I_AM_READY &&
          e.payload.targetPhase === Phase.WHISPER,
      );
      expect(whisperReadyResponses.length).toBe(5);

      // Verify House transitioned to WHISPER phase
      const phaseStartedEvents = transitionEvents.filter(
        (e) =>
          e.type === "coordination_message" &&
          e.payload.type === GameEventType.PHASE_STARTED,
      );
      expect(phaseStartedEvents.length).toBe(1);
      const whisperPhaseEvent = phaseStartedEvents[0]
        .payload as PhaseEventPayload;
      expect(whisperPhaseEvent.phase).toBe(Phase.WHISPER);
      expect(whisperPhaseEvent.previousPhase).toBe(Phase.LOBBY);

      // Verify chronological order: ARE_YOU_READY → I_AM_READY responses → PHASE_STARTED
      if (whisperReadyEvent && whisperPhaseEvent) {
        expect(whisperPhaseEvent.timestamp).toBeGreaterThan(
          whisperReadyEvent.timestamp,
        );

        whisperReadyResponses.forEach((response) => {
          expect(response.timestamp).toBeGreaterThan(
            whisperReadyEvent.timestamp,
          );
          expect(whisperPhaseEvent.timestamp).toBeGreaterThan(
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
