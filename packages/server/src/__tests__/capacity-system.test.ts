import { test, expect, describe } from "bun:test";
import { CapacityAwareMessageBus } from "../capacity-aware-bus.js";
import { ChannelCapacityTracker } from "../capacity-tracker.js";

describe("Channel Capacity System", () => {
  test("should track message counts correctly", () => {
    const tracker = new ChannelCapacityTracker();
    const channelId = "test-channel-id" as any;
    const agentId = "test-agent-id" as any;

    // Configure channel with limits
    tracker.setChannelConfig(channelId, {
      maxRepliesPerParticipant: 2,
      maxTotalMessages: 5,
    });

    // Track some messages
    tracker.trackMessage(channelId, agentId);
    tracker.trackMessage(channelId, agentId);

    const info = tracker.getCapacityInfo(channelId, agentId);
    expect(info.responsesRemaining).toBe(0);
    expect(info.totalMessagesRemaining).toBe(3);
    expect(info.isExhausted).toBe(false); // Channel not exhausted yet

    // Agent should not be able to send more messages
    expect(tracker.canParticipantSendMessage(channelId, agentId)).toBe(false);
  });

  test("should block participant when individual limit reached", () => {
    const tracker = new ChannelCapacityTracker();
    const channelId = "test-channel-id" as any;
    const agentId = "test-agent-id" as any;

    tracker.setChannelConfig(channelId, {
      maxRepliesPerParticipant: 1,
    });

    // Send first message - should be fine
    expect(tracker.canParticipantSendMessage(channelId, agentId)).toBe(true);
    tracker.trackMessage(channelId, agentId);
    expect(tracker.isChannelExhausted(channelId)).toBe(false); // Channel not exhausted

    // Participant should now be blocked
    expect(tracker.canParticipantSendMessage(channelId, agentId)).toBe(false);
  });

  test("should not exhaust channel based on participant limits alone", () => {
    const tracker = new ChannelCapacityTracker();
    const channelId = "test-channel-id" as any;
    const agent1Id = "test-agent-1" as any;
    const agent2Id = "test-agent-2" as any;

    tracker.setChannelConfig(channelId, {
      maxRepliesPerParticipant: 1,
    });

    // First agent sends message and reaches their limit
    tracker.trackMessage(channelId, agent1Id);
    expect(tracker.isChannelExhausted(channelId)).toBe(false); // Channel not exhausted
    expect(tracker.canParticipantSendMessage(channelId, agent1Id)).toBe(false); // But agent is blocked

    // Second agent can still participate
    expect(tracker.canParticipantSendMessage(channelId, agent2Id)).toBe(true);
    tracker.trackMessage(channelId, agent2Id);
    expect(tracker.isChannelExhausted(channelId)).toBe(false); // Still not exhausted
    expect(tracker.canParticipantSendMessage(channelId, agent2Id)).toBe(false); // Now agent2 is also blocked

    // Channel remains open for new participants
    const agent3Id = "test-agent-3" as any;
    expect(tracker.canParticipantSendMessage(channelId, agent3Id)).toBe(true);
  });

  test("should drop messages from participants who exceed their limits", () => {
    const bus = new CapacityAwareMessageBus();
    const tracker = bus.getCapacityTracker()!;

    const channelId = "test-channel-id";
    const agentId = "test-agent-id";

    // Configure participant limit
    tracker.setChannelConfig(channelId as any, {
      maxRepliesPerParticipant: 1,
    });

    let messagesReceived = 0;
    let capacityExceededEvents = 0;

    bus.on("new_message", () => {
      messagesReceived++;
    });

    bus.on("channel_capacity_exceeded", () => {
      capacityExceededEvents++;
    });

    // First message should go through
    bus.emit("new_message", {
      channel_id: channelId,
      author_id: agentId,
      content: "First message",
    });

    expect(messagesReceived).toBe(1);
    expect(capacityExceededEvents).toBe(0);

    // Second message from same agent should be dropped due to participant limit
    bus.emit("new_message", {
      channel_id: channelId,
      author_id: agentId,
      content: "Second message",
    });

    expect(messagesReceived).toBe(1); // Still 1, second message was dropped
    expect(capacityExceededEvents).toBe(1); // Capacity exceeded event was emitted
  });

  test("should exhaust channel when total message limit reached", () => {
    const bus = new CapacityAwareMessageBus();
    const tracker = bus.getCapacityTracker()!;

    const channelId = "test-channel-id";
    const agent1Id = "test-agent-1";
    const agent2Id = "test-agent-2";

    // Configure total message limit
    tracker.setChannelConfig(channelId as any, {
      maxTotalMessages: 2,
    });

    let messagesReceived = 0;
    let capacityExceededEvents = 0;

    bus.on("new_message", () => {
      messagesReceived++;
    });

    bus.on("channel_capacity_exceeded", () => {
      capacityExceededEvents++;
    });

    // First two messages should go through
    bus.emit("new_message", {
      channel_id: channelId,
      author_id: agent1Id,
      content: "First message",
    });

    bus.emit("new_message", {
      channel_id: channelId,
      author_id: agent2Id,
      content: "Second message",
    });

    expect(messagesReceived).toBe(2);
    expect(capacityExceededEvents).toBe(0);

    // Third message should be dropped due to channel exhaustion
    bus.emit("new_message", {
      channel_id: channelId,
      author_id: agent1Id,
      content: "Third message",
    });

    expect(messagesReceived).toBe(2); // Still 2, third message was dropped
    expect(capacityExceededEvents).toBe(1); // Capacity exceeded event was emitted
  });

  test("should handle messages without proper structure gracefully", () => {
    const bus = new CapacityAwareMessageBus();

    let messagesReceived = 0;
    bus.on("new_message", () => {
      messagesReceived++;
    });

    // Send message without proper structure - should bypass capacity check
    bus.emit("new_message", null);
    bus.emit("new_message", { invalid: "structure" });
    bus.emit("new_message", "not an object");

    expect(messagesReceived).toBe(3); // All should go through
  });
});
