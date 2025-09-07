import { describe, it, expect } from "bun:test";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import {
  CoordinationService,
  coordinatorPlugin,
} from "../../plugins/coordinator";
import { InfluenceApp } from "../../server/influence-app";
import { firstValueFrom, filter, take, tap } from "rxjs";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState } from "@/server";
import { influencerPlugin } from "@/plugins/influencer";
import openaiPlugin from "@elizaos/plugin-openai";
import { gameAction$, gameEvent$ } from "@/plugins/coordinator/bus";
import { Phase } from "@/game/types";
import { GameStateManager } from "@/plugins/house/gameStateManager";

/**
 * Coordination Plugin - Ready Coordination Test
 *
 * When an ARE_YOU_READY signal is emitted to all players,
 * each player should respond with an I_AM_READY game event.
 */
describe("Coordination Plugin - Ready Coordination", () => {
  it(
    "should have all players respond I_AM_READY when ARE_YOU_READY is emitted",
    async () => {
      // Initialize InfluenceApp with coordinator plugin
      const app = new InfluenceApp({
        context: { suiteName: "Coordination", testName: "Ready Coordination" },
        dataDir: `.elizaos/coordination-test-${Date.now()}`,
        serverPort: 4555,
        houseConfig: {
          maxPlayers: 4,
          minPlayers: 4,
        },
      });
      try {
        await app.initialize();
        // Derive the correct agent type from the `addAgent` helper
        type PlayerAgent = Awaited<ReturnType<typeof app.addAgent>>;
        const players: PlayerAgent[] = [];
        for (let i = 0; i < 3; i++) {
          const player = await app.addAgent({
            character: {
              name: `Player${i}`,
              bio: "Test player",
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
        }

        // Prepare observers for each player's PLAYER_READY response
        const readySignals = players.map(({ id }) =>
          firstValueFrom(
            gameEvent$.pipe(
              filter(
                (evt) =>
                  evt.type === "coordination_message" &&
                  evt.payload.type === "GAME:ALL_PLAYERS_READY",
              ),
              take(1),
            ),
          ),
        );

        await app.start();

        // Get the coordination service
        const coordinationService = app
          .getHouseAgent()
          .getService<CoordinationService>(CoordinationService.serviceType);

        expect(coordinationService).toBeDefined();
        expect(coordinationService).not.toBeNull();

        const gameService = app
          .getHouseAgent()
          .getService<GameStateManager>(GameStateManager.serviceType);

        expect(gameService).toBeDefined();
        expect(gameService).not.toBeNull();

        // All players should emit I_AM_READY in response
        const results = await Promise.all(readySignals);
        expect(results).toHaveLength(3);
      } finally {
        await app.stop();
      }
    },
    {
      timeout: 20000,
    },
  );
});
