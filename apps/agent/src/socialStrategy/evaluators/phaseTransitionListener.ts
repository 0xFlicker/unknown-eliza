import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  stringToUuid,
} from "@elizaos/core";
import { GameEventType } from "../../house/events/types";

const logger = elizaLogger.child({ component: "PhaseTransitionListener" });

/**
 * Evaluator that listens for game events and triggers appropriate strategic actions
 * This bridges the event system with the agent's action system
 */
export const phaseTransitionListenerEvaluator: Evaluator = {
  name: "PHASE_TRANSITION_LISTENER",
  description: "Listens for game events and triggers strategic actions",
  
  // Run this evaluator when triggered by events
  alwaysRun: false,
  examples: [],
  
  async validate(): Promise<boolean> {
    return true; // Always validate for game event processing
  },

  async handler(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> {
    try {
      // Skip for House agents
      if (runtime.character?.name?.toLowerCase().includes("house")) {
        return false;
      }

      // Check if this is a game event message
      if (!isGameEventMessage(message)) {
        return false;
      }

      const eventType = extractEventType(message);
      if (!eventType) {
        return false;
      }

      logger.debug(`Processing game event: ${eventType}`, {
        agentName: runtime.character?.name,
        messageId: message.id
      });

      switch (eventType) {
        case GameEventType.STRATEGIC_THINKING_REQUIRED:
          return await handleStrategicThinkingRequired(runtime, message, state);
          
        case GameEventType.DIARY_ROOM_OPENED:
          return await handleDiaryRoomOpened(runtime, message, state);
          
        case GameEventType.PHASE_STARTED:
          return await handlePhaseStarted(runtime, message, state);
          
        case GameEventType.TIMER_WARNING:
          return await handleTimerWarning(runtime, message, state);
          
        default:
          // Log unhandled events for debugging
          logger.debug(`Unhandled game event: ${eventType}`, {
            agentName: runtime.character?.name
          });
          return false;
      }

    } catch (error) {
      logger.error("Error in phase transition listener:", error);
      return false;
    }
  }
};

/**
 * Check if a message is a game event
 */
function isGameEventMessage(message: Memory): boolean {
  if (message.content?.text?.startsWith("GAME:") === true) {
    return true;
  }
  
  if (message.content.metadata && typeof message.content.metadata === 'object') {
    const metadata = message.content.metadata as Record<string, unknown>;
    return typeof metadata.eventType === 'string' && metadata.eventType.startsWith("GAME:");
  }
  
  return false;
}

/**
 * Extract the event type from a game event message
 */
function extractEventType(message: Memory): GameEventType | null {
  try {
    // Try to extract from text content
    const text = message.content.text;
    if (text?.startsWith("GAME:")) {
      return text as GameEventType;
    }

    // Try to extract from metadata
    if (message.content.metadata && typeof message.content.metadata === 'object') {
      const metadata = message.content.metadata as Record<string, unknown>;
      const eventType = metadata.eventType;
      if (typeof eventType === 'string' && eventType.startsWith("GAME:")) {
        return eventType as GameEventType;
      }
    }

    return null;
  } catch (error) {
    logger.error("Error extracting event type:", error);
    return null;
  }
}

/**
 * Handle STRATEGIC_THINKING_REQUIRED event
 */
async function handleStrategicThinkingRequired(
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
): Promise<boolean> {
  try {
    logger.info(`${runtime.character?.name} received strategic thinking request`);

    // Extract context from the event message
    const context = extractEventContext(message);
    if (!context) {
      logger.warn("Could not extract strategic thinking context");
      return false;
    }

    // Create a synthetic message to trigger the phase transition thinking action
    const triggerMessage: Memory = {
      id: stringToUuid(`strategic-thinking-${Date.now()}`),
      entityId: runtime.agentId,
      roomId: message.roomId,
      content: {
        text: `STRATEGIC_THINKING_REQUIRED fromPhase:${context.fromPhase} toPhase:${context.toPhase} round:${context.round} gameId:${context.gameId}`,
        source: "game-event-system",
        inReplyTo: message.id
      },
      createdAt: Date.now()
    };

    // Run the phase transition thinking action
    const actions = runtime.plugins
      .flatMap(plugin => plugin.actions || [])
      .filter(action => action.name === "PHASE_TRANSITION_THINKING");

    if (actions.length === 0) {
      logger.warn("PHASE_TRANSITION_THINKING action not found");
      return false;
    }

    const action = actions[0];
    const isValid = await action.validate?.(runtime, triggerMessage, state);
    
    if (isValid) {
      const result = await action.handler(runtime, triggerMessage, state);
      logger.info(`Strategic thinking action completed: ${result}`);
      return true;
    } else {
      logger.warn("Strategic thinking action validation failed");
      return false;
    }

  } catch (error) {
    logger.error("Error handling strategic thinking required:", error);
    return false;
  }
}

/**
 * Handle DIARY_ROOM_OPENED event
 */
async function handleDiaryRoomOpened(
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
): Promise<boolean> {
  try {
    logger.info(`${runtime.character?.name} received diary room opened notification`);

    // For now, just log the event. In the future, this could trigger
    // automatic diary room entry actions
    logger.debug("Diary room is now available for strategic reflection");

    return true;
  } catch (error) {
    logger.error("Error handling diary room opened:", error);
    return false;
  }
}

/**
 * Handle PHASE_STARTED event
 */
async function handlePhaseStarted(
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
): Promise<boolean> {
  try {
    const context = extractEventContext(message);
    if (!context) {
      return false;
    }

    logger.info(`${runtime.character?.name} notified that ${context.phase} phase started`, {
      phase: context.phase,
      round: context.round
    });

    // Update the strategy service with the new phase
    const strategyService = runtime.getService("social-strategy") as any;
    if (strategyService && typeof strategyService.updateGamePhase === 'function') {
      await strategyService.updateGamePhase(context.phase, context.round);
    }

    return true;
  } catch (error) {
    logger.error("Error handling phase started:", error);
    return false;
  }
}

/**
 * Handle TIMER_WARNING event
 */
async function handleTimerWarning(
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
): Promise<boolean> {
  try {
    const context = extractEventContext(message);
    if (!context) {
      return false;
    }

    logger.info(`${runtime.character?.name} received timer warning`, {
      phase: context.phase,
      timeRemaining: context.timeRemaining,
      warningType: context.warningType
    });

    // Could trigger urgent strategic thinking or action completion here
    return true;
  } catch (error) {
    logger.error("Error handling timer warning:", error);
    return false;
  }
}

/**
 * Extract event context from game event message
 */
function extractEventContext(message: Memory): any {
  try {
    // Try to parse from message text
    const text = message.content.text || "";
    const context: any = {};

    // Extract common fields
    const patterns = {
      fromPhase: /fromPhase:\s*(\w+)/,
      toPhase: /toPhase:\s*(\w+)/,
      phase: /phase:\s*(\w+)/,
      round: /round:\s*(\d+)/,
      gameId: /gameId:\s*([\w-]+)/,
      timeRemaining: /timeRemaining:\s*(\d+)/,
      warningType: /warningType:\s*(\w+)/
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match) {
        context[key] = key === 'round' || key === 'timeRemaining' 
          ? parseInt(match[1]) 
          : match[1];
      }
    }

    // Try to get from metadata if available
    if (message.content.metadata) {
      Object.assign(context, message.content.metadata);
    }

    return Object.keys(context).length > 0 ? context : null;
  } catch (error) {
    logger.error("Error extracting event context:", error);
    return null;
  }
}