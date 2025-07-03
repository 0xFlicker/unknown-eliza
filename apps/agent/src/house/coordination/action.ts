import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  type UUID,
  stringToUuid,
} from "@elizaos/core";
import {
  COORDINATION_CHANNEL_ID,
  isCoordinationMessage,
  isGameEventCoordinationMessage,
  isAgentReadyCoordinationMessage,
  type AnyCoordinationMessage,
  type GameEventCoordinationMessage,
  type AgentReadyCoordinationMessage,
  CoordinationAckMessage,
  HeartbeatCoordinationMessage,
} from "./types";
import { GameEventType, PlayerReadyPayload } from "../events/types";
import { PhaseCoordinator } from "../services/phaseCoordinator";

const logger = elizaLogger.child({ component: "CoordinationAction" });

/**
 * Handle game event coordination messages
 */
export async function handleGameEvent(
  runtime: IAgentRuntime,
  message: GameEventCoordinationMessage
): Promise<void> {
  const { gameEventType, payload } = message;

  logger.info(
    `Handling game event: ${gameEventType} for ${runtime.character?.name}`,
    {
      sourceAgent: message.sourceAgent,
      gameEventType,
    }
  );

  // Emit the game event locally in this agent's runtime for any event handlers
  await runtime.emitEvent(gameEventType, payload);

  // Special handling for specific game events that need to trigger actions
  switch (gameEventType) {
    case GameEventType.STRATEGIC_THINKING_REQUIRED:
      logger.debug(
        `Strategic thinking required for ${runtime.character?.name}`
      );
      // Create a synthetic message to trigger the phaseTransitionThinkingAction
      await createSyntheticMessage(runtime, gameEventType, payload);
      break;

    case GameEventType.PHASE_TRANSITION_INITIATED:
      logger.debug(`Phase transition initiated for ${runtime.character?.name}`);
      // Local event handlers will process this
      break;

    case GameEventType.PHASE_STARTED:
      logger.debug(`Phase started for ${runtime.character?.name}`);
      // Create a synthetic message to trigger actions like introductionResponseAction
      await createSyntheticMessage(runtime, gameEventType, payload);
      break;

    case GameEventType.I_AM_READY:
      logger.debug(`I_AM_READY signal received for ${runtime.character?.name}`);

      // Route to PhaseCoordinator if this is a House agent
      // WHAT THE FUCK IS THIS? YOU THINK ANY AGENT WITH HOUSE IN THEIR NAME IS A HOUSE AGENT?
      if (runtime.character?.name?.toLowerCase().includes("house")) {
        const coordinator = runtime.getService(
          "phase-coordinator"
        ) as PhaseCoordinator | null;
        if (coordinator) {
          await coordinator.handleIAmReadyEvent(payload as PlayerReadyPayload);
        }
      }
      break;

    default:
      logger.debug(`Generic game event handled: ${gameEventType}`);
  }
}

/**
 * Handle agent ready coordination messages
 */
export async function handleAgentReady(
  runtime: IAgentRuntime,
  message: AgentReadyCoordinationMessage
): Promise<void> {
  const { payload } = message;

  logger.info(
    `Agent ready signal received: ${payload.playerName} for ${payload.readyType}`,
    {
      sourceAgent: message.sourceAgent,
      readyType: payload.readyType,
      gameId: payload.gameId,
    }
  );

  // Emit local event for this agent ready signal
  await runtime.emitEvent(GameEventType.PLAYER_READY, payload);
}

/**
 * Handle heartbeat coordination messages
 */
export async function handleHeartbeat(
  runtime: IAgentRuntime,
  message: HeartbeatCoordinationMessage
): Promise<void> {
  logger.debug(`Heartbeat received from ${message.sourceAgent}`, {
    agentName: message.payload.agentName,
    status: message.payload.status,
  });
}

/**
 * Handle coordination acknowledgment messages
 */
export async function handleCoordinationAck(
  runtime: IAgentRuntime,
  message: CoordinationAckMessage
): Promise<void> {
  logger.debug(`Coordination ack received from ${message.sourceAgent}`, {
    originalMessageId: message.payload.originalMessageId,
    status: message.payload.status,
  });

  // Could track message delivery status here
}

/**
 * Create a synthetic message to trigger actions that expect specific text patterns
 */
export async function createSyntheticMessage(
  runtime: IAgentRuntime,
  gameEventType: string,
  payload: any
): Promise<void> {
  try {
    let messageText = "";

    // Create text content that matches what actions expect
    switch (gameEventType) {
      case GameEventType.STRATEGIC_THINKING_REQUIRED:
        messageText = `STRATEGIC_THINKING_REQUIRED fromPhase:${payload.fromPhase} toPhase:${payload.toPhase} round:${payload.round || 1} gameId:${payload.gameId}`;
        break;

      default:
        logger.debug(`No synthetic message needed for event: ${gameEventType}`);
        return;
    }

    // Create synthetic memory message
    const syntheticMessage: Memory = {
      id: stringToUuid(`synthetic-${gameEventType}-${Date.now()}`),
      entityId: runtime.agentId,
      roomId: payload.roomId,
      content: {
        text: messageText,
        source: "coordination-system",
        metadata: {
          eventType: gameEventType,
          originalPayload: payload,
          synthetic: true,
        },
      },
      createdAt: Date.now(),
    };

    // Compose game state
    const gameState = await runtime.composeState(syntheticMessage, [
      "GAME_STATE",
    ]);

    // Process the message through the runtime's action system
    await runtime.processActions(syntheticMessage, [], gameState);

    logger.debug(`Created synthetic message for ${gameEventType}`, {
      messageText,
      agentName: runtime.character?.name,
    });
  } catch (error) {
    logger.error("Error creating synthetic message:", error);
  }
}
