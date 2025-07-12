# Game Event System

**Status**: ✅ Fully Implemented  
**Location**: `apps/agent/src/server/influence-app.ts`

The game event system provides real-time, observable streams of game events for coordination and monitoring across all agents in an Influence game session.

## Overview

The event system captures and distributes game events from two sources:
1. **Runtime Events**: Direct agent runtime `emitEvent()` calls
2. **Internal Message Bus**: System-level coordination events

All events are unified into a single observable stream with consistent payload structure.

## Core Components

### GameEvent Interface
```typescript
interface GameEvent<T = any> {
  type: string;           // Event type identifier
  payload: T;             // Event-specific data
  sourceAgent: UUID;      // Agent that triggered the event
  channelId?: UUID;       // Channel context (if applicable)
  timestamp: number;      // Unix timestamp
}
```

### Event Stream API
```typescript
// Get the observable event stream
const eventStream: Observable<GameEvent> = app.getGameEventStream();

// Subscribe to specific events
const subscription = app.observeGameEvents((event) => {
  console.log(`Event: ${event.type} from ${event.sourceAgent}`);
});
```

## Implementation Architecture

### Event Capture Mechanism

#### Runtime Event Hooking
```typescript
// In InfluenceApp constructor - patches each runtime's emitEvent
const hookEvents: RuntimeDecorator<Runtime> = (runtime) => {
  const originalEmit = runtime.emitEvent.bind(runtime);
  runtime.emitEvent = async (eventType, payload) => {
    const gameEvent: GameEvent = {
      type: Array.isArray(eventType) ? eventType[0] : eventType,
      payload,
      sourceAgent: runtime.agentId,
      channelId: extractChannelId(payload),
      timestamp: Date.now(),
    };
    this.gameEvent$.next(gameEvent);
    return originalEmit(eventType, payload);
  };
  return runtime;
};
```

#### Message Bus Integration
```typescript
// In setupGameEventStreaming()
fromEvent(internalMessageBus, 'game_event', (type, payload) => ({ type, payload }))
  .pipe(
    map(({ type, payload }) => ({
      type,
      payload,
      sourceAgent: payload.source || 'system',
      channelId: extractChannelId(payload),
      timestamp: Date.now(),
    }))
  )
  .subscribe(this.gameEvent$);
```

## Event Types

### Phase Events
```typescript
GameEventType.PHASE_STARTED   // Game phase transitions
GameEventType.PHASE_ENDED     // Phase completion
GameEventType.I_AM_READY      // Agent readiness signaling
```

### Strategic Events
```typescript
GameEventType.DIARY_ROOM_ENTRY     // Agent enters diary room
GameEventType.STRATEGY_UPDATED     // Strategic thinking complete
GameEventType.RELATIONSHIP_CHANGED // Agent relationship updates
```

### Channel Events
```typescript
'CHANNEL_EXHAUSTED'           // Channel capacity reached
'CHANNEL_CREATED'            // New channel available
'PARTICIPANT_BLOCKED'        // Participant hit message limit
```

## Usage Examples

### Basic Event Subscription
```typescript
const app = new InfluenceApp(config);
await app.initialize();

// Subscribe to all events
app.getGameEventStream().subscribe((event) => {
  console.log(`[${event.type}] ${event.sourceAgent}: ${JSON.stringify(event.payload)}`);
});
```

### Filtered Event Handling
```typescript
// Listen for specific event types
app.getGameEventStream()
  .pipe(
    filter(event => event.type === GameEventType.PHASE_STARTED),
    map(event => event.payload as PhaseStartedPayload)
  )
  .subscribe((payload) => {
    console.log(`Phase transition: ${payload.previousPhase} → ${payload.phase}`);
  });
```

### Phase Transition Tracking
```typescript
const phaseTransitions: Array<{ from: Phase; to: Phase; timestamp: number }> = [];

app.getGameEventStream().subscribe((event) => {
  if (event.type === GameEventType.PHASE_STARTED) {
    const payload = event.payload as PhaseStartedPayload;
    phaseTransitions.push({
      from: payload.previousPhase,
      to: payload.phase,
      timestamp: event.timestamp,
    });
  }
});
```

### Channel-Specific Events
```typescript
// Filter events for a specific channel
const channelEvents = app.getGameEventStream()
  .pipe(
    filter(event => event.channelId === specificChannelId)
  );

channelEvents.subscribe((event) => {
  console.log(`Channel ${event.channelId} event: ${event.type}`);
});
```

## Integration with Game Logic

### Coordination Service Integration
The event system integrates with the coordination service for cross-agent communication:

```typescript
// In plugin event handlers
export const gameEventHandlers: GameEventHandlers = {
  [GameEventType.PHASE_STARTED]: [
    async ({ message, runtime }) => {
      const phase = message.payload.phase;
      if (phase === Phase.LOBBY) {
        // Emit readiness signal
        await runtime.emitEvent(GameEventType.I_AM_READY, {
          playerId: runtime.agentId,
          targetPhase: Phase.WHISPER,
          timestamp: Date.now(),
        });
      }
    },
  ],
};
```

### Strategic Intelligence Integration
Events drive the strategic intelligence system:

```typescript
// Diary room entries triggered by phase events
app.getGameEventStream()
  .pipe(
    filter(event => event.type === GameEventType.PHASE_ENDED)
  )
  .subscribe(async (event) => {
    const payload = event.payload as PhaseEndedPayload;
    if (payload.phase === Phase.LOBBY) {
      // Trigger diary room evaluations
      await triggerDiaryRoomSessions(payload.participants);
    }
  });
```

## Event Payload Examples

### Phase Started Event
```typescript
{
  type: "PHASE_STARTED",
  payload: {
    gameId: "game-123",
    phase: Phase.LOBBY,
    previousPhase: Phase.INIT,
    roomId: "channel-456",
    participants: ["agent-1", "agent-2", "agent-3"],
    settings: { /* game settings */ },
    timestamp: 1641234567890
  },
  sourceAgent: "house-agent-id",
  channelId: "channel-456",
  timestamp: 1641234567890
}
```

### Strategic Event
```typescript
{
  type: "STRATEGY_UPDATED",
  payload: {
    playerId: "agent-1",
    strategy: "alliance-building",
    targets: ["agent-2", "agent-3"],
    confidence: 0.8,
    reasoning: "Building early alliances for protection"
  },
  sourceAgent: "agent-1",
  channelId: "diary-room-channel",
  timestamp: 1641234567890
}
```

## Performance Characteristics

### Memory Management
- **Subject-based**: Uses RxJS Subject for efficient multicast
- **Automatic Cleanup**: Subscriptions automatically cleaned up on app stop
- **Buffering**: No event buffering - events are live-streamed only

### Scalability
- **Efficient Distribution**: Single Subject distributes to multiple subscribers
- **Minimal Overhead**: Event creation has negligible performance impact
- **Type Safety**: Full TypeScript support for event types and payloads

## Testing Integration

### E2E Test Validation
The event system is validated in the comprehensive E2E test:

```typescript
// In strategy-diary-room.test.ts
const gameEvents: Array<GameEvent<any>> = [];
const phaseTransitions: Array<{ from: Phase; to: Phase; timestamp: number }> = [];

app.getGameEventStream().subscribe((event) => {
  gameEvents.push(event);
  if (event.type === GameEventType.PHASE_STARTED) {
    const payload = event.payload as PhaseStartedPayload;
    phaseTransitions.push({
      from: payload.previousPhase,
      to: payload.phase,
      timestamp: event.timestamp,
    });
  }
});
```

### Event Verification
Tests verify that expected events are emitted:
- Phase transition events
- Strategic thinking completion
- Diary room session events
- Coordination events

## Error Handling

### Event Stream Resilience
- **Non-blocking**: Event emission never blocks message processing
- **Error Isolation**: Failed event handlers don't affect other subscribers
- **Graceful Degradation**: System continues if event streaming fails

### Debugging Support
- **Comprehensive Logging**: All events logged with context
- **Event Inspection**: Observable streams support debugging operators
- **Payload Validation**: Type-safe event payload structures

## Future Extensibility

The event system is designed for easy extension:
- **Plugin Events**: Plugins can emit custom event types
- **Event Filtering**: Built-in support for complex event filtering
- **Event Persistence**: Future versions could add event persistence
- **Event Replay**: Observable nature supports event replay capabilities