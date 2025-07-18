import { IAgentRuntime, UUID, elizaLogger, Memory } from "@elizaos/core";
import { GameState } from "./types";
import { Phase } from "./types";

const logger = elizaLogger.child({ component: "GameStateDAO" });

/**
 * Load GameState from runtime memory for a specific room
 */
export async function getGameState(
  runtime: IAgentRuntime,
  roomId: UUID,
): Promise<GameState | null> {
  try {
    const gameStateMemories = await runtime.getMemories({
      roomId,
      count: 10,
      tableName: "game_state",
    });

    // Find most recent game state memory
    const gameStateMemory = gameStateMemories.find(
      (m) =>
        m.metadata?.type === "game" &&
        m.metadata?.gameEventType === "game_state",
    );

    if (!gameStateMemory?.content?.gameState) {
      logger.debug(`No game state found for room ${roomId}`);
      return null;
    }

    const memoryGameState = gameStateMemory.content.gameState as GameState;

    logger.debug(
      `Loaded game state for room ${roomId}: phase=${memoryGameState.phase}, round=${memoryGameState.round}`,
    );
    return memoryGameState;
  } catch (error) {
    logger.error(`Failed to load game state for room ${roomId}:`, error);
    return null;
  }
}

/**
 * Save GameState to runtime memory
 */
export async function saveGameState(
  runtime: IAgentRuntime,
  roomId: UUID,
  gameState: GameState,
): Promise<void> {
  try {
    await runtime.createMemory(
      {
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        roomId,
        createdAt: Date.now(),
        content: {
          text: `Game state updated - Phase: ${gameState.phase}, Round: ${gameState.round}, Players: ${Object.keys(gameState.players).length}`,
          gameState,
        },
        metadata: {
          type: "game",
          gameEventType: "game_state",
          gameId: gameState.id,
          gamePhase: gameState.phase,
          gameRound: gameState.round,
          timestamp: Date.now(),
        },
      },
      "game_state",
    );

    logger.debug(
      `Saved game state for room ${roomId}: phase=${gameState.phase}, round=${gameState.round}`,
    );
  } catch (error) {
    logger.error(`Failed to save game state for room ${roomId}:`, error);
    throw error;
  }
}

/**
 * Update introduction tracking for a player
 */
export async function updateIntroduction({
  gameState,
  runtime,
  roomId,
  playerId,
}: {
  gameState: GameState;
  runtime: IAgentRuntime;
  roomId: UUID;
  playerId: UUID;
}): Promise<GameState | null> {
  // Only track during INTRODUCTION phase
  if (gameState.phase !== Phase.INTRODUCTION || !gameState.isActive) {
    logger.debug(
      `Wrong phase or inactive - phase: ${gameState.phase}, isActive: ${gameState.isActive}`,
    );
    return gameState;
  }

  const currentCount =
    gameState.phaseState.introductionMessages?.[playerId] || 0;

  // Only count first message from each player
  if (currentCount >= 1) {
    logger.debug(
      `Player ${playerId} already introduced - ignoring additional message`,
    );
    return gameState;
  }
  gameState.phaseState.introductionMessages =
    gameState.phaseState.introductionMessages ?? {};
  gameState.phaseState.introductionMessages[playerId] = currentCount + 1;
  gameState.phaseState.introductionComplete =
    gameState.phaseState.introductionComplete ?? [];
  gameState.phaseState.introductionComplete.push(playerId);

  await saveGameState(runtime, roomId, gameState);

  logger.debug(
    `Updated introduction for player ${playerId} - total introduced: ${gameState.phaseState.introductionComplete.length}/${Object.keys(gameState.players).length}`,
  );
  return gameState;
}

/**
 * Check if all players have completed their introductions
 */
export function isIntroductionPhaseComplete(gameState: GameState): boolean {
  if (gameState.phase !== Phase.INTRODUCTION) {
    return false;
  }

  const totalPlayers = Object.keys(gameState.players).length;
  const completedIntros =
    gameState.phaseState.introductionComplete?.length || 0;

  return completedIntros >= totalPlayers;
}

/**
 * Transition game to next phase
 */
export async function transitionToPhase({
  gameState,
  toPhase,
  runtime,
  roomId,
}: {
  gameState: GameState;
  runtime: IAgentRuntime;
  roomId: UUID;
  toPhase: Phase;
}): Promise<GameState | null> {
  const fromPhase = gameState.phase;
  gameState.phase = toPhase;

  // Clear phase-specific state when transitioning
  if (fromPhase === Phase.INTRODUCTION && toPhase === Phase.LOBBY) {
    gameState.phaseState.introductionMessages = {};
    gameState.phaseState.introductionComplete = [];
    gameState.timerEndsAt = Date.now() + gameState.settings.timers.lobby;
  }

  await saveGameState(runtime, roomId, gameState);

  logger.info(
    `Transitioned game from ${fromPhase} to ${toPhase} for room ${roomId}`,
  );
  return gameState;
}

/**
 * Type guard to check if a memory contains game state
 */
export function isGameStateMemory(
  memory: Memory,
): memory is Memory & { content: { gameState: GameState } } {
  return (
    !!memory?.content?.gameState &&
    typeof memory.content.gameState === "object" &&
    "phase" in memory.content.gameState &&
    "round" in memory.content.gameState
  );
}
