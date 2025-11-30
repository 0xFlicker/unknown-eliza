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
