import type { EventPayload } from "@elizaos/core";
import type { UUID } from "@elizaos/core";
import { Phase } from "../types";

/**
 * Game-specific event types for Influence game coordination
 */
export enum GameEventType {
  // Phase lifecycle events
  PHASE_TRANSITION_INITIATED = "GAME:PHASE_TRANSITION_INITIATED",
  PHASE_STARTED = "GAME:PHASE_STARTED",
  PHASE_ENDED = "GAME:PHASE_ENDED",
  
  // Player coordination events
  PLAYER_READY = "GAME:PLAYER_READY",
  ALL_PLAYERS_READY = "GAME:ALL_PLAYERS_READY",
  
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
  ROUND_ENDED = "GAME:ROUND_ENDED"
}

/**
 * Base payload for all game events
 */
export interface GameEventPayload extends EventPayload {
  gameId: UUID;
  roomId: UUID;
  timestamp: number;
}

/**
 * Payload for phase-related events
 */
export interface PhaseEventPayload extends GameEventPayload {
  phase: Phase;
  round: number;
  previousPhase?: Phase;
  timeRemaining?: number;
  timerEndsAt?: number;
}

/**
 * Payload for phase transition events
 */
export interface PhaseTransitionPayload extends GameEventPayload {
  fromPhase: Phase;
  toPhase: Phase;
  round: number;
  transitionReason: 'timer_expired' | 'manual' | 'all_players_ready';
  requiresStrategicThinking: boolean;
  requiresDiaryRoom: boolean;
}

/**
 * Payload for player readiness events
 */
export interface PlayerReadyPayload extends GameEventPayload {
  playerId: UUID;
  playerName: string;
  readyType: 'strategic_thinking' | 'diary_room' | 'phase_action';
  additionalData?: Record<string, unknown>;
}

/**
 * Payload for all players ready events
 */
export interface AllPlayersReadyPayload extends GameEventPayload {
  readyType: 'strategic_thinking' | 'diary_room' | 'phase_action';
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
export interface TimerEventPayload extends GameEventPayload {
  phase: Phase;
  round: number;
  timeRemaining: number;
  timerEndsAt: number;
  warningType?: 'five_minutes' | 'one_minute' | 'thirty_seconds';
}

/**
 * Payload for strategic thinking events
 */
export interface StrategicThinkingPayload extends GameEventPayload {
  playerId: UUID;
  playerName: string;
  fromPhase: Phase;
  toPhase: Phase;
  contextData?: {
    lobbyConversations?: string[];
    recentInteractions?: string[];
    currentRelationships?: Record<string, unknown>;
  };
}

/**
 * Payload for diary room events
 */
export interface DiaryRoomPayload extends GameEventPayload {
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
export interface GameStateChangePayload extends GameEventPayload {
  changeType: 'phase' | 'round' | 'player_status' | 'votes' | 'elimination';
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  affectedPlayers?: UUID[];
}

/**
 * Maps game event types to their corresponding payload types
 */
export interface GameEventPayloadMap {
  "GAME:PHASE_TRANSITION_INITIATED": PhaseTransitionPayload;
  "GAME:PHASE_STARTED": PhaseEventPayload;
  "GAME:PHASE_ENDED": PhaseEventPayload;
  "GAME:PLAYER_READY": PlayerReadyPayload;
  "GAME:ALL_PLAYERS_READY": AllPlayersReadyPayload;
  "GAME:TIMER_WARNING": TimerEventPayload;
  "GAME:TIMER_EXPIRED": TimerEventPayload;
  "GAME:STRATEGIC_THINKING_REQUIRED": StrategicThinkingPayload;
  "GAME:STRATEGIC_THINKING_COMPLETED": StrategicThinkingPayload;
  "GAME:DIARY_ROOM_OPENED": DiaryRoomPayload;
  "GAME:DIARY_ROOM_COMPLETED": DiaryRoomPayload;
  "GAME:GAME_STATE_CHANGED": GameStateChangePayload;
  "GAME:ROUND_STARTED": PhaseEventPayload;
  "GAME:ROUND_ENDED": PhaseEventPayload;
}

/**
 * Type-safe event handler for game events
 */
export type GameEventHandler<T extends keyof GameEventPayloadMap> = (
  payload: GameEventPayloadMap[T]
) => Promise<void> | void;

/**
 * Helper type for event emission - ensures type safety when emitting game events
 */
export type GameEventEmission<T extends keyof GameEventPayloadMap> = {
  type: T;
  payload: Omit<GameEventPayloadMap[T], 'runtime' | 'source' | 'onComplete'>;
};