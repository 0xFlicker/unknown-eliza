import { UUID } from "@elizaos/core";
import { GameEventPayloadMap } from "../house/events/types";
import { v4 } from "uuid";

export interface MessageServiceMessage {
  id: UUID; // root_message.id
  channel_id: UUID;
  server_id: UUID;
  author_id: UUID; // UUID of a central user identity
  author_display_name?: string; // Display name from central user identity
  content: string;
  raw_message?: any;
  source_id?: string; // original platform message ID
  source_type?: string;
  in_reply_to_message_id?: UUID;
  created_at: number;
  metadata?: any;
}

/**
 * Base coordination message interface
 */
export interface BaseCoordinationMessage {
  messageId: string;
  timestamp: number;
  sourceAgent: UUID;
  targetAgents: UUID[] | "all" | "others";
}

/**
 * Type-safe game event coordination message
 */
export interface GameEventCoordinationMessage<
  T extends keyof GameEventPayloadMap = keyof GameEventPayloadMap,
> extends BaseCoordinationMessage {
  type: "game_event";
  gameEventType: T;
  payload: GameEventPayloadMap[T];
}

/**
 * Union type for all possible game event coordination messages
 */
export type AnyGameEventCoordinationMessage = {
  [K in keyof GameEventPayloadMap]: GameEventCoordinationMessage<K>;
}[keyof GameEventPayloadMap];

/**
 * Agent ready coordination message
 */
export interface AgentReadyCoordinationMessage extends BaseCoordinationMessage {
  type: "agent_ready";
  payload: {
    readyType: string;
    gameId: UUID;
    roomId: UUID;
    playerId: UUID;
    playerName: string;
    additionalData?: Record<string, unknown>;
  };
}

/**
 * Heartbeat coordination message
 */
export interface HeartbeatCoordinationMessage extends BaseCoordinationMessage {
  type: "heartbeat";
  payload: {
    agentName: string;
    status: "alive" | "busy" | "idle";
    lastActivity: number;
  };
}

/**
 * Coordination acknowledgment message
 */
export interface CoordinationAckMessage extends BaseCoordinationMessage {
  type: "coordination_ack";
  payload: {
    originalMessageId: string;
    status: "received" | "processed" | "error";
    error?: string;
  };
}

/**
 * Union type for all coordination messages
 */
export type AnyCoordinationMessage =
  | AnyGameEventCoordinationMessage
  | AgentReadyCoordinationMessage
  | HeartbeatCoordinationMessage
  | CoordinationAckMessage;

/**
 * Type guard for coordination messages
 */
export function isCoordinationMessage(obj: any): obj is AnyCoordinationMessage {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.messageId === "string" &&
    typeof obj.timestamp === "number" &&
    typeof obj.sourceAgent === "string" &&
    (obj.targetAgents === "all" ||
      obj.targetAgents === "others" ||
      Array.isArray(obj.targetAgents)) &&
    ["game_event", "agent_ready", "heartbeat", "coordination_ack"].includes(
      obj.type,
    )
  );
}

/**
 * Create a type-safe game event coordination message
 */
export function createGameEventMessage<T extends keyof GameEventPayloadMap>(
  sourceAgent: UUID,
  gameEventType: T,
  payload: GameEventPayloadMap[T],
  targetAgents: UUID[] | "all" | "others" = "others",
): GameEventCoordinationMessage<T> {
  return {
    messageId: v4() as UUID,
    timestamp: Date.now(),
    sourceAgent,
    targetAgents,
    type: "game_event" as const,
    gameEventType,
    payload,
  };
}

/**
 * Create an agent ready coordination message
 */
export function createAgentReadyMessage(
  sourceAgent: UUID,
  payload: AgentReadyCoordinationMessage["payload"],
): AgentReadyCoordinationMessage {
  return {
    messageId: `agent-ready-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    sourceAgent,
    targetAgents: "others",
    type: "agent_ready",
    payload,
  };
}
