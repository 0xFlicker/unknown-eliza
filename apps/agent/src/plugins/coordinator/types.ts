import {
  GameplayEmittedAllPlayersReady,
  GameplayEmittedAreYouReady,
  GameplayEmittedDiaryRoomsCreated,
  GameplayEmittedPhaseEntered,
  GameplayEmittedPlayerReadyError,
  GameplayEndRoundEvent,
  GameplayPlayerReadyEvent,
} from "@/game/gameplay";
import {
  IntroductionRoomCreatedEmitted,
  PhaseEmitted,
  PhaseEvent,
  PhaseEventDiaryPrompt,
} from "@/game/phase";
import { IntroductionMessageEvent } from "@/game/rooms/introduction";
import { LobbyEventMessageSent } from "@/game/rooms/lobby";
import {
  WhisperEmittedError,
  WhisperEmittedYourTurn,
  WhisperEventMessageSent,
} from "@/game/rooms/whisper";
import { Phase } from "@/game/types";
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
 * Base payload for all game events
 */
export interface GameEventPayload<Action extends PhaseEvent>
  extends EventPayload {
  gameId: UUID;
  roomId?: UUID;
  timestamp: number;
  event: Action;
  type: Action["type"];
}

export interface GameEmitPayload<Action extends PhaseEmitted>
  extends EventPayload {
  gameId: UUID;
  roomId?: UUID;
  timestamp: number;
  emitted: Action;
  type: Action["type"];
}

/**
 * Payload for ARE_YOU_READY events - asking players if they're ready
 */
export interface AreYouReadyPayload
  extends GameEmitPayload<GameplayEmittedAreYouReady> {}

/**
 * Payload for player readiness events
 */
export interface PlayerReadyPayload
  extends GameEventPayload<GameplayPlayerReadyEvent> {}

// Emit types are "GAME:ALL_PLAYERS_READY" | "GAME:PLAYER_READY_ERROR" | "GAME:WHISPER_YOUR_TURN" | "GAME:ARE_YOU_READY" | "GAME:PHASE_ENTERED" | "GAME:WHISPER_ERROR" | "GAME:WHISPER_COMPLETE"
/**
 * Payload for all players ready events
 */
export interface AllPlayersReadyPayload
  extends GameEmitPayload<GameplayEmittedAllPlayersReady> {}

export interface PlayerReadyErrorPayload
  extends GameEmitPayload<GameplayEmittedPlayerReadyError> {}

export interface WhisperYourTurnPayload
  extends GameEmitPayload<WhisperEmittedYourTurn> {}

export interface WhisperErrorPayload
  extends GameEmitPayload<WhisperEmittedError> {}

export interface WhisperCompletePayload
  extends GameEmitPayload<{ type: "GAME:WHISPER_COMPLETE" }> {}

export interface WhisperRoomOpenedPayload
  extends GameEmitPayload<{ type: "GAME:WHISPER_ROOM_OPENED" }> {}

export interface WhisperRoomClosedPayload
  extends GameEmitPayload<{ type: "GAME:WHISPER_ROOM_CLOSED" }> {}

export interface PhaseStartedPayload
  extends GameEmitPayload<GameplayEmittedPhaseEntered> {}

export interface GameplayDiaryRoomCreatedPayload
  extends GameEmitPayload<GameplayEmittedDiaryRoomsCreated> {}

export interface IntroductionRoomCreatedPayload
  extends GameEmitPayload<IntroductionRoomCreatedEmitted> {}

export interface DiaryPromptPayload
  extends GameEventPayload<PhaseEventDiaryPrompt> {}

export interface EndRoundPayload
  extends GameEventPayload<GameplayEndRoundEvent> {}

export interface MessageSentPayload
  extends GameEventPayload<
    IntroductionMessageEvent | LobbyEventMessageSent | WhisperEventMessageSent
  > {}

/**
 * Maps game event types to their corresponding payload types
 */
export interface GameEventPayloadMap {
  ["GAME:PLAYER_READY"]: PlayerReadyPayload;
  ["GAME:I_AM_READY"]: PlayerReadyPayload;
  ["GAME:END_ROUND"]: EndRoundPayload;
  ["GAME:MESSAGE_SENT"]: MessageSentPayload;
  ["GAME:DIARY_PROMPT"]: DiaryPromptPayload;
}

export interface GameEventPayloadEmittableMap {
  ["GAME:PHASE_ENTERED"]: PhaseStartedPayload;
  ["GAME:ARE_YOU_READY"]: AreYouReadyPayload;
  ["GAME:ALL_PLAYERS_READY"]: AllPlayersReadyPayload;
  ["GAME:PLAYER_READY_ERROR"]: PlayerReadyErrorPayload;
  ["GAME:WHISPER_YOUR_TURN"]: WhisperYourTurnPayload;
  ["GAME:WHISPER_ERROR"]: WhisperErrorPayload;
  ["GAME:WHISPER_COMPLETE"]: WhisperCompletePayload;
  ["GAME:WHISPER_ROOM_OPENED"]: WhisperRoomOpenedPayload;
  ["GAME:WHISPER_ROOM_CLOSED"]: WhisperRoomClosedPayload;
  ["GAME:DIARY_ROOMS_CREATED"]: GameplayDiaryRoomCreatedPayload;
  ["GAME:INTRODUCTION_ROOM_CREATED"]: IntroductionRoomCreatedPayload;
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
  targetAgents: UUID[] | "all" | "others" | "house";
  type: "coordination_message";
  payload: GameEventPayloadMap[T];
}

export interface GameEmitCoordinationMessage<
  T extends keyof GameEventPayloadEmittableMap,
> {
  messageId: string;
  timestamp: number;
  sourceAgent: UUID;
  targetAgents: UUID[] | "all" | "others" | "house";
  type: "coordination_message";
  payload: GameEventPayloadEmittableMap[T];
}

/**
 * Create a type-safe game event coordination message
 */
export function createGameEventMessage<T extends keyof GameEventPayloadMap>(
  sourceAgent: UUID,
  payload: GameEventPayloadMap[T],
  targetAgents: UUID[] | "all" | "others" | "house" = "others",
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

export function createGameEmitMessage<
  T extends keyof GameEventPayloadEmittableMap,
>(
  sourceAgent: UUID,
  payload: GameEventPayloadEmittableMap[T],
  targetAgents: UUID[] | "all" | "others" = "others",
): GameEmitCoordinationMessage<T> {
  return {
    messageId: v4() as UUID,
    timestamp: Date.now(),
    sourceAgent,
    targetAgents: targetAgents || ("others" as const),
    type: "coordination_message" as const,
    payload,
  };
}

/**
 * Create an agent ready coordination message
 */
export function createAgentReadyMessage(
  sourceAgent: UUID,
  payload: GameEventPayloadEmittableMap["GAME:ARE_YOU_READY"],
): GameEmitCoordinationMessage<"GAME:ARE_YOU_READY"> {
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

export type GameEventEmitter<T extends keyof GameEventPayloadEmittableMap> = (
  payload: GameEventPayloadEmittableMap[T],
) => Promise<void>;

/**
 * Utility type for properly typed game event handlers in plugins
 */
export type GameEventHandlers = {
  [K in keyof EventPayloadMap]?: EventHandler<K>[];
} & {
  [key in keyof GameEventPayloadMap]?: GameEventHandler<key>[];
} & {
  [key in keyof GameEventPayloadEmittableMap]?: GameEventEmitter<key>[];
};

export type GameEventMessages = GameEventCoordinationMessage<
  keyof GameEventPayloadMap
>;

export type EmittableGameEventMessages = GameEmitCoordinationMessage<
  keyof GameEventPayloadEmittableMap
>;

export type AnyCoordinationMessage =
  | GameEventMessages
  | EmittableGameEventMessages;
