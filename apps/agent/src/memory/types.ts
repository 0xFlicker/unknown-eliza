import { UUID } from "@elizaos/core";
import { GameSettings, Player } from "../game/types";
import { PersistedHistoryValue, Snapshot } from "xstate";
import { createPhaseMachine, PhaseInput } from "@/game/phase";

/**
 * Vote cast by a player in the VOTE phase
 */
export interface Vote {
  round: number;
  voter: string; // player ID
  empowerTarget?: UUID; // player ID to empower
  exposeTarget?: UUID; // player ID to expose
  timestamp: number;
}

/**
 * Private room for WHISPER phase
 */
export interface PrivateRoom {
  id: UUID;
  participants: UUID[]; // player IDs
  createdBy: UUID; // player ID who requested
  createdAt: number;
  active: boolean;
}

/**
 * Phase-specific state tracking
 */
export interface PhaseState {
  // INTRODUCTION phase tracking
  introductionMessages?: Record<UUID, number>; // playerId -> message count
  introductionComplete?: UUID[]; // players who have introduced themselves
}

/**
 * Main game state
 */
export interface GameState extends Record<string, unknown> {
  id: UUID;
  gameSettings: GameSettings;
  phaseInput: PhaseInput;
  phaseSnapshot: Snapshot<unknown>;
}

/**
 * Influence game phases
 */

// export enum Phase {
//   INIT = "INIT",
//   INTRODUCTION = "INTRODUCTION",
//   INTRODUCTION_DIARY_ROOM = "INTRODUCTION_DIARY_ROOM",
//   LOBBY = "LOBBY",
//   LOBBY_DIARY_ROOM = "LOBBY_DIARY_ROOM",
//   WHISPER = "WHISPER",
//   WHISPER_DIARY_ROOM = "WHISPER_DIARY_ROOM",
//   RUMOR = "RUMOR",
//   RUMOR_DIARY_ROOM = "RUMOR_DIARY_ROOM",
//   VOTE = "VOTE",
//   VOTE_DIARY_ROOM = "VOTE_DIARY_ROOM",
//   POWER = "POWER",
//   POWER_DIARY_ROOM = "POWER_DIARY_ROOM",
//   REVEAL = "REVEAL",
//   REVEAL_DIARY_ROOM = "REVEAL_DIARY_ROOM",
// }
