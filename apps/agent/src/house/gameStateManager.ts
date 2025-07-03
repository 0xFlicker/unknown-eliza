import { IAgentRuntime, UUID, createUniqueUuid } from "@elizaos/core";
import { PhaseCoordinator } from "./services/phaseCoordinator";
import { GameEventType } from "./events/types";
import { Phase } from "./types";
import { getGameState, saveGameState } from "./runtime/memory";

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
    playerName: string
  ): Promise<void> {
    try {
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

      console.log(
        `🎮 Player ${playerName} joined - emitted PLAYER_READY event`
      );
    } catch (error) {
      console.error("Error handling player join:", error);
    }
  }

  /**
   * Handle game start request
   * Triggers a coordinated phase transition from INIT to LOBBY via PhaseCoordinator
   */
  async handleGameStart(roomId: UUID): Promise<void> {
    try {
      const gameState = await getGameState(this.runtime, roomId);
      if (!gameState) {
        console.warn("No game state found when trying to start game");
        return;
      }

      if (gameState.phase !== Phase.INIT) {
        console.warn(
          `Game already started - current phase: ${gameState.phase}`
        );
        return;
      }

      if (gameState.players.size < gameState.settings.minPlayers) {
        console.warn(
          `Not enough players: ${gameState.players.size}/${gameState.settings.minPlayers}`
        );
        return;
      }

      // Use PhaseCoordinator to properly handle the phase transition
      const coordinator = this.runtime.getService<PhaseCoordinator>(
        PhaseCoordinator.serviceType
      );
      if (!coordinator) {
        console.error("PhaseCoordinator service not found");
        return;
      }

      const gameId = createUniqueUuid(this.runtime, roomId);

      console.log(
        `🎮 Starting game: ${gameState.players.size} players, transitioning INIT → INTRODUCTION`
      );

      // Let PhaseCoordinator handle the full transition with proper timing and events
      await coordinator.initiatePhaseTransition(
        gameId,
        roomId,
        Phase.INIT,
        Phase.INTRODUCTION,
        1, // First round
        "manual"
      );

      console.log(`🎮 Game start initiated via PhaseCoordinator`);
    } catch (error) {
      console.error("Error handling game start:", error);
    }
  }

  /**
   * Handle player ready for phase action
   * Used when players complete phase-specific actions
   */
  async handlePlayerReady(
    roomId: UUID,
    playerId: UUID,
    playerName: string,
    readyType: "strategic_thinking" | "diary_room" | "phase_action"
  ): Promise<void> {
    try {
      const coordinator = this.runtime.getService<PhaseCoordinator>(
        PhaseCoordinator.serviceType
      );
      if (!coordinator) {
        console.error("PhaseCoordinator service not found");
        return;
      }

      const gameId = createUniqueUuid(this.runtime, roomId);

      // Use PhaseCoordinator's proper player ready handling
      await coordinator.handlePlayerReadyEvent({
        gameId,
        roomId,
        playerId,
        playerName,
        readyType,
        timestamp: Date.now(),
        runtime: this.runtime,
        source: "gameStateManager",
      });

      console.log(`🎮 Player ${playerName} ready for ${readyType}`);
    } catch (error) {
      console.error("Error handling player ready:", error);
    }
  }

  /**
   * Trigger manual phase transition (for testing or admin commands)
   */
  async triggerPhaseTransition(
    roomId: UUID,
    fromPhase: Phase,
    toPhase: Phase,
    reason: "manual" | "timer_expired" | "all_players_ready" = "manual"
  ): Promise<void> {
    try {
      const gameState = await getGameState(this.runtime, roomId);
      if (!gameState) {
        console.warn("No game state found for manual phase transition");
        return;
      }

      const coordinator = this.runtime.getService<PhaseCoordinator>(
        PhaseCoordinator.serviceType
      );
      if (!coordinator) {
        console.error("PhaseCoordinator service not found");
        return;
      }

      const gameId = createUniqueUuid(this.runtime, roomId);

      console.log(`🎮 Manual phase transition: ${fromPhase} → ${toPhase}`);

      await coordinator.initiatePhaseTransition(
        gameId,
        roomId,
        fromPhase,
        toPhase,
        gameState.round,
        reason
      );

      console.log(`🎮 Phase transition completed via PhaseCoordinator`);
    } catch (error) {
      console.error("Error in manual phase transition:", error);
    }
  }
}
