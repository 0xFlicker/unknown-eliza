import { describe, it, expect } from "bun:test";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import {
  CoordinationService,
  coordinatorPlugin,
} from "../../plugins/coordinator";
import { InfluenceApp } from "../../server/influence-app";
import {
  firstValueFrom,
  filter,
  scan,
  takeWhile,
  toArray,
  take,
  tap,
} from "rxjs";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState, StreamedMessage } from "@/server";
import { influencerPlugin } from "@/plugins/influencer";
import { housePlugin } from "@/plugins/house";
import openaiPlugin from "@elizaos/plugin-openai";
import { gameEvent$ } from "@/plugins/coordinator/bus";
import { Phase } from "@/game/types";

/**
 * End-to-End INTRODUCTION Flow Test
 *
 * Clean test for the complete flow:
 * INIT → start game → INTRODUCTION → all players introduce → PHASE_TRANSITION_INITIATED
 */
describe("E2E INTRODUCTION Flow", () => {
  it(
    "should complete full INIT → INTRODUCTION → PHASE_TRANSITION_INITIATED flow",
    async () => {
      console.log("🚀 Starting E2E INTRODUCTION flow test");

      // Initialize InfluenceApp
      const app = new InfluenceApp({
        context: { suiteName: "E2E", testName: "INTRODUCTION Flow" },
        dataDir: `.elizaos/e2e-intro-test-${Date.now()}`,
        serverPort: 4580,
      });
      await app.initialize();
      await app.start();

      // Get house agent (added implicitly)
      const house = app.getHouseAgent();
      expect(house).toBeDefined();
      console.log(`🏠 House agent ID: ${house.agentId}`);

      // Add 3 test players
      const players: Awaited<ReturnType<typeof app.addAgent>>[] = [];
      for (let i = 0; i < 3; i++) {
        const player = await app.addAgent({
          character: {
            name: `Player${i}`,
            bio: "E2E test player",
            adjectives: [],
          },
          plugins: [
            coordinatorPlugin,
            influencerPlugin,
            sqlPlugin,
            openaiPlugin,
          ],
          metadata: { entityName: `Player${i}`, role: "player" },
        });
        players.push(player);
        console.log(`👤 Added Player${i} with ID: ${player.id}`);
      }

      // Create game starting in INTRODUCTION phase
      console.log("🎮 Creating game in INTRODUCTION phase");
      const gameId = await app.createGame({
        players: players.map((p) => p.id),
        settings: {
          minPlayers: 3,
          maxPlayers: 5,
        },
        initialPhase: Phase.INTRODUCTION,
      });
      console.log(`🎮 Game created with ID: ${gameId}`);

      // Create game channel
      console.log("📺 Creating game channel");
      const channelId = await app.createGameChannel(gameId, {
        name: "e2e-test-channel",
        participants: [
          ...players.map((player) => ({
            agentId: player.id,
            mode: ParticipantMode.READ_WRITE,
            state: ParticipantState.FOLLOWED,
          })),
        ],
        type: ChannelType.GROUP,
      });
      console.log(`📺 Channel created with ID: ${channelId}`);

      // Set up event tracking - we want to collect all coordination events until PHASE_TRANSITION_INITIATED
      console.log("📡 Setting up event tracking");
      const allEventsPromise = firstValueFrom(
        gameEvent$.pipe(
          filter((evt) => evt.type === "coordination_message"),
          scan((events, event) => [...events, event], [] as any[]),
          takeWhile((events) => {
            const lastEvent = events[events.length - 1];
            // Stop collecting when we see PHASE_TRANSITION_INITIATED
            return lastEvent?.payload?.type !== "GAME:ALL_PLAYERS_READY";
          }, true), // Include the final event
          toArray(),
        ),
      );

      // Track channel messages separately
      const channelMessages: StreamedMessage[] = [];
      app.getChannelMessageStream(channelId).subscribe((message) => {
        console.log(
          `📩 Channel message: ${message.content} (from: ${message.authorId})`,
        );
        channelMessages.push(message);
      });

      console.log("⏳ Waiting for PHASE_TRANSITION_INITIATED event...");

      // Wait for all events leading up to and including PHASE_TRANSITION_INITIATED
      const allEventArrays = await allEventsPromise;
      const allEvents = allEventArrays.flat();

      console.log(`📊 Collected ${allEvents.length} coordination events`);

      // Verify we got the PHASE_TRANSITION_INITIATED event
      const transitionEvent = allEvents.find(
        (event) => event.payload.type === "GAME:ALL_PLAYERS_READY",
      );

      expect(transitionEvent).toBeDefined();
      expect(transitionEvent.payload.fromPhase).toBe(Phase.INTRODUCTION);
      expect(transitionEvent.payload.toPhase).toBe(Phase.LOBBY);
      expect(transitionEvent.payload.transitionReason).toBe(
        "all_players_ready",
      );

      // Step 1: House prompts for introductions (game already in INTRODUCTION phase)
      console.log("🎯 Step 1: House prompting for introductions");
      await app.sendMessage(
        channelId,
        "🎮 INTRODUCTION PHASE BEGINS! Welcome players! Please introduce yourself with ONE message. The game will continue once everyone has introduced themselves.",
      );

      let messageCount = 0;
      let messageStream = app.getChannelMessageStream(channelId).pipe(
        take(10),
        toArray(),
        tap((messages) => {
          messageCount = messages.length;
        }),
      );

      await firstValueFrom(messageStream);

      console.log("✅ E2E INTRODUCTION flow test PASSED!");
      console.log(`📊 Final stats:`);
      console.log(`  - Coordination events: ${allEvents.length}`);
      console.log(`  - Channel messages: ${channelMessages.length}`);
      console.log(`  - Phase transition completed: ✅`);

      await app.stop();
    },
    {
      timeout: 60000, // Generous timeout for debugging
    },
  );
});
