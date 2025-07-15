# Game Event System

**Status**: ✅ Fully Implemented  
**Location**: `apps/agent/src/plugins/coordinator/`

The game event system provides real-time, type-safe coordination between agents in an Influence game session through the coordinator plugin architecture.

## Overview

The event system is built around the **Coordinator Plugin** architecture, providing:

1. **Cross-Agent Coordination**: Events distributed via internal message bus
2. **Type-Safe Events**: Strongly typed game events with payload validation
3. **Plugin Integration**: Event handlers in agent plugins (house, influencer)
4. **Message Targeting**: Precise event routing to specific agents or groups

The system ensures reliable coordination between agents while maintaining type safety and performance.

## Core Components

### CoordinationService

The central service that manages cross-agent communication:

```typescript
// Located in apps/agent/src/plugins/coordinator/service.ts
export class CoordinationService extends Service {
  static serviceType = "coordination";

  // Send type-safe game events
  async sendGameEvent<T extends keyof GameEventPayloadMap>(
    payload: GameEventPayloadMap[T],
    targetAgents: UUID[] | "all" | "others" = "others",
  ): Promise<void>;

  // Send ready signals
  async sendAgentReady(config: AgentReadyConfig): Promise<void>;
}
```

### GameEventCoordinationMessage

```typescript
interface GameEventCoordinationMessage<T extends keyof GameEventPayloadMap> {
  messageId: string;
  timestamp: number;
  sourceAgent: UUID;
  targetAgents: UUID[] | "all" | "others";
  type: "coordination_message";
  payload: GameEventPayloadMap[T];
}
```

### Event Bus Integration

```typescript
// Located in apps/agent/src/plugins/coordinator/bus.ts
export const gameEvent$ = fromEvent(internalMessageBus, "game_event").pipe(
  filter(
    (event): event is AnyCoordinationMessage =>
      event.type === "coordination_message",
  ),
);
```

## Implementation Architecture

### Plugin-Based Event System

#### Coordinator Plugin Registration

```typescript
// All agents register the coordinator plugin
import { coordinatorPlugin } from "@/plugins/coordinator";

const agent = new AgentRuntime({
  character: playerCharacter,
  plugins: [coordinatorPlugin, influencerPlugin /* ... */],
});
```

#### Event Service Integration

```typescript
// In CoordinationService.start()
service.subscriptions.push(
  gameEvent$.subscribe(async (message) => {
    const { targetAgents } = message;

    // Check if this agent is targeted
    const targeted =
      targetAgents === "all" ||
      (targetAgents === "others" && message.sourceAgent !== runtime.agentId) ||
      (Array.isArray(targetAgents) && targetAgents.includes(runtime.agentId));

    if (!targeted) return;

    // Emit to plugin event handlers
    await runtime.emitEvent(message.payload.type, {
      ...message.payload,
      runtime,
    });
  }),
);
```

#### Plugin Event Handlers

```typescript
// In influencer plugin
export const influencerPlugin: Plugin = {
  events: {
    [GameEventType.ARE_YOU_READY]: [
      async ({ runtime, gameId, roomId, readyType, targetPhase }) => {
        const coordinationService = runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;

        await coordinationService.sendGameEvent(
          {
            gameId,
            roomId,
            playerId: runtime.agentId,
            playerName: runtime.character?.name || "Unknown Player",
            readyType,
            targetPhase,
            timestamp: Date.now(),
            runtime,
            source: "influencer-plugin",
            type: GameEventType.I_AM_READY,
          },
          "others",
        );
      },
    ],
  },
};
```

## Event Types

### Phase Events

```typescript
GameEventType.PHASE_TRANSITION_INITIATED = "GAME:PHASE_TRANSITION_INITIATED";
GameEventType.PHASE_STARTED = "GAME:PHASE_STARTED";
GameEventType.PHASE_ENDED = "GAME:PHASE_ENDED";
```

### Player Coordination Events

```typescript
GameEventType.ARE_YOU_READY = "GAME:ARE_YOU_READY";
GameEventType.PLAYER_READY = "GAME:PLAYER_READY";
GameEventType.ALL_PLAYERS_READY = "GAME:ALL_PLAYERS_READY";
GameEventType.I_AM_READY = "GAME:I_AM_READY";
```

### Strategic Events

```typescript
GameEventType.STRATEGIC_THINKING_REQUIRED = "GAME:STRATEGIC_THINKING_REQUIRED";
GameEventType.STRATEGIC_THINKING_COMPLETED =
  "GAME:STRATEGIC_THINKING_COMPLETED";
GameEventType.DIARY_ROOM_OPENED = "GAME:DIARY_ROOM_OPENED";
GameEventType.DIARY_ROOM_COMPLETED = "GAME:DIARY_ROOM_COMPLETED";
```

### Timer Events

```typescript
GameEventType.TIMER_WARNING = "GAME:TIMER_WARNING";
GameEventType.TIMER_EXPIRED = "GAME:TIMER_EXPIRED";
```

### Game State Events

```typescript
GameEventType.GAME_STATE_CHANGED = "GAME:GAME_STATE_CHANGED";
GameEventType.ROUND_STARTED = "GAME:ROUND_STARTED";
GameEventType.ROUND_ENDED = "GAME:ROUND_ENDED";
```

## Usage Examples

### Sending Game Events

```typescript
// In a plugin or service
const coordinationService = runtime.getService(
  CoordinationService.serviceType,
) as CoordinationService;

// Send ARE_YOU_READY to all other agents
await coordinationService.sendGameEvent(
  {
    type: GameEventType.ARE_YOU_READY,
    gameId: "game-123",
    roomId: "channel-456",
    readyType: "strategic_thinking",
    targetPhase: Phase.LOBBY,
    timestamp: Date.now(),
    runtime,
    source: "house-plugin",
  },
  "others",
);
```

### Plugin Event Handlers

```typescript
// In plugin definition
export const myPlugin: Plugin = {
  events: {
    [GameEventType.PHASE_STARTED]: [
      async ({ runtime, phase, gameId, roomId }) => {
        console.log(`Phase started: ${phase} in game ${gameId}`);

        // Respond to phase change
        if (phase === Phase.LOBBY) {
          await coordinationService.sendGameEvent(
            {
              type: GameEventType.I_AM_READY,
              gameId,
              roomId,
              playerId: runtime.agentId,
              playerName: runtime.character?.name || "Unknown Player",
              readyType: "phase_action",
              targetPhase: Phase.WHISPER,
              timestamp: Date.now(),
              runtime,
              source: "my-plugin",
            },
            "others",
          );
        }
      },
    ],
  },
};
```

### Phase Transition Tracking

```typescript
const phaseTransitions: Array<{ from: Phase; to: Phase; timestamp: number }> =
  [];

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
const channelEvents = app
  .getGameEventStream()
  .pipe(filter((event) => event.channelId === specificChannelId));

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
app
  .getGameEventStream()
  .pipe(filter((event) => event.type === GameEventType.PHASE_ENDED))
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
const phaseTransitions: Array<{ from: Phase; to: Phase; timestamp: number }> =
  [];

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
