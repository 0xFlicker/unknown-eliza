import EventEmitter from "events";
import { logger } from "@elizaos/core";
import { ChannelCapacityTracker } from "./capacity-tracker.js";
import {
  CapacityAwareMessageBusOptions,
  ChannelCapacityExceededEvent,
} from "./capacity-types.js";

/**
 * A capacity-aware message bus that can enforce channel limits while maintaining
 * backward compatibility with the existing InternalMessageBus interface.
 *
 * When capacity tracking is disabled, this behaves identically to the original EventEmitter.
 * When enabled, it tracks message counts and blocks delivery to exhausted channels.
 */
export class CapacityAwareMessageBus extends EventEmitter {
  private capacityTracker?: ChannelCapacityTracker;

  constructor() {
    super();

    this.capacityTracker = new ChannelCapacityTracker();
    logger.info("[CapacityAwareMessageBus] Capacity tracking enabled");
  }

  /**
   * Enhanced emit that enforces capacity limits for new_message events
   */
  emit(event: string | symbol, ...args: any[]): boolean {
    // Only apply capacity logic to 'new_message' events when tracking is enabled
    if (event === "new_message" && this.capacityTracker && args.length > 0) {
      const messageData = args[0];

      // Validate message structure
      if (!messageData || typeof messageData !== "object") {
        logger.warn(
          "[CapacityAwareMessageBus] Invalid message data structure, bypassing capacity check"
        );
        return super.emit(event, ...args);
      }

      const channelId = messageData.channel_id;
      const authorId = messageData.author_id;

      if (!channelId) {
        logger.debug(
          "[CapacityAwareMessageBus] Message missing channel_id, bypassing capacity check"
        );
        return super.emit(event, ...args);
      }

      // Check if channel is globally exhausted
      if (this.capacityTracker.isChannelExhausted(channelId)) {
        const reason = this.capacityTracker.getExhaustionReason(channelId);

        logger.info(
          `[CapacityAwareMessageBus] Dropping message to exhausted channel ${channelId} (reason: ${reason})`
        );

        // Emit capacity exceeded event instead of the original message
        const capacityEvent: ChannelCapacityExceededEvent = {
          channelId,
          droppedMessage: messageData,
          reason: reason || "unknown",
          timestamp: Date.now(),
        };

        super.emit("channel_capacity_exceeded", capacityEvent);
        return false; // Don't distribute to MessageBusService instances
      }

      // Check if this specific participant can send another message
      const authorToTrack = authorId || ("system" as any);
      if (
        !this.capacityTracker.canParticipantSendMessage(
          channelId,
          authorToTrack
        )
      ) {
        logger.info(
          `[CapacityAwareMessageBus] Dropping message from participant ${authorToTrack} who has reached their limit in channel ${channelId}`
        );

        // Emit capacity exceeded event for participant limit
        const capacityEvent: ChannelCapacityExceededEvent = {
          channelId,
          droppedMessage: messageData,
          reason: "participant_limit",
          timestamp: Date.now(),
        };

        super.emit("channel_capacity_exceeded", capacityEvent);
        return false; // Don't distribute to MessageBusService instances
      }

      // Track the message (this may cause global channel exhaustion)
      this.capacityTracker.trackMessage(channelId, authorToTrack);

      // Check if this message caused the channel to become globally exhausted
      if (this.capacityTracker.isChannelExhausted(channelId)) {
        const reason = this.capacityTracker.getExhaustionReason(channelId);
        logger.info(
          `[CapacityAwareMessageBus] Channel ${channelId} exhausted after this message (reason: ${reason})`
        );

        // Still allow this message through since it was within limits when sent
        // Future messages will be dropped by the global exhaustion check above
      }
    }

    // Proceed with normal event emission
    return super.emit(event, ...args);
  }

  /**
   * Get the capacity tracker instance (for integration with other components)
   */
  getCapacityTracker(): ChannelCapacityTracker | undefined {
    return this.capacityTracker;
  }

  /**
   * Get capacity tracking statistics
   */
  getCapacityStats() {
    if (!this.capacityTracker) {
      return null;
    }

    return {
      ...this.capacityTracker.getStats(),
    };
  }
}
