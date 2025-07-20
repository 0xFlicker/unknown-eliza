export enum Phase {
  INIT = "INIT",
  INTRODUCTION = "INTRODUCTION",
  INTRO_DR = "INTRO_DR",
  LOBBY = "LOBBY",
  LOBBY_DR = "LOBBY_DR",
}

export interface Player {
  id: string;
  name: string;
  status: "alive" | "eliminated";
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
  | { type: "ARE_YOU_READY"; nextPhase: Phase };
