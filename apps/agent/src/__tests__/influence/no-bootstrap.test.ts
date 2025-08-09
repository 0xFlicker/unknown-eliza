import path from "path";
import { describe, it, expect } from "bun:test";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import { socialStrategyPlugin } from "../../plugins/socialStrategy";
import { influencerPlugin } from "../../plugins/influencer";
import {
  CoordinationService,
  coordinatorPlugin,
} from "../../plugins/coordinator";
import { RecordingTestUtils } from "../utils/recording-test-utils";
import { AnyCoordinationMessage } from "../../plugins/coordinator/types";
import { Phase } from "@/memory/types";
import { ChannelType, stringToUuid } from "@elizaos/core";
import { InfluenceApp } from "../../server/influence-app";
import { Agent, ParticipantMode, ParticipantState } from "../../server/types";
import { ModelMockingService } from "../utils/model-mocking-service";
import {
  firstValueFrom,
  take,
  tap,
  toArray,
  filter,
  takeWhile,
  scan,
} from "rxjs";
import { gameEvent$ } from "@/plugins/coordinator/bus";

describe("Social Strategy Plugin - Diary Room & Strategic Intelligence", () => {
  function getTestPlugins() {
    return [sqlPlugin, socialStrategyPlugin, openaiPlugin, coordinatorPlugin];
  }

  it("should start an introduction phase with no bootstrap", async () => {
    RecordingTestUtils.logRecordingStatus("no bootstrap test");
    const simDataDir = path.join(
      __dirname,
      `../../.elizaos/no-bootstrap-test-${Date.now()}`,
    );
    const modelMockingService = new ModelMockingService({
      mode: "record",
      recordingsDir: path.join(__dirname, "../../recordings"),
    });

    const app = new InfluenceApp({
      dataDir: simDataDir,
      serverPort: 2459,
      runtimeConfig: {
        runtime: (runtime) => {
          modelMockingService.patchRuntime(runtime);
          return runtime;
        },
      },
      context: { suiteName: "No Bootstrap", testName: "no bootstrap" },
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
          event.payload.action.type === "ALL_PLAYERS_READY"
        ) {
          const payload: any = event.payload;
          phaseTransitions.push({
            from: payload.previousPhase,
            to: payload.phase,
            timestamp: event.timestamp,
          });
        }
      });

      // House agent is added implicitly by InfluenceApp - get reference to it
      const house = app.getHouseAgent();

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
            name: config.name,
            bio: `${config.bio}. I am here to test the Diary Room and strategic intelligence system. It is in my best interest to share my strategic thoughts honestly when talking to House.`,
            adjectives: [config.personality],
          },
          plugins: [...getTestPlugins(), influencerPlugin],
          metadata: { name: config.name },
        });
        players.push(player);
      }

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
          ...players.map((player) => ({
            agentId: player.id,
            mode: ParticipantMode.READ_WRITE,
            state: ParticipantState.FOLLOWED,
          })),
        ],
        type: ChannelType.GROUP,
        maxMessages: 20,
        timeoutMs: 300000, // 5 minutes
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

      const houseRuntime = house;
      expect(houseRuntime).toBeDefined();

      const coordinationService = houseRuntime.getService<CoordinationService>(
        CoordinationService.serviceType,
      );
      expect(coordinationService).toBeDefined();
      expect(coordinationService).not.toBeNull();

      const allEventsPromise = firstValueFrom(
        gameEvent$.pipe(
          filter((evt) => evt.type === "coordination_message"),
          scan(
            (events, event) => [...events, event],
            [] as AnyCoordinationMessage[],
          ),
          takeWhile((events) => {
            const lastEvent = events[events.length - 1];
            // Stop collecting when we see ALL_PLAYERS_READY
            return lastEvent?.payload?.action.type !== "ALL_PLAYERS_READY";
          }, true), // Include the final event
        ),
      );

      await coordinationService!.sendGameEvent({
        gameId,
        roomId: mainChannelId,
        action: { type: "ARE_YOU_READY" },
        timestamp: Date.now(),
        runtime: houseRuntime,
        source: "test-setup",
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

      const allEvents = await allEventsPromise;

      // House broadcasts LOBBY phase announcement
      await app.sendMessage(
        mainChannelId,
        "🎮 LOBBY PHASE BEGINS! Welcome players. You have 5 minutes to get to know each other before private conversations begin. This is your chance to introduce yourself to the other players!",
      );

      // Phase 5: Brief LOBBY interactions to establish personalities
      console.log("=== PHASE 5: Strategic LOBBY Interactions ===");

      await firstValueFrom(messageStream);

      // Where the test is starting to break down....
      // How are we deciding on the end of the LOBBY phase?
      // How does the house emit the PHASE_TRANSITION_INITIATED event?
      // Phase 6: Event-Driven Phase Transition LOBBY → WHISPER
      // [Code removed for being confusing]

      expect(allEvents.length).toBeGreaterThan(0);
      expect(messageCount).toBeGreaterThan(0);

      console.log(
        `✓ Event-driven phase transition STILL NEEDS WORK: LOBBY → WHISPER`,
      );
      console.log(`📊 Captured ${allEvents.length} events`);
      console.log(allEvents);
      console.log(
        allEvents.filter((e) => e.payload.action.type === "ALL_PLAYERS_READY"),
      );
      console.log(
        allEvents.filter((e) => e.payload.action.type === "PLAYER_READY"),
      );
    } finally {
      await app.stop();
    }
  }, 60000); // 1 minute timeout for comprehensive testing
});
