import type { IAgentRuntime, UUID } from "@elizaos/core";
import { Service, stringToUuid, elizaLogger } from "@elizaos/core";
import { GameEventType } from "../events/types";
import { CoordinationService } from "../coordination";
import type {
  PhaseTransitionPayload,
  PlayerReadyPayload,
  AllPlayersReadyPayload,
  TimerEventPayload,
  GameEventPayloadMap,
} from "../events/types";
import { Phase } from "../types";
import { getGameState, saveGameState } from "../runtime/memory";

const logger = elizaLogger.child({ component: "PhaseCoordinator" });

/**
 * Player readiness tracking state
 */
interface PlayerReadyState {
  playerId: UUID;
  playerName: string;
  readyType: "strategic_thinking" | "diary_room" | "phase_action";
  readyAt: number;
  additionalData?: Record<string, unknown>;
}

/**
 * Service responsible for coordinating phase transitions and player synchronization
 * in the Influence game. Uses cross-agent coordination via message bus.
 */
export class PhaseCoordinator extends Service {
  static serviceType = "phase-coordinator";
  capabilityDescription =
    "Coordinates phase transitions and player synchronization in the Influence game";

  private playerReadiness = new Map<string, Map<UUID, PlayerReadyState>>();
  private transitionTimers = new Map<string, NodeJS.Timeout>();
  private isInitialized = false;

  /**
   * Initialize the service with runtime
   */
  async initialize(runtime: IAgentRuntime): Promise<void> {
    if (this.isInitialized) {
      logger.warn("PhaseCoordinator already initialized");
      return;
    }

    this.runtime = runtime;
    this.isInitialized = true;
    logger.info(
      "PhaseCoordinator service initialized with native ElizaOS events"
    );
  }

  /**
   * Static method to start the service (follows ElizaOS service pattern)
   */
  static async start(runtime: IAgentRuntime): Promise<PhaseCoordinator> {
    const coordinator = new PhaseCoordinator(runtime);
    await coordinator.initialize(runtime);

    // Register service with runtime
    runtime.registerService(PhaseCoordinator);

    return coordinator;
  }

  /**
   * Stop the service (required by Service interface)
   */
  async stop(): Promise<void> {
    await this.cleanup();
  }

  /**
   * Get the coordination service for cross-agent communication
   */
  private getCoordinationService(): CoordinationService | null {
    try {
      return this.runtime.getService("coordination") as CoordinationService;
    } catch (error) {
      logger.warn(
        "CoordinationService not available, falling back to local events"
      );
      return null;
    }
  }

  /**
   * Emit a game event via coordination service if available, otherwise locally
   */
  private async emitGameEvent<T extends keyof GameEventPayloadMap>(
    eventType: T,
    payload: GameEventPayloadMap[T]
  ): Promise<void> {
    const coordinationService = this.getCoordinationService();

    if (coordinationService) {
      await coordinationService.sendGameEvent(eventType, payload);
    } else {
      // Fallback to local events
      await this.runtime.emitEvent(eventType, payload);
    }
  }

  /**
   * Handle phase transition events (called by House plugin event handler)
   */
  async handlePhaseTransitionEvent(
    payload: PhaseTransitionPayload
  ): Promise<void> {
    await this.handlePhaseTransition(payload);
  }

  /**
   * Handle player ready events (called by House plugin event handler)
   */
  async handlePlayerReadyEvent(payload: PlayerReadyPayload): Promise<void> {
    await this.handlePlayerReady(payload);
  }

  /**
   * Handle I_AM_READY events specifically (phase action readiness)
   */
  async handleIAmReadyEvent(payload: PlayerReadyPayload): Promise<void> {
    logger.info(`Handling I_AM_READY from ${payload.playerName}`, {
      gameId: payload.gameId,
      roomId: payload.roomId,
      playerId: payload.playerId,
    });

    // Mark player as ready for phase action
    await this.handlePlayerReady({
      ...payload,
      readyType: "phase_action",
    });

    // Check if this triggers a phase transition
    await this.checkForReadyPhaseTransition(payload.gameId, payload.roomId);
  }

  /**
   * Handle all players ready events (called by House plugin event handler)
   */
  async handleAllPlayersReadyEvent(
    payload: AllPlayersReadyPayload
  ): Promise<void> {
    await this.handleAllPlayersReady(payload);
  }

  /**
   * Handle timer expired events (called by House plugin event handler)
   */
  async handleTimerExpiredEvent(payload: TimerEventPayload): Promise<void> {
    await this.handleTimerExpired(payload);
  }

  /**
   * Initiate a coordinated phase transition
   */
  async initiatePhaseTransition(
    gameId: UUID,
    roomId: UUID,
    fromPhase: Phase,
    toPhase: Phase,
    round: number,
    transitionReason:
      | "timer_expired"
      | "manual"
      | "all_players_ready" = "manual"
  ): Promise<void> {
    try {
      logger.info(`Initiating phase transition: ${fromPhase} → ${toPhase}`, {
        gameId,
        roomId,
        round,
        transitionReason,
      });

      const requiresStrategicThinking = this.requiresStrategicThinking(
        fromPhase,
        toPhase
      );
      const requiresDiaryRoom = this.requiresDiaryRoom(fromPhase, toPhase);

      // Emit phase transition initiated event via coordination service
      const coordinationService = this.getCoordinationService();
      const payload: PhaseTransitionPayload = {
        gameId,
        roomId,
        fromPhase,
        toPhase,
        round,
        transitionReason,
        requiresStrategicThinking,
        requiresDiaryRoom,
        timestamp: Date.now(),
        runtime: this.runtime,
        source: "phase-coordinator",
      };

      if (coordinationService) {
        await coordinationService.sendGameEvent(
          GameEventType.PHASE_TRANSITION_INITIATED,
          payload
        );
      } else {
        // Fallback to local events
        await this.runtime.emitEvent(
          GameEventType.PHASE_TRANSITION_INITIATED,
          payload
        );
      }

      logger.info("Phase transition initiated successfully", {
        requiresStrategicThinking,
        requiresDiaryRoom,
      });
    } catch (error) {
      logger.error("Failed to initiate phase transition:", error);
      throw error;
    }
  }

  /**
   * Handle phase transition coordination
   */
  private async handlePhaseTransition(
    payload: PhaseTransitionPayload
  ): Promise<void> {
    const {
      gameId,
      roomId,
      fromPhase,
      toPhase,
      round,
      requiresStrategicThinking,
      requiresDiaryRoom,
    } = payload;

    try {
      // 1. End current phase
      await this.emitGameEvent(GameEventType.PHASE_ENDED, {
        gameId,
        roomId,
        phase: fromPhase,
        round,
        previousPhase: fromPhase,
        timestamp: Date.now(),
        runtime: this.runtime,
        source: "phase-coordinator",
      });
      logger.info(`Phase ${fromPhase} ended`);

      // 2. Strategic thinking phase if required
      if (requiresStrategicThinking) {
        await this.coordinateStrategicThinking(
          gameId,
          roomId,
          fromPhase,
          toPhase
        );
      }

      // 3. Diary room phase if required
      if (requiresDiaryRoom) {
        await this.coordinateDiaryRoom(gameId, roomId);
      }

      // 4. Start next phase
      await this.startNextPhase(gameId, roomId, toPhase, round);
    } catch (error) {
      logger.error("Error in phase transition coordination:", error);
      throw error;
    }
  }

  /**
   * Coordinate strategic thinking phase
   */
  private async coordinateStrategicThinking(
    gameId: UUID,
    roomId: UUID,
    fromPhase: Phase,
    toPhase: Phase
  ): Promise<void> {
    logger.info("Coordinating strategic thinking phase");

    // Get current game state to identify players
    const gameState = await getGameState(this.runtime, roomId);
    if (!gameState) {
      throw new Error("Game state not found");
    }

    // Trigger strategic thinking for all alive players
    const alivePlayers = Array.from(gameState.players.values()).filter(
      (p) => p.status === "alive"
    );

    for (const player of alivePlayers) {

      // Emit the event via coordination service
      const coordinationService = this.getCoordinationService();
      const payload = {
        gameId,
        roomId,
        playerId: player.id as UUID,
        playerName: player.name,
        fromPhase,
        toPhase,
        contextData: {
          currentPhase: fromPhase,
          nextPhase: toPhase,
          round: gameState.round,
          lobbyConversations: [],
          recentInteractions: [],
          currentRelationships: {},
        },
        timestamp: Date.now(),
        runtime: this.runtime,
        source: "phase-coordinator",
      };

      if (coordinationService) {
        await coordinationService.sendGameEvent(
          GameEventType.STRATEGIC_THINKING_REQUIRED,
          payload
        );
      } else {
        // Fallback to local events
        await this.runtime.emitEvent(
          GameEventType.STRATEGIC_THINKING_REQUIRED,
          payload
        );
      }

    }

    // Wait for all players to complete strategic thinking
    await this.waitForPlayersReady(
      gameId,
      roomId,
      "strategic_thinking",
      alivePlayers.length
    );
    logger.info("Strategic thinking phase completed");
  }

  /**
   * Coordinate diary room phase
   */
  private async coordinateDiaryRoom(gameId: UUID, roomId: UUID): Promise<void> {
    logger.info("Coordinating diary room phase");

    // Emit diary room opened event via coordination service
    await this.emitGameEvent(GameEventType.DIARY_ROOM_OPENED, {
      gameId,
      roomId,
      timestamp: Date.now(),
      runtime: this.runtime,
      source: "phase-coordinator",
    });

    // Get current game state to identify players
    const gameState = await getGameState(this.runtime, roomId);
    if (!gameState) {
      throw new Error("Game state not found");
    }

    const alivePlayers = Array.from(gameState.players.values()).filter(
      (p) => p.status === "alive"
    );

    // Wait for all players to complete diary room entries
    await this.waitForPlayersReady(
      gameId,
      roomId,
      "diary_room",
      alivePlayers.length
    );
    logger.info("Diary room phase completed");
  }

  /**
   * Start the next phase
   */
  private async startNextPhase(
    gameId: UUID,
    roomId: UUID,
    phase: Phase,
    round: number
  ): Promise<void> {
    logger.info(`Starting phase ${phase}`);

    // Update game state
    const gameState = await getGameState(this.runtime, roomId);
    if (gameState) {
      gameState.phase = phase;
      gameState.round = round;

      // Set timer for the new phase
      const phaseTimer =
        gameState.settings.timers[
          phase.toLowerCase() as keyof typeof gameState.settings.timers
        ];
      gameState.timerEndsAt = Date.now() + phaseTimer;

      await saveGameState(this.runtime, roomId, gameState);
    }

    // Emit phase started event via coordination service
    await this.emitGameEvent(GameEventType.PHASE_STARTED, {
      gameId,
      roomId,
      phase,
      round,
      timerEndsAt: gameState?.timerEndsAt,
      timestamp: Date.now(),
      runtime: this.runtime,
      source: "phase-coordinator",
    });
    logger.info(`Phase ${phase} started successfully`);
  }

  /**
   * Handle player ready events
   */
  private async handlePlayerReady(payload: PlayerReadyPayload): Promise<void> {
    const { gameId, roomId, playerId, playerName, readyType } = payload;
    const readyKey = `${gameId}:${roomId}:${readyType}`;

    logger.info(`Player ${playerName} ready for ${readyType}`, {
      gameId,
      roomId,
      playerId,
    });

    // Initialize readiness tracking for this context if needed
    if (!this.playerReadiness.has(readyKey)) {
      this.playerReadiness.set(readyKey, new Map());
    }

    // Mark player as ready
    const readyMap = this.playerReadiness.get(readyKey)!;
    readyMap.set(playerId, {
      playerId,
      playerName,
      readyType,
      readyAt: Date.now(),
      additionalData: payload.additionalData,
    });

    logger.debug(
      `Player readiness updated: ${readyMap.size} players ready for ${readyType}`
    );

    // Check if all players are ready (this will be checked by waitForPlayersReady)
    // No need to emit ALL_PLAYERS_READY here as it's handled by the waiting mechanism
  }

  /**
   * Wait for all players to be ready for a specific activity
   */
  private async waitForPlayersReady(
    gameId: UUID,
    roomId: UUID,
    readyType: "strategic_thinking" | "diary_room" | "phase_action",
    expectedPlayerCount: number,
    timeoutMs: number = 300000 // 5 minutes default timeout
  ): Promise<void> {
    const readyKey = `${gameId}:${roomId}:${readyType}`;

    logger.info(
      `Waiting for ${expectedPlayerCount} players to be ready for ${readyType}`
    );

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const readyMap = this.playerReadiness.get(readyKey);
        const readyCount = readyMap?.size || 0;

        logger.debug(
          `Ready check: ${readyCount}/${expectedPlayerCount} players ready for ${readyType}`
        );

        if (readyCount >= expectedPlayerCount) {
          clearInterval(checkInterval);
          clearTimeout(timeoutTimer);

          // Emit all players ready event
          const readyPlayers = Array.from(readyMap!.values()).map((state) => ({
            playerId: state.playerId,
            playerName: state.playerName,
            readyAt: state.readyAt,
          }));

          this.emitGameEvent(GameEventType.ALL_PLAYERS_READY, {
            gameId,
            roomId,
            readyType,
            playerCount: expectedPlayerCount,
            readyPlayers,
            timestamp: Date.now(),
            runtime: this.runtime,
            source: "phase-coordinator",
          });

          // Clean up readiness tracking for this context
          this.playerReadiness.delete(readyKey);

          logger.info(
            `All ${expectedPlayerCount} players ready for ${readyType}`
          );
          resolve();
        }
      }, 1000); // Check every second

      // Set timeout
      const timeoutTimer = setTimeout(() => {
        clearInterval(checkInterval);
        const readyCount = this.playerReadiness.get(readyKey)?.size || 0;
        logger.warn(
          `Timeout waiting for players: ${readyCount}/${expectedPlayerCount} ready for ${readyType}`
        );

        // Clean up
        this.playerReadiness.delete(readyKey);

        reject(
          new Error(
            `Timeout: Only ${readyCount}/${expectedPlayerCount} players ready for ${readyType}`
          )
        );
      }, timeoutMs);
    });
  }

  /**
   * Determine if strategic thinking is required for this phase transition
   */
  private requiresStrategicThinking(fromPhase: Phase, toPhase: Phase): boolean {
    // Strategic thinking required when transitioning from LOBBY to WHISPER
    return fromPhase === Phase.LOBBY && toPhase === Phase.WHISPER;
  }

  /**
   * Determine if diary room is required for this phase transition
   */
  private requiresDiaryRoom(fromPhase: Phase, toPhase: Phase): boolean {
    // Diary room required when transitioning from LOBBY to WHISPER
    return fromPhase === Phase.LOBBY && toPhase === Phase.WHISPER;
  }

  /**
   * Check if all players are ready and trigger phase transition if appropriate
   */
  private async checkForReadyPhaseTransition(
    gameId: UUID,
    roomId: UUID
  ): Promise<void> {
    try {
      const gameState = await getGameState(this.runtime, roomId);
      if (!gameState || !gameState.isActive) {
        return;
      }

      const alivePlayers = Array.from(gameState.players.values()).filter(
        (p: any) => p.status === "ALIVE"
      );
      const expectedPlayerCount = alivePlayers.length;

      const readyKey = `${gameId}:${roomId}:phase_action`;
      const readyMap = this.playerReadiness.get(readyKey);

      if (!readyMap) {
        logger.debug("No readiness tracking found for this context");
        return;
      }

      const readyCount = readyMap.size;
      logger.debug(
        `Ready check: ${readyCount}/${expectedPlayerCount} players ready for phase action`
      );

      // Check if all alive players are ready
      if (readyCount >= expectedPlayerCount) {
        logger.info(
          `All players ready for phase action, triggering transition`,
          {
            gameId,
            roomId,
            readyCount,
            expectedCount: expectedPlayerCount,
            currentPhase: gameState.phase,
          }
        );

        // Clear readiness tracking for this context
        this.playerReadiness.delete(readyKey);

        // Determine next phase based on current phase
        const nextPhase = this.determineNextPhaseForReady(gameState.phase);
        if (nextPhase) {
          await this.initiatePhaseTransition(
            gameId,
            roomId,
            gameState.phase,
            nextPhase,
            gameState.round,
            "all_players_ready"
          );
        }
      }
    } catch (error) {
      logger.error("Error checking for ready phase transition:", error);
    }
  }

  /**
   * Determine next phase when all players are ready
   */
  private determineNextPhaseForReady(currentPhase: Phase): Phase | null {
    switch (currentPhase) {
      case Phase.INTRODUCTION:
        return Phase.LOBBY;
      case Phase.LOBBY:
        return Phase.WHISPER;
      default:
        logger.warn(
          `No automatic transition configured for phase: ${currentPhase}`
        );
        return null;
    }
  }

  /**
   * Handle all players ready event processing
   */
  private async handleAllPlayersReady(
    payload: AllPlayersReadyPayload
  ): Promise<void> {
    logger.info(`All players ready for ${payload.readyType}`, {
      gameId: payload.gameId,
      playerCount: payload.playerCount,
    });

    // Continue with the next step in phase transition
    // This would trigger diary room or phase completion based on context
  }

  /**
   * Handle timer expired event processing
   */
  private async handleTimerExpired(payload: TimerEventPayload): Promise<void> {
    logger.info(`Timer expired for phase ${payload.phase}`, {
      gameId: payload.gameId,
      round: payload.round,
    });

    // Trigger automatic phase transition
    // Implementation would determine next phase based on current phase
  }

  /**
   * Get current player readiness statistics
   */
  getReadinessStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [key, readyMap] of this.playerReadiness) {
      stats[key] = readyMap.size;
    }
    return stats;
  }

  /**
   * Clear all readiness tracking (useful for testing)
   */
  clearReadinessTracking(): void {
    this.playerReadiness.clear();
    logger.debug("Cleared all player readiness tracking");
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear all timers
    for (const timer of this.transitionTimers.values()) {
      clearTimeout(timer);
    }
    this.transitionTimers.clear();

    // Clear readiness tracking
    this.clearReadinessTracking();

    logger.info("PhaseCoordinator cleanup completed");
  }
}
