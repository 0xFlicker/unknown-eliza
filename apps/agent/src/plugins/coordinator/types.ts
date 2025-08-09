import { PhaseEmitted, PhaseEvent } from "@/game/phase";
import { Phase } from "@/memory/types";
import {
  EventHandler,
  EventPayload,
  EventPayloadMap,
  UUID,
} from "@elizaos/core";
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

// /**
//  * Game-specific event types for Influence game coordination
//  */
// export enum GameEventType {
//   // Phase lifecycle events
//   PHASE_TRANSITION_INITIATED = "GAME:PHASE_TRANSITION_INITIATED",
//   PHASE_STARTED = "GAME:PHASE_STARTED",
//   PHASE_ENDED = "GAME:PHASE_ENDED",

//   // Player coordination events
//   ARE_YOU_READY = "GAME:ARE_YOU_READY",
//   PLAYER_READY = "GAME:PLAYER_READY",
//   ALL_PLAYERS_READY = "GAME:ALL_PLAYERS_READY",
//   I_AM_READY = "GAME:I_AM_READY",

//   // Timer management events
//   TIMER_WARNING = "GAME:TIMER_WARNING",
//   TIMER_EXPIRED = "GAME:TIMER_EXPIRED",

//   // Strategic events
//   STRATEGIC_THINKING_REQUIRED = "GAME:STRATEGIC_THINKING_REQUIRED",
//   STRATEGIC_THINKING_COMPLETED = "GAME:STRATEGIC_THINKING_COMPLETED",

//   // Diary room events
//   DIARY_ROOM_OPENED = "GAME:DIARY_ROOM_OPENED",
//   DIARY_ROOM_COMPLETED = "GAME:DIARY_ROOM_COMPLETED",

//   // Game state events
//   GAME_STATE_CHANGED = "GAME:GAME_STATE_CHANGED",
//   ROUND_STARTED = "GAME:ROUND_STARTED",
//   ROUND_ENDED = "GAME:ROUND_ENDED",
// }

/**
 * Base payload for all game events
 */
export interface GameEventPayload<Action extends PhaseEmitted>
  extends EventPayload {
  gameId: UUID;
  roomId: UUID;
  timestamp: number;
  action: Action;
}

/**
 * Payload for ARE_YOU_READY events - asking players if they're ready
 */
export interface AreYouReadyPayload
  extends GameEventPayload<{ type: "ARE_YOU_READY" }> {}

/**
 * Payload for player readiness events
 */
export interface PlayerReadyPayload
  extends GameEventPayload<{ type: "PLAYER_READY"; playerId: UUID }> {}

/**
 * Payload for all players ready events
 */
export interface AllPlayersReadyPayload
  extends GameEventPayload<{ type: "ALL_PLAYERS_READY" }> {}

export interface EndRoundPayload
  extends GameEventPayload<{ type: "END_ROUND" }> {}

export interface MessageSentPayload
  extends GameEventPayload<{
    type: "MESSAGE_SENT";
    messageId: UUID;
    playerId: UUID;
  }> {}

export interface PlayerReadyErrorPayload
  extends GameEventPayload<{
    type: "PLAYER_READY_ERROR";
    error: Error;
  }> {}

/**
 * Maps game event types to their corresponding payload types
 */
export interface GameEventPayloadMap {
  ["GAME:ARE_YOU_READY"]: AreYouReadyPayload;
  ["GAME:PLAYER_READY"]: PlayerReadyPayload;
  ["GAME:ALL_PLAYERS_READY"]: AllPlayersReadyPayload;
  ["GAME:I_AM_READY"]: PlayerReadyPayload;
  ["GAME:END_ROUND"]: EndRoundPayload;
  ["GAME:MESSAGE_SENT"]: MessageSentPayload;
  ["GAME:PLAYER_READY_ERROR"]: PlayerReadyErrorPayload;
}

/**
 * Base coordination message interface
 */
export interface GameEventCoordinationMessage<
  T extends keyof GameEventPayloadMap,
> {
  messageId: string;
  timestamp: number;
  sourceAgent: UUID;
  targetAgents: UUID[] | "all" | "others";
  type: "coordination_message";
  payload: GameEventPayloadMap[T];
}

/**
 * Create a type-safe game event coordination message
 */
export function createGameEventMessage<T extends keyof GameEventPayloadMap>(
  sourceAgent: UUID,
  payload: GameEventPayloadMap[T],
  targetAgents: UUID[] | "all" | "others" = "others",
): GameEventCoordinationMessage<T> {
  return {
    messageId: v4() as UUID,
    timestamp: Date.now(),
    sourceAgent,
    targetAgents: targetAgents || "others",
    type: "coordination_message",
    payload,
  };
}

/**
 * Create an agent ready coordination message
 */
export function createAgentReadyMessage(
  sourceAgent: UUID,
  payload: GameEventPayloadMap["GAME:ARE_YOU_READY"],
): GameEventCoordinationMessage<"GAME:ARE_YOU_READY"> {
  return {
    messageId: `agent-ready-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    sourceAgent,
    targetAgents: "others",
    type: "coordination_message",
    payload,
  };
}

/**
 * Type-safe event handler for game events
 */
export type GameEventHandler<T extends keyof GameEventPayloadMap> = (
  payload: GameEventPayloadMap[T],
) => Promise<void>;

/**
 * Utility type for properly typed game event handlers in plugins
 */
export type GameEventHandlers = {
  [K in keyof EventPayloadMap]?: EventHandler<K>[];
} & {
  [key in keyof GameEventPayloadMap]?: GameEventHandler<key>[];
};

export type AnyCoordinationMessage = GameEventCoordinationMessage<
  keyof GameEventPayloadMap
>;
