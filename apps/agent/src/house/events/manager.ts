import type { IAgentRuntime, UUID } from "@elizaos/core";
import { elizaLogger } from "@elizaos/core";
import type {
  GameEventType,
  GameEventPayload,
  GameEventPayloadMap,
  GameEventHandler,
  GameEventEmission
} from "./types";

const logger = elizaLogger.child({ component: "GameEventManager" });

/**
 * Manager for game-specific events that wraps the ElizaOS runtime event system
 * Provides type-safe game event emission and handling
 */
export class GameEventManager {
  private runtime: IAgentRuntime;
  private eventHandlers = new Map<string, Array<(payload: any) => Promise<void> | void>>();
  private eventEmissionLog = new Map<string, number>();

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Emit a game event with type safety
   */
  async emitGameEvent<T extends keyof GameEventPayloadMap>(
    eventType: T,
    payload: Omit<GameEventPayloadMap[T], 'runtime' | 'source' | 'onComplete'>
  ): Promise<void> {
    try {
      // Create full payload with ElizaOS requirements
      const fullPayload: GameEventPayloadMap[T] = {
        ...payload,
        runtime: this.runtime,
        source: "game-event-manager",
        timestamp: Date.now()
      } as GameEventPayloadMap[T];

      // Log the emission
      const emissionCount = (this.eventEmissionLog.get(eventType) || 0) + 1;
      this.eventEmissionLog.set(eventType, emissionCount);

      logger.info(`[GameEvent] Emitting ${eventType}`, {
        eventType,
        emissionCount,
        gameId: (payload as any).gameId,
        roomId: (payload as any).roomId
      });
      
      // console.log(`🎯 [GameEvent] Emitting: ${eventType}`, {
      //   gameId: (payload as any).gameId,
      //   roomId: (payload as any).roomId
      // });

      // Emit through ElizaOS runtime (using string-based events)
      await this.runtime.emitEvent(eventType as string, fullPayload);

      // Call registered handlers
      const handlers = this.eventHandlers.get(eventType);
      if (handlers && handlers.length > 0) {
        logger.debug(`[GameEvent] Calling ${handlers.length} handlers for ${eventType}`);
        
        await Promise.all(
          handlers.map(async (handler) => {
            try {
              await handler(fullPayload);
            } catch (error) {
              logger.error(`[GameEvent] Handler error for ${eventType}:`, error);
            }
          })
        );
      }
    } catch (error) {
      logger.error(`[GameEvent] Failed to emit ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * Register a handler for a specific game event type
   */
  onGameEvent<T extends keyof GameEventPayloadMap>(
    eventType: T,
    handler: GameEventHandler<T>
  ): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }

    this.eventHandlers.get(eventType)!.push(handler);

    logger.debug(`[GameEvent] Registered handler for ${eventType}`, {
      handlerCount: this.eventHandlers.get(eventType)!.length
    });
  }

  /**
   * Remove a specific handler for an event type
   */
  offGameEvent<T extends keyof GameEventPayloadMap>(
    eventType: T,
    handler: GameEventHandler<T>
  ): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
        logger.debug(`[GameEvent] Removed handler for ${eventType}`, {
          remainingHandlers: handlers.length
        });
      }
    }
  }

  /**
   * Remove all handlers for a specific event type
   */
  removeAllHandlers<T extends keyof GameEventPayloadMap>(eventType: T): void {
    this.eventHandlers.delete(eventType);
    logger.debug(`[GameEvent] Removed all handlers for ${eventType}`);
  }

  /**
   * Get event emission statistics
   */
  getEmissionStats(): Record<string, number> {
    return Object.fromEntries(this.eventEmissionLog);
  }

  /**
   * Get registered handler counts
   */
  getHandlerStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [eventType, handlers] of this.eventHandlers) {
      stats[eventType] = handlers.length;
    }
    return stats;
  }

  /**
   * Clear all event emission statistics
   */
  clearStats(): void {
    this.eventEmissionLog.clear();
    logger.debug("[GameEvent] Cleared emission statistics");
  }

  /**
   * Helper to create event payloads with common fields
   */
  createBasePayload(gameId: UUID, roomId: UUID): Pick<GameEventPayload, 'gameId' | 'roomId' | 'timestamp'> {
    return {
      gameId,
      roomId,
      timestamp: Date.now()
    };
  }

  /**
   * Convenience method to emit phase started event
   */
  async emitPhaseStarted(
    gameId: UUID,
    roomId: UUID,
    phase: import("../types").Phase,
    round: number,
    timerEndsAt?: number
  ): Promise<void> {
    await this.emitGameEvent("GAME:PHASE_STARTED", {
      ...this.createBasePayload(gameId, roomId),
      phase,
      round,
      timerEndsAt
    });
  }

  /**
   * Convenience method to emit phase ended event
   */
  async emitPhaseEnded(
    gameId: UUID,
    roomId: UUID,
    phase: import("../types").Phase,
    round: number,
    previousPhase?: import("../types").Phase
  ): Promise<void> {
    await this.emitGameEvent("GAME:PHASE_ENDED", {
      ...this.createBasePayload(gameId, roomId),
      phase,
      round,
      previousPhase
    });
  }

  /**
   * Convenience method to emit player ready event
   */
  async emitPlayerReady(
    gameId: UUID,
    roomId: UUID,
    playerId: UUID,
    playerName: string,
    readyType: 'strategic_thinking' | 'diary_room' | 'phase_action'
  ): Promise<void> {
    await this.emitGameEvent("GAME:PLAYER_READY", {
      ...this.createBasePayload(gameId, roomId),
      playerId,
      playerName,
      readyType
    });
  }

  /**
   * Convenience method to emit strategic thinking required event
   */
  async emitStrategicThinkingRequired(
    gameId: UUID,
    roomId: UUID,
    playerId: UUID,
    playerName: string,
    fromPhase: import("../types").Phase,
    toPhase: import("../types").Phase,
    contextData?: any
  ): Promise<void> {
    await this.emitGameEvent("GAME:STRATEGIC_THINKING_REQUIRED", {
      ...this.createBasePayload(gameId, roomId),
      playerId,
      playerName,
      fromPhase,
      toPhase,
      contextData
    });
  }

  /**
   * Convenience method to emit diary room opened event
   */
  async emitDiaryRoomOpened(
    gameId: UUID,
    roomId: UUID,
    diaryRoomId?: UUID
  ): Promise<void> {
    await this.emitGameEvent("GAME:DIARY_ROOM_OPENED", {
      ...this.createBasePayload(gameId, roomId),
      diaryRoomId
    });
  }
}