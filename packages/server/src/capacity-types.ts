import { UUID } from "@elizaos/core";

/**
 * Configuration for channel capacity limits
 */
export interface ChannelCapacityConfig {
  maxRepliesPerParticipant?: number;
  maxTotalMessages?: number;
}

/**
 * Current state of a channel's capacity tracking
 */
export interface ChannelCapacityState {
  channelId: UUID;
  maxRepliesPerParticipant?: number;
  maxTotalMessages?: number;
  participantCounts: Map<UUID, number>;
  totalMessageCount: number;
  isExhausted: boolean;
  exhaustedAt?: number;
  exhaustionReason?: "participant_limit" | "total_limit";
}

/**
 * Information about channel capacity for agent context
 */
export interface ChannelCapacityInfo {
  responsesRemaining: number;
  totalMessagesRemaining: number;
  isExhausted: boolean;
}

/**
 * Event emitted when a channel exceeds capacity
 */
export interface ChannelCapacityExceededEvent {
  channelId: UUID;
  droppedMessage: any;
  reason: "participant_limit" | "total_limit" | "unknown";
  timestamp: number;
}
