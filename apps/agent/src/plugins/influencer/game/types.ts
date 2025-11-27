import { UUID } from "@elizaos/core";

/**
 * Influence phases as experienced by a single player. We intentionally mirror
 * the canonical phase enum so player and house actors can reference the same
 * symbolic names without sharing context objects.
 */
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
 * Minimal identity record for the local player or other observed participants.
 */
export interface PlayerIdentity {
  id: UUID;
  name?: string;
}

/**
 * Information a player could reasonably infer about another participant based
 * solely on public/DM events routed to them. We avoid storing any global state
 * that the player would not directly observe.
 */
export interface KnownPlayer extends PlayerIdentity {
  /**
   * Timestamp (ms) when this player was first seen in any channel.
   */
  firstSeenAt: number;
  /**
   * Latest timestamp (ms) we observed activity from this player.
   */
  lastSeenAt: number;
  /**
   * Rooms where we have seen this player speak or be referenced.
   */
  roomsSeenIn: UUID[];
}

// /**
//  * Tracks our own introduction obligations in the current phase.
//  */
// export interface IntroductionTracker {
//   required: boolean;
//   roomId?: UUID;
//   promptedAt?: number;
//   messageId?: UUID;
//   completedAt?: number;
// }

/**
 * Represents a diary prompt delivered to the player. Prompts are keyed by the
 * room they originated from (DM or group) since multiple prompts can exist
 * throughout the game.
 */
export interface DiaryPromptState {
  roomId: UUID;
  promptAt: number;
  promptMessageId?: UUID;
  respondedAt?: number;
  phase?: Phase;
}

/**
 * Top-level context tracked by the influencer-specific phase machine. This is
 * strictly the player's point-of-view: no global player lists, no shared
 * coordinators.
 */
export interface PlayerPhaseContext {
  self: PlayerIdentity;
  currentPhase: Phase;
  phaseEnteredAt: number;
  currentPhaseRoomId?: UUID;
  knownPlayers: Record<UUID, KnownPlayer>;
  // introduction: IntroductionTracker;
  diaryPrompts: Record<UUID, DiaryPromptState>;
}

/**
 * Runtime configuration for the player phase machine.
 */
export interface PhaseInput {
  self: PlayerIdentity;
  initialPhase?: Phase;
  /**
   * Seeds for previously seen players (useful when restoring from persistence).
   */
  initialKnownPlayers?: KnownPlayer[];
  /**
   * Optional clock override (facilitates deterministic tests).
   */
  getNow?: () => number;
}
