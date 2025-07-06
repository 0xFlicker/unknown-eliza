import type { UUID } from "@elizaos/core";
import type { GameEventType, GameEventPayloadMap } from "../events/types";

/**
 * Coordination message protocol for cross-agent communication
 * Uses existing AgentServer message bus via special coordination channels
 */

/**
 * Special channel identifier for game coordination messages
 * Using a predictable UUID that won't conflict with real channels
 */
export const COORDINATION_CHANNEL_ID =
  "00000000-0000-0000-0000-000000000001" as UUID;

/**
 * Base coordination message interface with common fields
 */
export interface BaseCoordinationMessage {
  /** Message protocol version */
  version: "1.0";

  /** Source agent ID */
  sourceAgent: UUID;

  /** Target agents - 'all', 'others', or specific agent IDs */
  targetAgents: UUID[] | "all" | "others";

  /** Unique message ID for deduplication */
  messageId: UUID;

  /** Timestamp */
  timestamp: number;

  /** Optional correlation ID for request/response patterns */
  correlationId?: UUID;
}

/**
 * Game event coordination message - most common type
 */
export interface GameEventCoordinationMessage<
  T extends keyof GameEventPayloadMap = keyof GameEventPayloadMap,
> extends BaseCoordinationMessage {
  type: "game_event";
  gameEventType: T;
  payload: GameEventPayloadMap[T];
}

/**
 * Agent readiness message - signals completion of tasks
 */
export interface AgentReadyCoordinationMessage extends BaseCoordinationMessage {
  type: "agent_ready";
  payload: {
    readyType: "strategic_thinking" | "diary_room" | "phase_action";
    gameId: UUID;
    roomId: UUID;
    playerId: UUID;
    playerName: string;
    additionalData?: Record<string, unknown>;
  };
}

/**
 * Heartbeat message - for presence detection
 */
export interface HeartbeatCoordinationMessage extends BaseCoordinationMessage {
  type: "heartbeat";
  payload: {
    agentName: string;
    agentType: "house" | "player";
    status: "active" | "idle" | "busy";
  };
}

/**
 * Acknowledgment message - confirms receipt of coordination messages
 */
export interface CoordinationAckMessage extends BaseCoordinationMessage {
  type: "coordination_ack";
  payload: {
    originalMessageId: UUID;
    status: "received" | "processed" | "error";
    error?: string;
  };
}

/**
 * Union type for all coordination message types
 */
export type AnyCoordinationMessage =
  | GameEventCoordinationMessage
  | AgentReadyCoordinationMessage
  | HeartbeatCoordinationMessage
  | CoordinationAckMessage;

/**
 * Helper to create a game event coordination message
 */
export function createGameEventMessage<T extends keyof GameEventPayloadMap>(
  sourceAgent: UUID,
  gameEventType: T,
  payload: GameEventPayloadMap[T],
  targetAgents: UUID[] | "all" | "others" = "others",
  correlationId?: UUID
): GameEventCoordinationMessage<T> {
  return {
    version: "1.0",
    type: "game_event",
    gameEventType,
    payload,
    sourceAgent,
    targetAgents,
    messageId: crypto.randomUUID() as UUID,
    timestamp: Date.now(),
    correlationId,
  };
}

/**
 * Helper to create an agent ready message
 */
export function createAgentReadyMessage(
  sourceAgent: UUID,
  readyData: AgentReadyCoordinationMessage["payload"],
  correlationId?: UUID
): AgentReadyCoordinationMessage {
  return {
    version: "1.0",
    type: "agent_ready",
    payload: readyData,
    sourceAgent,
    targetAgents: "others", // Ready messages typically go to coordinators
    messageId: crypto.randomUUID() as UUID,
    timestamp: Date.now(),
    correlationId,
  };
}

/**
 * Type guard for coordination messages
 */
export function isCoordinationMessage(obj: any): obj is AnyCoordinationMessage {
  return (
    obj &&
    typeof obj === "object" &&
    obj.version === "1.0" &&
    ["game_event", "agent_ready", "heartbeat", "coordination_ack"].includes(
      obj.type
    ) &&
    obj.sourceAgent &&
    obj.targetAgents &&
    obj.messageId &&
    obj.timestamp &&
    obj.payload
  );
}

/**
 * Type guard for game event coordination messages
 */
export function isGameEventCoordinationMessage(
  msg: AnyCoordinationMessage
): msg is GameEventCoordinationMessage {
  return msg.type === "game_event" && "gameEventType" in msg;
}

/**
 * Type guard for agent ready coordination messages
 */
export function isAgentReadyCoordinationMessage(
  msg: AnyCoordinationMessage
): msg is AgentReadyCoordinationMessage {
  return msg.type === "agent_ready";
}
