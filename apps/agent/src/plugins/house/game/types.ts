import { UUID } from "@elizaos/core";
import {
  EventObject,
  ProvidedActor,
  ParameterizedObject,
  AnyActorRef,
  StateMachine,
  MachineContext,
  StateValue,
  MetaObject,
  ActorRef,
  MachineSnapshot,
  Snapshot,
} from "xstate";
import { StateSchema } from "xstate";

export type ParentMachine<TEvent extends EventObject> = ActorRef<
  Snapshot<unknown>,
  TEvent,
  EventObject
>;

export enum Phase {
  INIT = "INIT",
  INTRODUCTION = "INTRODUCTION",
  LOBBY = "LOBBY",
  WHISPER = "WHISPER",
  RUMOR = "RUMOR",
  VOTE = "VOTE",
  POWER = "POWER",
  REVEAL = "REVEAL",
  COUNCIL = "COUNCIL",
  END = "END",
}

/**
 * Game settings and configuration
 */
export interface GameSettings {
  timers: {
    // in milliseconds
    whisper: number;
    whisper_pick: number;
    whisper_room: number;
    diary: number;
    diary_response: number;
    diary_ready: number;
    diary_prompt: number;
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
