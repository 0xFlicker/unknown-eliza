import type { UUID } from '@elizaos/core';

export interface ChannelCapacityConfig {
  maxRepliesPerParticipant?: number;
  maxTotalMessages?: number;
}

export interface ChannelCapacityInfo {
  responsesRemaining?: number;
  totalMessagesRemaining?: number;
  isExhausted: boolean;
}

interface ChannelCapacityState {
  maxRepliesPerParticipant?: number;
  maxTotalMessages?: number;
  participantCounts: Map<UUID, number>;
  totalMessageCount: number;
}

class ChannelCapacityTracker {
  private channels = new Map<UUID, ChannelCapacityState>();

  setChannelConfig(channelId: UUID, config: ChannelCapacityConfig): void {
    const existing = this.channels.get(channelId);
    this.channels.set(channelId, {
      maxRepliesPerParticipant: config.maxRepliesPerParticipant,
      maxTotalMessages: config.maxTotalMessages,
      participantCounts: existing?.participantCounts ?? new Map<UUID, number>(),
      totalMessageCount: existing?.totalMessageCount ?? 0,
    });
  }

  trackMessage(channelId: UUID, participantId: UUID): void {
    const state = this.channels.get(channelId);
    if (!state) {
      return;
    }

    state.totalMessageCount += 1;
    state.participantCounts.set(
      participantId,
      (state.participantCounts.get(participantId) ?? 0) + 1
    );
  }

  canParticipantSendMessage(channelId: UUID, participantId: UUID): boolean {
    const info = this.getCapacityInfo(channelId, participantId);
    return !info.isExhausted && (info.responsesRemaining === undefined || info.responsesRemaining > 0);
  }

  isChannelExhausted(channelId: UUID): boolean {
    const state = this.channels.get(channelId);
    if (!state?.maxTotalMessages) {
      return false;
    }

    return state.totalMessageCount >= state.maxTotalMessages;
  }

  getCapacityInfo(channelId: UUID, participantId: UUID): ChannelCapacityInfo {
    const state = this.channels.get(channelId);
    if (!state) {
      return {
        responsesRemaining: undefined,
        totalMessagesRemaining: undefined,
        isExhausted: false,
      };
    }

    const participantCount = state.participantCounts.get(participantId) ?? 0;
    const responsesRemaining =
      state.maxRepliesPerParticipant === undefined
        ? undefined
        : Math.max(0, state.maxRepliesPerParticipant - participantCount);
    const totalMessagesRemaining =
      state.maxTotalMessages === undefined
        ? undefined
        : Math.max(0, state.maxTotalMessages - state.totalMessageCount);

    return {
      responsesRemaining,
      totalMessagesRemaining,
      isExhausted: totalMessagesRemaining === 0,
    };
  }
}

const capacityTracker = new ChannelCapacityTracker();

export const getCapacityTracker = (): ChannelCapacityTracker => capacityTracker;

