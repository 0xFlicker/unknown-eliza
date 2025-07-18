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

/**
 * Game-specific event types for Influence game coordination
 */
export enum GameEventType {
  // Phase lifecycle events
  PHASE_TRANSITION_INITIATED = "GAME:PHASE_TRANSITION_INITIATED",
  PHASE_STARTED = "GAME:PHASE_STARTED",
  PHASE_ENDED = "GAME:PHASE_ENDED",

  // Player coordination events
  ARE_YOU_READY = "GAME:ARE_YOU_READY",
  PLAYER_READY = "GAME:PLAYER_READY",
  ALL_PLAYERS_READY = "GAME:ALL_PLAYERS_READY",
  I_AM_READY = "GAME:I_AM_READY",

  // Timer management events
  TIMER_WARNING = "GAME:TIMER_WARNING",
  TIMER_EXPIRED = "GAME:TIMER_EXPIRED",

  // Strategic events
  STRATEGIC_THINKING_REQUIRED = "GAME:STRATEGIC_THINKING_REQUIRED",
  STRATEGIC_THINKING_COMPLETED = "GAME:STRATEGIC_THINKING_COMPLETED",

  // Diary room events
  DIARY_ROOM_OPENED = "GAME:DIARY_ROOM_OPENED",
  DIARY_ROOM_COMPLETED = "GAME:DIARY_ROOM_COMPLETED",

  // Game state events
  GAME_STATE_CHANGED = "GAME:GAME_STATE_CHANGED",
  ROUND_STARTED = "GAME:ROUND_STARTED",
  ROUND_ENDED = "GAME:ROUND_ENDED",
}

/**
 * Base payload for all game events
 */
export interface GameEventPayload<T extends keyof GameEventPayloadMap>
  extends EventPayload {
  gameId: UUID;
  roomId: UUID;
  timestamp: number;
  type: T;
}

/**
 * Payload for phase-related events
 */
export interface PhaseEventPayload
  extends GameEventPayload<
    GameEventType.PHASE_STARTED | GameEventType.PHASE_ENDED
  > {
  phase: Phase;
  round: number;
  previousPhase?: Phase;
  timeRemaining?: number;
  timerEndsAt?: number;
}

/**
 * Payload for phase transition events
 */
export interface PhaseTransitionPayload
  extends GameEventPayload<GameEventType.PHASE_TRANSITION_INITIATED> {
  fromPhase: Phase;
  toPhase: Phase;
  round: number;
  transitionReason: "timer_expired" | "manual" | "all_players_ready";
  requiresStrategicThinking: boolean;
  requiresDiaryRoom: boolean;
}

/**
 * Payload for ARE_YOU_READY events - asking players if they're ready
 */
export interface AreYouReadyPayload
  extends GameEventPayload<GameEventType.ARE_YOU_READY> {
  readyType: "strategic_thinking" | "diary_room" | "phase_action";
  targetPhase?: Phase; // The phase players should be ready for
  timeoutMs?: number; // How long to wait for responses
}

/**
 * Payload for player readiness events
 */
export interface PlayerReadyPayload
  extends GameEventPayload<
    GameEventType.PLAYER_READY | GameEventType.I_AM_READY
  > {
  playerId: UUID;
  playerName: string;
  readyType: "strategic_thinking" | "diary_room" | "phase_action";
  targetPhase?: Phase; // For I_AM_READY events - the phase the player is ready for
  additionalData?: Record<string, unknown>;
}

/**
 * Payload for all players ready events
 */
export interface AllPlayersReadyPayload
  extends GameEventPayload<GameEventType.ALL_PLAYERS_READY> {
  readyType: "strategic_thinking" | "diary_room" | "phase_action";
  playerCount: number;
  readyPlayers: Array<{
    playerId: UUID;
    playerName: string;
    readyAt: number;
  }>;
}

/**
 * Payload for timer-related events
 */
export interface TimerEventPayload
  extends GameEventPayload<
    GameEventType.TIMER_WARNING | GameEventType.TIMER_EXPIRED
  > {
  phase: Phase;
  round: number;
  timeRemaining: number;
  timerEndsAt: number;
  warningType?: "five_minutes" | "one_minute" | "thirty_seconds";
}

/**
 * Payload for strategic thinking events
 */
export interface StrategicThinkingPayload
  extends GameEventPayload<
    | GameEventType.STRATEGIC_THINKING_REQUIRED
    | GameEventType.STRATEGIC_THINKING_COMPLETED
  > {
  playerId: UUID;
  playerName: string;
  fromPhase: Phase;
  toPhase: Phase;
  contextData?: {
    currentPhase?: Phase;
    nextPhase?: Phase;
    round?: number;
    lobbyConversations?: string[];
    recentInteractions?: string[];
    currentRelationships?: Record<string, unknown>;
  };
}

/**
 * Payload for diary room events
 */
export interface DiaryRoomPayload
  extends GameEventPayload<
    GameEventType.DIARY_ROOM_OPENED | GameEventType.DIARY_ROOM_COMPLETED
  > {
  playerId?: UUID; // Optional for DIARY_ROOM_OPENED (all players), required for DIARY_ROOM_COMPLETED
  playerName?: string;
  diaryRoomId?: UUID;
  completedPlayers?: Array<{
    playerId: UUID;
    playerName: string;
    completedAt: number;
  }>;
}

/**
 * Payload for game state change events
 */
export interface GameStateChangePayload
  extends GameEventPayload<GameEventType.GAME_STATE_CHANGED> {
  changeType: "phase" | "round" | "player_status" | "votes" | "elimination";
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  affectedPlayers?: UUID[];
}

/**
 * Maps game event types to their corresponding payload types
 */
export interface GameEventPayloadMap {
  [GameEventType.PHASE_TRANSITION_INITIATED]: PhaseTransitionPayload;
  [GameEventType.PHASE_STARTED]: PhaseEventPayload;
  [GameEventType.PHASE_ENDED]: PhaseEventPayload;
  [GameEventType.ARE_YOU_READY]: AreYouReadyPayload;
  [GameEventType.PLAYER_READY]: PlayerReadyPayload;
  [GameEventType.ALL_PLAYERS_READY]: AllPlayersReadyPayload;
  [GameEventType.I_AM_READY]: PlayerReadyPayload;
  [GameEventType.TIMER_WARNING]: TimerEventPayload;
  [GameEventType.TIMER_EXPIRED]: TimerEventPayload;
  [GameEventType.STRATEGIC_THINKING_REQUIRED]: StrategicThinkingPayload;
  [GameEventType.STRATEGIC_THINKING_COMPLETED]: StrategicThinkingPayload;
  [GameEventType.DIARY_ROOM_OPENED]: DiaryRoomPayload;
  [GameEventType.DIARY_ROOM_COMPLETED]: DiaryRoomPayload;
  [GameEventType.GAME_STATE_CHANGED]: GameStateChangePayload;
  [GameEventType.ROUND_STARTED]: PhaseEventPayload;
  [GameEventType.ROUND_ENDED]: PhaseEventPayload;
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
  payload: GameEventPayloadMap[GameEventType.ARE_YOU_READY],
): GameEventCoordinationMessage<GameEventType.ARE_YOU_READY> {
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
