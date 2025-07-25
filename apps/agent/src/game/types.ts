import { UUID } from "@elizaos/core";

export enum Phase {
  INIT = "INIT",
  INTRODUCTION = "INTRODUCTION",
  LOBBY = "LOBBY",
  WHISPER = "WHISPER",
  RUMOR = "RUMOR",
  VOTE = "VOTE",
  POWER = "POWER",
  REVEAL = "REVEAL",
  END = "END",
}

/**
 * Game settings and configuration
 */
export interface GameSettings {
  maxPlayers: number;
  minPlayers: number;
  timers: {
    // in milliseconds
    diary: number;
    round: number;
  };
}

/**
 * Player status in the game
 */
export enum PlayerStatus {
  ALIVE = "alive",
  ELIMINATED = "eliminated",
  EXPOSED = "exposed", // Can be targeted for elimination or protection
}

/**
 * Individual player in the game
 */
export interface Player {
  id: UUID;
  name: string;
  status: PlayerStatus;
  joinedAt: number;
}

export interface GameContext {
  /**
   * All players keyed by their unique id.
   */
  players: Record<string, Player>;
  /**
   * Map of players that have indicated they are ready during INIT.
   */
  ready: Record<string, boolean>;

  /** Count of intro messages per player during INTRODUCTION */
  introductionMessages?: Record<string, number>;
  /** timer id for intro phase if scheduled */
  introTimerId?: string;
  /** timer id for ready phase if scheduled */
  readyTimerId?: string;
  /** Map of playerId -> diary room id */
  diaryRooms?: Record<string, string>;
}

/**
 * Default game settings
 */
export const DEFAULT_GAME_SETTINGS: GameSettings = {
  maxPlayers: 12,
  minPlayers: 4,
  timers: {
    diary: 10 * 60 * 1000, // 10 minutes
    round: 10 * 60 * 1000, // 10 minutes
  },
};

export type GameEvent =
  | {
      type: "PLAYER_READY";
      playerId: string;
    }
  | {
      type: "RESET_READY";
    }
  | { type: "INTRO_MESSAGE"; playerId: string }
  | { type: "TIMER_EXPIRED" }
  | { type: "PHASE_CHANGE_INITIATED" }
  | { type: "ALL_PLAYERS_READY" }
  | { type: "DIARY_ROOM_QUESTION"; playerId: string; diaryRoomId: string }
  | { type: "ARE_YOU_READY"; nextPhase: Phase }
  | { type: "INTRODUCTION_TIMER_EXPIRED" }
  | { type: "READY_TIMER_EXPIRED" };
