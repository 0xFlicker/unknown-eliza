import {
  IAgentRuntime,
  UUID,
  elizaLogger,
  createUniqueUuid,
} from "@elizaos/core";
import { GameState } from "./types";

const logger = elizaLogger.child({ component: "GameStateDAO" });

/**
 * Load GameState from runtime memory for a specific room
 */
export async function getGameState(
  runtime: IAgentRuntime,
  gameId: UUID,
): Promise<GameState | null> {
  try {
    const gameState = await runtime.getCache<GameState>(
      createUniqueUuid(runtime, `game_state_${gameId}`),
    );

    if (!gameState) {
      logger.debug(`No game state found for game ${gameId}`);
      return null;
    }

    return gameState;
  } catch (error) {
    logger.error(`Failed to load game state for game ${gameId}:`, error);
    return null;
  }
}

/**
 * Save GameState to runtime memory
 */
export async function saveGameState(
  runtime: IAgentRuntime,
  gameId: UUID,
  gameState: GameState,
): Promise<void> {
  try {
    runtime.setCache(
      createUniqueUuid(runtime, `game_state_${gameId}`),
      gameState,
    );
    // runtime.createComponent({
    //   id: createUniqueUuid(runtime, `game_state_${gameState.id}`),
    //   agentId: runtime.agentId,
    //   createdAt: Date.now(),
    //   entityId: runtime.agentId,
    //   sourceEntityId: runtime.agentId,
    //   type: "game_state",
    //   worldId: gameId,
    //   data: gameState,
    // });

    logger.debug(
      `Saved game state for game ${gameId}: phase=${gameState.phase}, round=${gameState.round}`,
    );
  } catch (error) {
    logger.error(`Failed to save game state for game ${gameId}:`, error);
    throw error;
  }
}
