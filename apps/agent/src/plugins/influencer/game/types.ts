import { UUID } from "@elizaos/core";
import { Phase } from "@/plugins/house/game/types";
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

export { Phase };
