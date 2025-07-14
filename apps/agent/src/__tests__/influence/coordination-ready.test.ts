import { describe, it, expect } from "bun:test";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import { coordinatorPlugin } from "../../plugins/coordinator";
import { InfluenceApp } from "../../server/influence-app";
import { firstValueFrom, filter, take } from "rxjs";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState } from "@/server";
import { influencerPlugin } from "@/plugins/influencer";
import openaiPlugin from "@elizaos/plugin-openai";

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
            bootstrapPlugin,
            sqlPlugin,
            openaiPlugin,
          ],
          metadata: { name: `Player${i}` },
        });
        players.push(player);
      }

      // Prepare observers for each player's I_AM_READY response
      const readySignals = players.map(({ id }) =>
        firstValueFrom(
          app.getGameEventStream().pipe(
            filter(
              (evt) =>
                evt.type === "GAME:I_AM_READY" && evt.payload.playerId === id,
            ),
            take(1),
          ),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const channelId = await app.createChannel({
        name: "coordination-channel",
        participants: players.map((p) => ({
          agentId: p.id,
          mode: ParticipantMode.READ_WRITE,
          state: ParticipantState.FOLLOWED,
        })),
        type: ChannelType.GROUP,
      });

      // Emit ARE_YOU_READY event to all players
      // (Feature: coordination channel emission to be implemented)
      app.emitGameEvent({
        type: "GAME:ARE_YOU_READY",
        payload: {},
        sourceAgent: app.getHouseAgent().agentId,
        channelId,
        timestamp: Date.now(),
      });

      // All players should emit I_AM_READY in response
      const results = await Promise.all(readySignals);
      expect(results).toHaveLength(players.length);
    },
    {
      timeout: 20000,
    },
  );
});
