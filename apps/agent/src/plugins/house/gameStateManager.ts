import { IAgentRuntime, UUID, createUniqueUuid } from "@elizaos/core";
import { getGameState } from "../../memory/gameState";
import { Phase } from "../coordinator";
import { GameEventType } from "../coordinator/types";

/**
 * High-level abstraction for managing game state changes and triggering
 * the appropriate events through the PhaseCoordinator system.
 *
 * This ensures all state transitions follow the proper game rules with
 * timeouts, player coordination, and event emission.
 */
export class GameStateManager {
  constructor(private runtime: IAgentRuntime) {}

  /**
   * Handle a player joining the game
   * Emits appropriate events but does not trigger phase transitions
   */
  async handlePlayerJoin(
    roomId: UUID,
    playerId: UUID,
    playerName: string,
  ): Promise<void> {
    const gameId = createUniqueUuid(this.runtime, roomId);

    // Emit player ready event - this is just an informational event
    await this.runtime.emitEvent(GameEventType.PLAYER_READY, {
      gameId,
      roomId,
      playerId,
      playerName,
      readyType: "phase_action",
      timestamp: Date.now(),
    });

    console.log(`🎮 Player ${playerName} joined - emitted PLAYER_READY event`);
  }
}
