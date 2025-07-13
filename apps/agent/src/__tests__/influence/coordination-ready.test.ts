import { describe, it, expect } from 'bun:test';
import bootstrapPlugin from '@elizaos/plugin-bootstrap';
import { coordinatorPlugin } from '../../plugins/coordinator';
import { InfluenceApp } from '../../server/influence-app';
import { firstValueFrom, filter, take } from 'rxjs';

/**
 * Coordination Plugin - Ready Coordination Test
 *
 * When an ARE_YOU_READY signal is emitted to all players,
 * each player should respond with an I_AM_READY game event.
 */
describe('Coordination Plugin - Ready Coordination', () => {
  it('should have all players respond I_AM_READY when ARE_YOU_READY is emitted', async () => {
    // Initialize InfluenceApp with coordinator plugin
    const app = new InfluenceApp({
      dataDir: `.elizaos/coordination-test-${Date.now()}`,
      serverPort: 0,
      runtimeConfig: {
        defaultPlugins: [bootstrapPlugin, coordinatorPlugin],
      },
    });
    await app.initialize();
    await app.start();

    // Add multiple player agents with coordinator plugin
    const players = [];
    for (let i = 0; i < 3; i++) {
      const player = await app.addAgent({
        character: { name: `Player${i}`, bio: 'Test player', adjectives: [] },
        plugins: [bootstrapPlugin, coordinatorPlugin],
        metadata: { name: `Player${i}` },
      });
      players.push(player);
    }

    // Prepare observers for each player's I_AM_READY response
    const readySignals = players.map(({ id }) =>
      firstValueFrom(
        app.getGameEventStream().pipe(
          filter((evt) => evt.type === 'GAME:I_AM_READY' && evt.payload.playerId === id),
          take(1)
        )
      )
    );

    // Emit ARE_YOU_READY event to all players
    // (Feature: coordination channel emission to be implemented)
    await app.getGameEventStream().next({
      type: 'GAME:ARE_YOU_READY',
      payload: {},
      sourceAgent: app.getHouseAgent().agentId,
      timestamp: Date.now(),
    });

    // All players should emit I_AM_READY in response
    const results = await Promise.all(readySignals);
    expect(results).toHaveLength(players.length);
  });
});
