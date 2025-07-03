import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  type UUID,
} from "@elizaos/core";
import { getGameState } from "../runtime/memory";
import { Phase } from "../types";
import { PhaseCoordinator } from "../services/phaseCoordinator";
import { CoordinationService } from "../coordination";

const logger = elizaLogger.child({ component: "PhaseTimerEvaluator" });

/**
 * Evaluator that monitors game phase timers and triggers automated phase transitions
 * when timers expire. This provides the "hard" synchronization mechanism for the game.
 */
export const phaseTimerEvaluator: Evaluator = {
  name: "PHASE_TIMER",
  description: "Monitors game timers and triggers automated phase transitions when timers expire",
  
  // Run this evaluator frequently to check timers
  alwaysRun: true,
  examples: [],
  
  async validate(): Promise<boolean> {
    return true; // Always run for House agents
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> {
    try {
      // Only run for House agents
      if (!runtime.character?.name?.toLowerCase().includes("house")) {
        return false;
      }

      // Get current game state
      const gameState = await getGameState(runtime, message.roomId);
      if (!gameState || !gameState.isActive) {
        return false;
      }

      // Check if we have a timer set
      if (!gameState.timerEndsAt) {
        return false;
      }

      const currentTime = Date.now();
      const timeRemaining = gameState.timerEndsAt - currentTime;

      // Log timer status occasionally for debugging
      if (Math.random() < 0.01) { // Log ~1% of the time to avoid spam
        logger.debug("Timer check", {
          phase: gameState.phase,
          round: gameState.round,
          timeRemaining: Math.round(timeRemaining / 1000) + "s",
          timerEndsAt: new Date(gameState.timerEndsAt).toISOString()
        });
      }

      // Emit warnings at specific intervals
      await this.checkAndEmitWarnings(runtime, message.roomId, gameState, timeRemaining);

      // Check if timer has expired
      if (timeRemaining <= 0) {
        logger.info(`Timer expired for phase ${gameState.phase}`, {
          gameId: gameState.id,
          roomId: message.roomId,
          phase: gameState.phase,
          round: gameState.round,
          expiredBy: Math.abs(timeRemaining)
        });

        await this.handleTimerExpiry(runtime, message.roomId, gameState);
        return true; // Indicate that we took action
      }

      return false;
    } catch (error) {
      logger.error("Error in phase timer evaluator:", error);
      return false;
    }
  }
};

/**
 * Check for warning thresholds and emit warning events
 */
async function checkAndEmitWarnings(
  runtime: IAgentRuntime,
  roomId: UUID,
  gameState: any,
  timeRemaining: number
): Promise<void> {
  const coordinator = runtime.getService("phase-coordinator") as PhaseCoordinator | null;
  if (!coordinator) {
    return;
  }

  // Use runtime directly for native ElizaOS events
  
  // Warning thresholds in milliseconds
  const warnings = [
    { threshold: 5 * 60 * 1000, type: "five_minutes" as const },
    { threshold: 1 * 60 * 1000, type: "one_minute" as const },
    { threshold: 30 * 1000, type: "thirty_seconds" as const }
  ];

  for (const warning of warnings) {
    // Check if we're within the warning threshold (with a small buffer to avoid duplicate warnings)
    if (timeRemaining <= warning.threshold && timeRemaining > warning.threshold - 5000) {
      logger.info(`Timer warning: ${warning.type} remaining for phase ${gameState.phase}`, {
        gameId: gameState.id,
        roomId,
        phase: gameState.phase,
        timeRemaining: Math.round(timeRemaining / 1000)
      });

      // Emit via coordination service if available, otherwise fallback to local events
      const coordinationService = runtime.getService("coordination") as CoordinationService | null;
      const warningPayload = {
        gameId: gameState.id,
        roomId,
        phase: gameState.phase,
        round: gameState.round,
        timeRemaining: Math.round(timeRemaining),
        timerEndsAt: gameState.timerEndsAt,
        warningType: warning.type,
        timestamp: Date.now()
      };

      if (coordinationService) {
        await coordinationService.sendGameEvent("GAME:TIMER_WARNING" as any, warningPayload);
      } else {
        await runtime.emitEvent("GAME:TIMER_WARNING", warningPayload);
      }

      break; // Only emit one warning per check
    }
  }
}

/**
 * Handle timer expiry by triggering phase transition
 */
async function handleTimerExpiry(
  runtime: IAgentRuntime,
  roomId: UUID,
  gameState: any
): Promise<void> {
  try {
    const coordinator = runtime.getService("phase-coordinator") as PhaseCoordinator | null;
    if (!coordinator) {
      logger.error("PhaseCoordinator service not found");
      return;
    }

    // Emit timer expired event via coordination service if available
    const coordinationService = runtime.getService("coordination") as CoordinationService | null;
    const expiredPayload = {
      gameId: gameState.id,
      roomId,
      phase: gameState.phase,
      round: gameState.round,
      timeRemaining: 0,
      timerEndsAt: gameState.timerEndsAt,
      timestamp: Date.now()
    };

    if (coordinationService) {
      await coordinationService.sendGameEvent("GAME:TIMER_EXPIRED" as any, expiredPayload);
    } else {
      await runtime.emitEvent("GAME:TIMER_EXPIRED", expiredPayload);
    }

    // Determine next phase
    const nextPhase = determineNextPhase(gameState.phase, gameState);
    if (!nextPhase) {
      logger.warn(`No next phase determined for current phase ${gameState.phase}`);
      return;
    }

    const nextRound = shouldIncrementRound(gameState.phase, nextPhase.phase) 
      ? gameState.round + 1 
      : gameState.round;

    logger.info(`Triggering automatic phase transition: ${gameState.phase} → ${nextPhase.phase}`, {
      gameId: gameState.id,
      roomId,
      currentRound: gameState.round,
      nextRound,
      reason: "timer_expired"
    });

    // Initiate coordinated phase transition  
    await coordinator.initiatePhaseTransition(
      gameState.id,
      roomId,
      gameState.phase,
      nextPhase.phase,
      nextRound,
      'timer_expired'
    );

  } catch (error) {
    logger.error("Error handling timer expiry:", error);
    throw error;
  }
}

/**
 * Determine the next phase in the game flow
 */
function determineNextPhase(currentPhase: Phase, gameState: any): { phase: Phase } | null {
  switch (currentPhase) {
    case Phase.INIT:
      return null; // INIT should not have automated transitions
      
    case Phase.INTRODUCTION:
      return { phase: Phase.LOBBY };
      
    case Phase.LOBBY:
      return { phase: Phase.WHISPER };
      
    case Phase.WHISPER:
      return { phase: Phase.RUMOR };
      
    case Phase.RUMOR:
      return { phase: Phase.VOTE };
      
    case Phase.VOTE:
      return { phase: Phase.POWER };
      
    case Phase.POWER:
      return { phase: Phase.REVEAL };
      
    case Phase.REVEAL:
      // Check if game should end
      const alivePlayers = Array.from(gameState.players.values()).filter(
        (p: any) => p.status === "ALIVE"
      );
      
      if (alivePlayers.length <= 1) {
        // Game ends
        return null;
      } else {
        // Start next round
        return { phase: Phase.LOBBY };
      }
      
    default:
      logger.warn(`Unknown phase for transition: ${currentPhase}`);
      return null;
  }
}

/**
 * Determine if the round number should increment for this phase transition
 */
function shouldIncrementRound(currentPhase: Phase, nextPhase: Phase): boolean {
  // Round increments when we go from REVEAL back to LOBBY (new round)
  return currentPhase === Phase.REVEAL && nextPhase === Phase.LOBBY;
}