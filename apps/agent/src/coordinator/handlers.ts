import { type IAgentRuntime, type Memory, elizaLogger } from "@elizaos/core";
import { isCoordinationMessage, type AnyCoordinationMessage } from "./types";
import { shouldProcessMessage } from "./roles";
import { CoordinationService } from "./service";

const logger = elizaLogger.child({ component: "CoordinationHandlers" });

/**
 * MESSAGE_RECEIVED event handler for coordination messages
 */
export async function messageReceivedHandler({
  message,
  runtime,
}: {
  message: Memory;
  runtime: IAgentRuntime;
}): Promise<void> {
  console.log(
    `🔍 [${runtime.character?.name}] messageReceivedHandler called with message:`,
    {
      content: message.content?.text?.substring(0, 10),
      source: message.content?.source,
      agentId: runtime.agentId,
    }
  );

  // Get the coordination service to check the channel ID
  const coordinationService =
    runtime.getService<CoordinationService>("coordination");
  if (!coordinationService) {
    return; // No coordination service, skip
  }

  // Check if this message is from a coordination channel
  // We'll check if the message content looks like a coordination message
  // since we no longer use a hardcoded channel ID
  let isCoordinationChannel = false;

  // Also check if the message content looks like a coordination message
  let hasCoordinationFormat = false;
  if (message.content?.text) {
    try {
      const parsed = JSON.parse(message.content.text);
      hasCoordinationFormat =
        parsed.type &&
        ["game_event", "agent_ready", "heartbeat", "coordination_ack"].includes(
          parsed.type
        );
    } catch {
      // Not JSON, not a coordination message
    }
  }

  if (!isCoordinationChannel && !hasCoordinationFormat) {
    return;
  }

  // Don't process messages from ourselves
  // if (message.content.source === runtime.agentId) {
  //   return;
  // }

  // Must have text content
  if (!message.content.text) {
    return;
  }

  // Try to parse as coordination message
  try {
    const parsed = JSON.parse(message.content.text);
    const isValid = isCoordinationMessage(parsed);

    if (isValid) {
      const coordinationMessage = parsed as AnyCoordinationMessage;

      // Check if this message is targeted to us
      const isTargeted =
        coordinationMessage.targetAgents === "all" ||
        coordinationMessage.targetAgents === "others" ||
        (Array.isArray(coordinationMessage.targetAgents) &&
          coordinationMessage.targetAgents.includes(runtime.agentId));

      if (isTargeted && shouldProcessMessage(runtime, coordinationMessage)) {
        logger.info(
          `🔗 Agent ${runtime.character?.name} received coordination message`,
          {
            messageType: coordinationMessage.type,
            sourceAgent: coordinationMessage.sourceAgent,
            targetAgents: coordinationMessage.targetAgents,
          }
        );

        // Route to appropriate handler based on message type
        switch (coordinationMessage.type) {
          case "game_event":
            await handleGameEvent(runtime, coordinationMessage);
            break;

          case "agent_ready":
            await handleAgentReady(runtime, coordinationMessage);
            break;

          case "heartbeat":
            await handleHeartbeat(runtime, coordinationMessage);
            break;

          case "coordination_ack":
            await handleCoordinationAck(runtime, coordinationMessage);
            break;

          default:
            logger.warn(
              `Unknown coordination message type: ${(coordinationMessage as any).type}`
            );
        }
      }
    }
  } catch (error) {
    // Not a valid JSON coordination message, ignore silently
    return;
  }
}

/**
 * Handle game event coordination messages
 */
async function handleGameEvent(
  runtime: IAgentRuntime,
  message: Extract<AnyCoordinationMessage, { type: "game_event" }>
): Promise<void> {
  const { gameEventType, payload } = message;

  logger.info(
    `Handling game event: ${gameEventType} for ${runtime.character?.name}`,
    {
      sourceAgent: message.sourceAgent,
      gameEventType,
    }
  );

  // Emit the game event locally in this agent's runtime
  await runtime.emitEvent(gameEventType, {
    ...payload,
    runtime,
    source: runtime.agentId,
    onComplete: () => {},
  });
}

/**
 * Handle agent ready coordination messages
 */
async function handleAgentReady(
  runtime: IAgentRuntime,
  message: Extract<AnyCoordinationMessage, { type: "agent_ready" }>
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
  await runtime.emitEvent("AGENT_READY", payload);
}

/**
 * Handle heartbeat coordination messages
 */
async function handleHeartbeat(
  runtime: IAgentRuntime,
  message: Extract<AnyCoordinationMessage, { type: "heartbeat" }>
): Promise<void> {
  logger.debug(`Heartbeat received from ${message.sourceAgent}`, {
    agentName: message.payload.agentName,
    status: message.payload.status,
  });
}

/**
 * Handle coordination acknowledgment messages
 */
async function handleCoordinationAck(
  runtime: IAgentRuntime,
  message: Extract<AnyCoordinationMessage, { type: "coordination_ack" }>
): Promise<void> {
  logger.debug(`Coordination ack received from ${message.sourceAgent}`, {
    originalMessageId: message.payload.originalMessageId,
    status: message.payload.status,
  });
}
