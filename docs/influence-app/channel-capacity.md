# Channel Capacity System

**Status**: ✅ Fully Implemented  
**Location**: `packages/server/src/capacity-*`

The channel capacity system provides exhaustible conversation channels with sophisticated participant and message limiting capabilities, essential for the Influence game mechanics.

## Overview

The capacity system implements "defense-in-depth" enforcement at multiple architectural layers:

1. **CapacityAwareMessageBus**: Primary enforcement at the message distribution layer
2. **ChannelCapacityTracker**: Core tracking logic with proper participant vs channel semantics
3. **Runtime Decorators**: Channel-specific capacity context injection

## Key Components

### CapacityAwareMessageBus
```typescript
// packages/server/src/capacity-aware-bus.ts
class CapacityAwareMessageBus extends EventEmitter {
  private capacityTracker?: ChannelCapacityTracker;
  
  // Drop-in replacement for standard message bus
  // Optional capacity tracking via constructor option
}
```

**Features**:
- Backward compatible EventEmitter replacement
- Capacity tracking enabled by default (no configuration needed)
- Automatic message dropping when limits exceeded
- Capacity exceeded events for monitoring

### ChannelCapacityTracker
```typescript
// packages/server/src/capacity-tracker.ts
class ChannelCapacityTracker {
  // Core capacity management
  setChannelConfig(channelId: UUID, config: ChannelConfig): void
  trackMessage(channelId: UUID, authorId: UUID): void
  canParticipantSendMessage(channelId: UUID, participantId: UUID): boolean
  isChannelExhausted(channelId: UUID): boolean
  getCapacityInfo(channelId: UUID, agentId: UUID): ChannelCapacityInfo
}
```

**Core Logic**:
- **Individual Participant Limits**: Block participants when they reach `maxRepliesPerParticipant`
- **Channel Global Limits**: Exhaust channels only when `maxTotalMessages` reached
- **Conservative Exhaustion**: Channels remain open for new participants even when some are blocked

## Configuration

### Channel Capacity Config
```typescript
interface ChannelCapacityConfig {
  maxRepliesPerParticipant?: number;  // Individual participant limit
  maxTotalMessages?: number;          // Global channel limit
}
```

### Capacity State
```typescript
interface ChannelCapacityState {
  channelId: UUID;
  maxRepliesPerParticipant?: number;
  maxTotalMessages?: number;
  participantCounts: Map<UUID, number>;
  totalMessageCount: number;
  isExhausted: boolean;
  exhaustedAt?: number;
  exhaustionReason?: 'total_limit';
}
```

## Key Design Principles

### Participant vs Channel Limits
**Critical Distinction**: Individual participants are blocked when reaching `maxRepliesPerParticipant`, but channels remain open for new participants until `maxTotalMessages` reached.

```typescript
// Participant blocked, but channel stays open
canParticipantSendMessage(channelId, participantId) // false for this participant
isChannelExhausted(channelId) // false - channel still available for others
```

### Conservative Channel Exhaustion
Channels are NOT exhausted when individual participants hit limits - only when:
1. Total message capacity reached (`maxTotalMessages`)
2. Explicit timeout occurs
3. All expected participants have exhausted their budgets (requires predefined participant list)

### Backward Compatibility
The capacity system is a drop-in replacement for the existing message bus:
- `packages/server/src/bus.ts` exports `CapacityAwareMessageBus`
- No configuration required - capacity tracking enabled by default
- Existing code continues to work without changes

## Usage Examples

### Basic Channel with Limits
```typescript
const channelId = await app.createChannel({
  name: "limited-discussion",
  participants: [...],
  type: ChannelType.GROUP,
  // Capacity configuration
  maxMessages: 50,              // Global limit
  runtimeDecorators: [
    async (runtime, { channelId }) => {
      // Configure capacity for this channel
      const tracker = getCapacityTracker();
      tracker.setChannelConfig(channelId, {
        maxRepliesPerParticipant: 5,  // Each participant can send 5 messages
        maxTotalMessages: 50          // Channel exhausted at 50 total messages
      });
      return runtime;
    }
  ]
});
```

### Capacity Information for Agents
```typescript
// In a provider
const info = tracker.getCapacityInfo(channelId, agentId);
console.log({
  responsesRemaining: info.responsesRemaining,      // Individual limit
  totalMessagesRemaining: info.totalMessagesRemaining, // Global limit
  isExhausted: info.isExhausted                     // Channel state
});
```

## Implementation Details

### Message Flow Integration
The capacity system integrates into the ElizaOS message flow:

1. **InfluenceApp.sendMessage()** → Creates initial stimulus
2. **internalMessageBus** → Distributes messages (capacity-aware)
3. **MessageBusService.handleIncomingMessage()** → Validates and processes
4. **MessageBusService.sendAgentResponseToBus()** → Agents respond via HTTP API
5. **AgentServer.createMessage()** → Persists and emits back to bus
6. **Loop continues** through capacity-aware message bus

### Capacity Events
```typescript
// Emitted when capacity limits reached
bus.on('channel_capacity_exceeded', (event) => {
  console.log(`Channel ${event.channelId} capacity exceeded`);
  console.log(`Reason: ${event.reason}`);
  console.log(`Dropped message from: ${event.droppedMessage.author_id}`);
});
```

## Testing

### Comprehensive Test Suite
Location: `packages/server/src/__tests__/capacity-system.test.ts`

**Test Coverage**:
- Individual participant blocking
- Channel exhaustion scenarios
- Message dropping behavior
- Capacity information accuracy
- Event emission verification
- Edge cases and error handling

### Integration Testing
The capacity system is validated in the E2E test:
`apps/agent/src/__tests__/influence/strategy-diary-room.test.ts`

This test exercises the complete system including:
- Channel creation with capacity limits
- Agent interactions within limits
- Game state preloading with race condition handling
- Real-time message streaming with capacity enforcement

## Performance Characteristics

- **Memory Efficient**: Only tracks active channels
- **Minimal Overhead**: Simple Map-based tracking
- **Real-time**: Immediate capacity checking and enforcement
- **Scalable**: Designed for multi-agent conversation volumes

## Error Handling

The system follows an "error-first" approach:
- HTTP API rejections bubble up naturally
- Capacity violations result in message dropping (not exceptions)
- Comprehensive logging for debugging capacity issues
- Graceful degradation when capacity tracking disabled

## Migration Notes

The capacity system was implemented to replace the existing message bus with zero breaking changes. Existing code continues to work while gaining capacity enforcement capabilities automatically.