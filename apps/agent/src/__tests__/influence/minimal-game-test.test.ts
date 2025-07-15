import { describe, it, expect } from "bun:test";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import {
  CoordinationService,
  coordinatorPlugin,
  GameEventType,
  Phase,
} from "../../plugins/coordinator";
import { InfluenceApp } from "../../server/influence-app";
import { firstValueFrom, filter, take } from "rxjs";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState } from "@/server";
import { influencerPlugin } from "@/plugins/influencer";
import openaiPlugin from "@elizaos/plugin-openai";
import { gameEvent$ } from "@/plugins/coordinator/bus";

/**
 * Minimal Game Test
 *
 * Tests basic game setup and coordination without complex conversations
 */
describe("Minimal Game Test", () => {
  it(
    "should create game, add players, and demonstrate basic coordination",
    async () => {
      // Initialize InfluenceApp
      const app = new InfluenceApp({
        context: { suiteName: "Minimal", testName: "Game Setup" },
        dataDir: `.elizaos/minimal-game-test-${Date.now()}`,
        serverPort: 4565,
      });
      await app.initialize();
      await app.start();

      // Get house agent (added implicitly)
      const house = app.getHouseAgent();
      expect(house).toBeDefined();

      // Add 2 simple players
      const players = [];
      for (let i = 0; i < 2; i++) {
        const player = await app.addAgent({
          character: {
            name: `TestPlayer${i}`,
            bio: "Test player for coordination",
            adjectives: [],
          },
          plugins: [
            coordinatorPlugin,
            influencerPlugin,
            bootstrapPlugin,
            sqlPlugin,
            openaiPlugin,
          ],
          metadata: { name: `TestPlayer${i}` },
        });
        players.push(player);
      }

      expect(players).toHaveLength(2);

      // Create game
      const gameId = await app.createGame({
        players: players.map((p) => p.id),
        settings: {
          minPlayers: 2,
          maxPlayers: 4,
        },
        initialPhase: Phase.INIT,
      });

      expect(gameId).toBeDefined();

      // Create game channel
      const channelId = await app.createGameChannel(gameId, {
        name: "test-channel",
        participants: [
          {
            agentId: house.agentId,
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

      expect(channelId).toBeDefined();

      // Get coordination service
      const coordinationService = house.getService<CoordinationService>(
        CoordinationService.serviceType,
      );
      expect(coordinationService).toBeDefined();

      // Prepare to listen for I_AM_READY responses
      const readySignals = players.map(({ id }) =>
        firstValueFrom(
          gameEvent$.pipe(
            filter(
              (evt) =>
                evt.type === "coordination_message" &&
                evt.payload.type === GameEventType.I_AM_READY &&
                evt.payload.playerId === id,
            ),
            take(1),
          ),
        ),
      );

      // Send ARE_YOU_READY event
      await coordinationService.sendGameEvent(
        {
          type: GameEventType.ARE_YOU_READY,
          gameId: gameId,
          roomId: channelId,
          timestamp: Date.now(),
          readyType: "strategic_thinking",
          targetPhase: Phase.INTRODUCTION,
          runtime: house,
          source: house.agentId,
        },
        "others",
      );

      // Wait for I_AM_READY responses from both players
      const results = await Promise.all(readySignals);
      expect(results).toHaveLength(2);

      console.log("✅ Minimal game test passed - coordination system working");

      await app.stop();
    },
    {
      timeout: 30000,
    },
  );
});
