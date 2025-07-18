export enum Phase {
  INIT = "INIT",
  INTRODUCTION = "INTRODUCTION",
  LOBBY = "LOBBY",
  INTRO_DR = "INTRO_DR",
}

export interface Player {
  id: string;
  name: string;
  status: "alive" | "eliminated";
}

export interface GameContext {
  /**
   * Current phase of the game.
   */
  phase: Phase;
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
  // ready handshake timer id removed in flattened model
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
  | { type: "DIARY_ROOM_QUESTION"; playerId: string; diaryRoomId: string }
  | { type: "ARE_YOU_READY"; nextPhase: Phase }
  | { type: "READY_CHECK" };
