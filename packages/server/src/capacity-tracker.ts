import { UUID, logger } from "@elizaos/core";
import {
  ChannelCapacityConfig,
  ChannelCapacityState,
  ChannelCapacityInfo,
} from "./capacity-types.js";

/**
 * Tracks channel capacity and enforces message limits per channel
 */
export class ChannelCapacityTracker {
  private capacityStates = new Map<UUID, ChannelCapacityState>();

  /**
   * Set capacity configuration for a channel
   */
  setChannelConfig(channelId: UUID, config: ChannelCapacityConfig): void {
    this.capacityStates.set(channelId, {
      channelId,
      maxRepliesPerParticipant: config.maxRepliesPerParticipant,
      maxTotalMessages: config.maxTotalMessages,
      participantCounts: new Map(),
      totalMessageCount: 0,
      isExhausted: false,
    });
    
    logger.debug(`[CapacityTracker] Configured channel ${channelId} with limits: participant=${config.maxRepliesPerParticipant}, total=${config.maxTotalMessages}`);
  }

  /**
   * Check if a participant can send another message
   */
  canParticipantSendMessage(channelId: UUID, participantId: UUID): boolean {
    const state = this.capacityStates.get(channelId);
    if (!state) {
      // Channel not configured for capacity tracking - unlimited
      return true;
    }

    if (state.isExhausted) {
      // Channel is globally exhausted
      return false;
    }

    // Check participant's individual limit
    if (state.maxRepliesPerParticipant) {
      const currentCount = state.participantCounts.get(participantId) || 0;
      if (currentCount >= state.maxRepliesPerParticipant) {
        return false;
      }
    }

    return true;
  }

  /**
   * Track a message and update capacity state
   */
  trackMessage(channelId: UUID, authorId: UUID): void {
    const state = this.capacityStates.get(channelId);
    if (!state) {
      // Channel not configured for capacity tracking
      return;
    }
    
    if (state.isExhausted) {
      logger.debug(`[CapacityTracker] Attempted to track message in exhausted channel ${channelId}`);
      return;
    }

    // Increment counters
    const currentCount = state.participantCounts.get(authorId) || 0;
    state.participantCounts.set(authorId, currentCount + 1);
    state.totalMessageCount++;

    logger.debug(`[CapacityTracker] Tracked message in channel ${channelId}: author=${authorId}, count=${currentCount + 1}, total=${state.totalMessageCount}`);

    // Check for GLOBAL channel exhaustion (not individual participant limits)
    const totalExceeded = state.maxTotalMessages && 
      state.totalMessageCount >= state.maxTotalMessages;
    
    // Check if ALL participants have exhausted their individual budgets
    const allParticipantsExhausted = this.checkAllParticipantsExhausted(state);

    if (totalExceeded || allParticipantsExhausted) {
      state.isExhausted = true;
      state.exhaustedAt = Date.now();
      state.exhaustionReason = totalExceeded ? 'total_limit' : 'participant_limit';
      
      logger.info(`[CapacityTracker] Channel ${channelId} exhausted due to ${state.exhaustionReason}`);
    }
  }

  /**
   * Check if all participants have exhausted their individual message budgets
   * NOTE: This is conservative - we can't predict future participants, so we only
   * exhaust based on participant limits if we have an explicit participant list.
   * For now, channels are not exhausted purely based on individual participant limits.
   */
  private checkAllParticipantsExhausted(_state: ChannelCapacityState): boolean {
    // Conservative approach: don't exhaust channels based on participant limits
    // unless we have a predefined list of all expected participants.
    // Individual participants will be blocked by canParticipantSendMessage(),
    // but the channel remains open for new participants.
    return false;
  }

  /**
   * Check if a channel is exhausted
   */
  isChannelExhausted(channelId: UUID): boolean {
    const state = this.capacityStates.get(channelId);
    return state?.isExhausted || false;
  }

  /**
   * Get exhaustion reason for a channel
   */
  getExhaustionReason(channelId: UUID): 'participant_limit' | 'total_limit' | undefined {
    const state = this.capacityStates.get(channelId);
    return state?.exhaustionReason;
  }

  /**
   * Get capacity information for a specific agent in a channel
   */
  getCapacityInfo(channelId: UUID, agentId: UUID): ChannelCapacityInfo {
    const state = this.capacityStates.get(channelId);
    if (!state) {
      // Channel not configured for capacity tracking - unlimited
      return { 
        responsesRemaining: Infinity, 
        totalMessagesRemaining: Infinity,
        isExhausted: false
      };
    }

    const agentMessages = state.participantCounts.get(agentId) || 0;
    const responsesRemaining = state.maxRepliesPerParticipant ? 
      Math.max(0, state.maxRepliesPerParticipant - agentMessages) : Infinity;
    const totalMessagesRemaining = state.maxTotalMessages ?
      Math.max(0, state.maxTotalMessages - state.totalMessageCount) : Infinity;

    return { 
      responsesRemaining, 
      totalMessagesRemaining, 
      isExhausted: state.isExhausted 
    };
  }

  /**
   * Get all capacity states (for debugging/monitoring)
   */
  getAllCapacityStates(): Map<UUID, ChannelCapacityState> {
    return new Map(this.capacityStates);
  }

  /**
   * Remove capacity tracking for a channel
   */
  removeChannel(channelId: UUID): void {
    this.capacityStates.delete(channelId);
    logger.debug(`[CapacityTracker] Removed capacity tracking for channel ${channelId}`);
  }

  /**
   * Get statistics about capacity tracking
   */
  getStats(): {
    trackedChannels: number;
    exhaustedChannels: number;
    totalMessagesTracked: number;
  } {
    const states = Array.from(this.capacityStates.values());
    return {
      trackedChannels: states.length,
      exhaustedChannels: states.filter(s => s.isExhausted).length,
      totalMessagesTracked: states.reduce((sum, s) => sum + s.totalMessageCount, 0)
    };
  }
}