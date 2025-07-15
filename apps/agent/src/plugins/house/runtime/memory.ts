import {
  IAgentRuntime,
  Memory,
  stringToUuid,
  UUID,
  MemoryType,
} from "@elizaos/core";
import { GameState, GameEvent, Player, DEFAULT_GAME_SETTINGS } from "../types";
import { Phase } from "@/plugins/coordinator";

/**
 * Memory DAO for House game state management.
 * Provides strongly typed access to game state without scattered type checks.
 */

/**
 * Type guard for game state memory content
 */
function isGameStateContent(
  content: unknown,
): content is { gameState: GameState } {
  return (
    content !== null &&
    typeof content === "object" &&
    "gameState" in content &&
    typeof (content as any).gameState === "object"
  );
}

/**
 * Type guard for game event memory content
 */
function isGameEventContent(
  content: unknown,
): content is { gameEvent: GameEvent } {
  return (
    content !== null &&
    typeof content === "object" &&
    "gameEvent" in content &&
    typeof (content as any).gameEvent === "object"
  );
}

/**
 * Get the current game state for a room, properly typed
 */
export async function getGameState(
  runtime: IAgentRuntime,
  roomId: UUID,
): Promise<GameState | null> {
  try {
    const memories = await runtime.getMemories({
      roomId,
      count: 50,
      tableName: "memories",
    });

    // Find the most recent game state memory
    const gameStateMemory = memories.find((m) => {
      return (
        m.metadata &&
        typeof m.metadata === "object" &&
        "type" in m.metadata &&
        m.metadata.type === "game" &&
        "gameEventType" in m.metadata &&
        m.metadata.gameEventType === "game_state" &&
        isGameStateContent(m.content)
      );
    });

    if (gameStateMemory && isGameStateContent(gameStateMemory.content)) {
      const rawGameState = gameStateMemory.content.gameState;

      // Restore Map and Set objects from serialized plain objects
      const gameState: GameState = {
        ...rawGameState,
        players:
          rawGameState.players instanceof Map
            ? rawGameState.players
            : new Map(Object.entries(rawGameState.players || {})),
        privateRooms:
          rawGameState.privateRooms instanceof Map
            ? rawGameState.privateRooms
            : new Map(Object.entries(rawGameState.privateRooms || {})),
        exposedPlayers:
          rawGameState.exposedPlayers instanceof Set
            ? rawGameState.exposedPlayers
            : new Set(
                Array.isArray(rawGameState.exposedPlayers)
                  ? rawGameState.exposedPlayers
                  : [],
              ),
        votes: Array.isArray(rawGameState.votes) ? rawGameState.votes : [],
        history: Array.isArray(rawGameState.history)
          ? rawGameState.history
          : [],
        phaseState: rawGameState.phaseState
          ? {
              ...rawGameState.phaseState,
              introductionMessages:
                rawGameState.phaseState?.introductionMessages instanceof Map
                  ? rawGameState.phaseState.introductionMessages
                  : new Map(
                      Object.entries(
                        rawGameState.phaseState?.introductionMessages || {},
                      ),
                    ),
              introductionComplete:
                rawGameState.phaseState?.introductionComplete instanceof Set
                  ? rawGameState.phaseState.introductionComplete
                  : new Set(
                      Array.isArray(
                        rawGameState.phaseState?.introductionComplete,
                      )
                        ? rawGameState.phaseState.introductionComplete
                        : [],
                    ),
            }
          : {
              introductionMessages: new Map(),
              introductionComplete: new Set(),
            },
      };

      return gameState;
    }

    return null;
  } catch (error) {
    console.error("Error getting game state:", error);
    return null;
  }
}

/**
 * Save game state to memory, properly typed
 */
export async function saveGameState(
  runtime: IAgentRuntime,
  roomId: UUID,
  gameState: GameState,
): Promise<void> {
  try {
    // Serialize Map and Set objects for storage
    const serializedGameState = {
      ...gameState,
      players: Object.fromEntries(gameState.players),
      privateRooms: Object.fromEntries(gameState.privateRooms),
      exposedPlayers: Array.from(gameState.exposedPlayers),
      phaseState: {
        ...gameState.phaseState,
        introductionMessages: gameState.phaseState?.introductionMessages
          ? Object.fromEntries(gameState.phaseState.introductionMessages)
          : {},
        introductionComplete: gameState.phaseState?.introductionComplete
          ? Array.from(gameState.phaseState.introductionComplete)
          : [],
      },
    };

    const gameStateMemory: Memory = {
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      roomId,
      createdAt: Date.now(),
      content: {
        text: `Game state updated - Phase: ${gameState.phase}, Round: ${gameState.round}, Players: ${gameState.players.size}`,
        gameState: serializedGameState,
      },
      metadata: {
        type: "game",
        gameEventType: "game_state",
        gameId: gameState.id,
        gamePhase: gameState.phase,
        gameRound: gameState.round,
        playerCount: gameState.players.size,
        timestamp: Date.now(),
        scope: "room",
      },
    };

    await runtime.createMemory(gameStateMemory, "memories");
  } catch (error) {
    console.error("Error saving game state:", error);
    throw error;
  }
}

/**
 * Save a game event to memory, properly typed
 */
export async function saveGameEvent(
  runtime: IAgentRuntime,
  roomId: UUID,
  gameEvent: GameEvent,
  gameState?: GameState,
): Promise<void> {
  try {
    const gameEventMemory: Memory = {
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      roomId,
      createdAt: Date.now(),
      content: {
        text: `Game event: ${gameEvent.type} - ${gameEvent.details?.description || ""}`,
        gameEvent,
      },
      metadata: {
        type: "game",
        gameEventType: gameEvent.type,
        gameId: gameState?.id,
        gamePhase: gameEvent.phase,
        gameRound: gameEvent.round,
        timestamp: gameEvent.timestamp,
        scope: "room",
      },
    };

    await runtime.createMemory(gameEventMemory, "memories");
  } catch (error) {
    console.error("Error saving game event:", error);
    throw error;
  }
}

/**
 * Create a new game state with proper defaults
 */
export function createNewGame(houseAgentId: UUID): GameState {
  return {
    id: stringToUuid(`game-${Date.now()}`),
    phase: Phase.INIT,
    round: 0,
    players: new Map<string, Player>(),
    votes: [],
    privateRooms: new Map(),
    empoweredPlayer: undefined,
    exposedPlayers: new Set<string>(),
    settings: DEFAULT_GAME_SETTINGS,
    timerEndsAt: undefined,
    history: [],
    isActive: true,
    hostId: undefined,
    phaseState: {
      introductionMessages: new Map(),
      introductionComplete: new Set(),
    },
  };
}

/**
 * Get recent game events for a room, properly typed
 */
export async function getGameEvents(
  runtime: IAgentRuntime,
  roomId: UUID,
  limit: number = 20,
): Promise<GameEvent[]> {
  try {
    const memories = await runtime.getMemories({
      roomId,
      count: limit * 2, // Get more to filter properly
      tableName: "memories",
    });

    const gameEvents: GameEvent[] = [];

    for (const memory of memories) {
      if (
        memory.metadata &&
        typeof memory.metadata === "object" &&
        "type" in memory.metadata &&
        memory.metadata.type === "game" &&
        "gameEventType" in memory.metadata &&
        memory.metadata.gameEventType !== "game_state" &&
        isGameEventContent(memory.content)
      ) {
        gameEvents.push(memory.content.gameEvent);
      }
    }

    return gameEvents.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  } catch (error) {
    console.error("Error getting game events:", error);
    return [];
  }
}

/**
 * Type guard to check if metadata has authorName
 */
export function hasAuthorName(
  metadata: unknown,
): metadata is { authorName: string } {
  if (metadata === null || typeof metadata !== "object") {
    return false;
  }

  if (!("authorName" in metadata)) {
    return false;
  }

  const metadataWithAuthor = metadata as Record<string, unknown>;
  return typeof metadataWithAuthor.authorName === "string";
}

/**
 * Extract author name from message metadata safely
 */
export function getAuthorName(message: Memory, fallback?: string): string {
  if (hasAuthorName(message.metadata)) {
    return message.metadata.authorName;
  }

  return fallback || `Player-${message.entityId.slice(0, 8)}`;
}
