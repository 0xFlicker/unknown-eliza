import { describe, it, expect } from "bun:test";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import {
  CoordinationService,
  coordinatorPlugin,
} from "../../plugins/coordinator";
import { InfluenceApp } from "../../server/influence-app";
import { firstValueFrom, filter, take } from "rxjs";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState } from "@/server";
import { influencerPlugin } from "@/plugins/influencer";
import openaiPlugin from "@elizaos/plugin-openai";
import { gameEvent$ } from "@/plugins/coordinator/bus";
import { Phase } from "@/memory/types";

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
      });
      await app.initialize();
      await app.start();

      // Derive the correct agent type from the `addAgent` helper
      type PlayerAgent = Awaited<ReturnType<typeof app.addAgent>>;
      const players: PlayerAgent[] = [];
      for (let i = 0; i < 3; i++) {
        const player = await app.addAgent({
          character: { name: `Player${i}`, bio: "Test player", adjectives: [] },
          plugins: [
            coordinatorPlugin,
            influencerPlugin,
            sqlPlugin,
            openaiPlugin,
          ],
          metadata: { name: `Player${i}` },
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
                evt.payload.action.type === "PLAYER_READY" &&
                evt.payload.action.playerId === id,
            ),
            take(1),
          ),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create a game using the new GameManager approach
      const gameId = await app.createGame({
        players: players.map((p) => p.id),
        settings: {
          minPlayers: 3,
          maxPlayers: 5,
        },
        initialPhase: Phase.INIT,
      });

      const channelId = await app.createGameChannel(gameId, {
        name: "coordination-channel",
        participants: players.map((p) => ({
          agentId: p.id,
          mode: ParticipantMode.READ_WRITE,
          state: ParticipantState.FOLLOWED,
        })),
        type: ChannelType.GROUP,
      });

      // Get the coordination service
      const coordinationService = app
        .getHouseAgent()
        .getService<CoordinationService>(CoordinationService.serviceType);

      expect(coordinationService).toBeDefined();
      expect(coordinationService).not.toBeNull();

      console.log("🏠 Sending ARE_YOU_READY event");
      await coordinationService?.sendGameEvent(
        {
          action: { type: "ARE_YOU_READY" },
          gameId: gameId,
          roomId: channelId,
          timestamp: Date.now(),
          runtime: app.getHouseAgent(),
          source: app.getHouseAgent().agentId,
        },
        "others",
      );

      // All players should emit I_AM_READY in response
      const results = await Promise.all(readySignals);
      expect(results).toHaveLength(players.length);
    },
    {
      timeout: 20000,
    },
  );
});
