import { IAgentRuntime, UUID, elizaLogger, Memory } from "@elizaos/core";
import {
  GameState,
  MemoryGameEvent,
  Player,
  PhaseState,
} from "../plugins/house/types";
import { Phase } from "../plugins/coordinator";

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
      tableName: "memories",
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

    const memoryGameState = gameStateMemory.content
      .gameState as MemoryGameEvent;

    // Convert serialized data back to proper types
    const gameState: GameState = {
      ...memoryGameState,
      players: new Map(Object.entries(memoryGameState.players || {})),
      votes: Array.isArray(memoryGameState.votes) ? memoryGameState.votes : [],
      privateRooms: new Map(Object.entries(memoryGameState.privateRooms || {})),
      exposedPlayers: new Set(memoryGameState.exposedPlayers || []),
      phaseState: {
        ...memoryGameState.phaseState,
        introductionMessages: new Map(
          Object.entries(
            memoryGameState.phaseState?.introductionMessages || {},
          ),
        ),
        introductionComplete: new Set(
          memoryGameState.phaseState?.introductionComplete || [],
        ),
      },
    };

    logger.debug(
      `Loaded game state for room ${roomId}: phase=${gameState.phase}, round=${gameState.round}`,
    );
    return gameState;
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
    // Convert Maps and Sets to serializable objects
    const memoryGameState: MemoryGameEvent = {
      ...gameState,
      players: Object.fromEntries(gameState.players),
      privateRooms: Object.fromEntries(gameState.privateRooms),
      exposedPlayers: Array.from(gameState.exposedPlayers),
      phaseState: {
        ...gameState.phaseState,
        introductionMessages: Object.fromEntries(
          gameState.phaseState.introductionMessages || new Map(),
        ),
        introductionComplete: Array.from(
          gameState.phaseState.introductionComplete || new Set(),
        ),
      },
    };

    await runtime.createMemory(
      {
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        roomId,
        createdAt: Date.now(),
        content: {
          text: `Game state updated - Phase: ${gameState.phase}, Round: ${gameState.round}, Players: ${gameState.players.size}`,
          gameState: memoryGameState,
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
      "memories",
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
export async function updateIntroduction(
  runtime: IAgentRuntime,
  roomId: UUID,
  playerId: string,
): Promise<GameState | null> {
  const gameState = await getGameState(runtime, roomId);
  if (!gameState) {
    logger.warn(
      `Cannot update introduction - no game state found for room ${roomId}`,
    );
    return null;
  }

  // Only track during INTRODUCTION phase
  if (gameState.phase !== Phase.INTRODUCTION || !gameState.isActive) {
    logger.debug(
      `Wrong phase or inactive - phase: ${gameState.phase}, isActive: ${gameState.isActive}`,
    );
    return gameState;
  }

  const currentCount =
    gameState.phaseState.introductionMessages?.get(playerId) || 0;

  // Only count first message from each player
  if (currentCount >= 1) {
    logger.debug(
      `Player ${playerId} already introduced - ignoring additional message`,
    );
    return gameState;
  }

  // Update introduction tracking
  gameState.phaseState.introductionMessages =
    gameState.phaseState.introductionMessages || new Map();
  gameState.phaseState.introductionComplete =
    gameState.phaseState.introductionComplete || new Set();

  gameState.phaseState.introductionMessages.set(playerId, currentCount + 1);
  gameState.phaseState.introductionComplete.add(playerId);

  await saveGameState(runtime, roomId, gameState);

  logger.debug(
    `Updated introduction for player ${playerId} - total introduced: ${gameState.phaseState.introductionComplete.size}/${gameState.players.size}`,
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

  const totalPlayers = gameState.players.size;
  const completedIntros = gameState.phaseState.introductionComplete?.size || 0;

  return completedIntros >= totalPlayers;
}

/**
 * Transition game to next phase
 */
export async function transitionToPhase(
  runtime: IAgentRuntime,
  roomId: UUID,
  toPhase: Phase,
): Promise<GameState | null> {
  const gameState = await getGameState(runtime, roomId);
  if (!gameState) {
    logger.warn(
      `Cannot transition phase - no game state found for room ${roomId}`,
    );
    return null;
  }

  const fromPhase = gameState.phase;
  gameState.phase = toPhase;

  // Clear phase-specific state when transitioning
  if (fromPhase === Phase.INTRODUCTION && toPhase === Phase.LOBBY) {
    gameState.phaseState.introductionMessages = new Map();
    gameState.phaseState.introductionComplete = new Set();
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
): memory is Memory & { content: { gameState: MemoryGameEvent } } {
  return (
    !!memory?.content?.gameState &&
    typeof memory.content.gameState === "object" &&
    "phase" in memory.content.gameState &&
    "round" in memory.content.gameState
  );
}
