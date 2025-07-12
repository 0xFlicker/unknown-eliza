# InfluenceApp API Reference

**Status**: ✅ Complete  
**Version**: 1.0.0

Complete API reference for the InfluenceApp multi-agent game server.

## Core Classes

### InfluenceApp<AgentContext, AppContext, Runtime>

The main orchestrator class for multi-agent game sessions.

#### Constructor
```typescript
constructor(config: AppServerConfig<AppContext, Runtime>)
```

#### Lifecycle Methods

##### `initialize(): Promise<void>`
Initializes the InfluenceApp with all managers and services.
- Creates AgentServer and MessageServer instances
- Sets up database connections
- Initializes House agent runtime
- Configures message and event streaming

##### `start(): Promise<void>`
Starts the HTTP server and begins accepting connections.

##### `stop(): Promise<void>`
Gracefully shuts down all services and cleans up resources.
- Stops managers with null-safe cleanup
- Closes server connections
- Terminates agent runtimes

#### Agent Management

##### `addAgent(config): Promise<Agent<AgentContext>>`
Creates and registers a new AI agent.

**Parameters:**
```typescript
config: {
  character: Character;
  plugins: Plugin[];
  metadata?: AgentContext;
}
```

**Returns:** `Promise<Agent<AgentContext>>` - The created agent instance

##### `getAgentManager(): AgentManager<AgentContext>`
Returns the agent manager instance for direct agent lifecycle control.

##### `getHouseAgent(): IAgentRuntime`
Returns the House agent runtime (game master).

#### Channel Management

##### `createChannel(config): Promise<UUID>`
Creates a new communication channel with optional capacity limits.

**Parameters:**
```typescript
config: {
  name: string;
  participants: ChannelParticipant[];
  type: ChannelType;
  maxMessages?: number;
  timeoutMs?: number;
  metadata?: any;
  runtimeDecorators?: RuntimeDecorator<Runtime, { channelId?: UUID }>[];
}
```

**Returns:** `Promise<UUID>` - The created channel ID

##### `getChannelManager(): ChannelManager`
Returns the channel manager for direct channel control.

##### `joinChannel(channelId: UUID): Promise<void>`
Joins the House agent to the specified channel.

#### Messaging

##### `sendMessage(channelId, content, mentionAgentId?): Promise<void>`
Sends a message to a channel as the House agent.

**Parameters:**
- `channelId: UUID` - Target channel
- `content: string` - Message content
- `mentionAgentId?: UUID` - Optional agent to mention

##### `broadcastMessage(content, channelIds?): Promise<void>`
Broadcasts a message to multiple channels.

**Parameters:**
- `content: string` - Message to broadcast
- `channelIds?: UUID[]` - Target channels (default: all channels)

#### Message Streaming

##### `getMessageStream(): Observable<StreamedMessage>`
Returns the global message stream for all channels.

##### `getChannelMessageStream(channelId): Observable<StreamedMessage>`
Returns a filtered stream for a specific channel.

**Parameters:**
- `channelId: UUID` - Channel to observe

#### Game Event System

##### `getGameEventStream(): Observable<GameEvent<any>>`
Returns the unified game event stream.

##### `observeGameEvents(callback): Subscription`
Subscribes to game events with a callback function.

**Parameters:**
```typescript
callback: (event: GameEvent<any>) => void
```

**Returns:** `Subscription` - RxJS subscription for cleanup

#### Statistics

##### `getStats(): AppStats`
Returns comprehensive application statistics.

**Returns:**
```typescript
{
  agents: AgentManagerStats;
  channels: ChannelManagerStats;
  associations: AssociationManagerStats;
  messageStreams: {
    totalChannels: number;
    globalStreamActive: boolean;
  };
}
```

##### `getServerPort(): number`
Returns the HTTP server port number.

## Configuration Interfaces

### AppServerConfig<AppContext, Runtime>
```typescript
interface AppServerConfig<AppContext, Runtime> {
  dataDir?: string;                    // Data storage directory
  serverPort?: number;                 // HTTP server port (default: auto-assigned)
  runtimeConfig?: {
    runtime?: RuntimeDecorator<Runtime>;           // Global runtime decorator
    defaultPlugins?: Plugin[];                     // Default plugins for all agents
    runtimeSettings?: RuntimeSettings;             // ElizaOS runtime settings
  };
  context: AppContext;                 // Application-specific context
}
```

### ChannelConfig
```typescript
interface ChannelConfig {
  name: string;                        // Channel display name
  participants: ChannelParticipant[];  // Initial participants
  type: ChannelType;                   // Channel type (GROUP, DM, etc.)
  maxMessages?: number;                // Total message limit
  timeoutMs?: number;                  // Channel timeout in milliseconds
  metadata?: any;                      // Custom metadata
  runtimeDecorators?: RuntimeDecorator<Runtime, { channelId?: UUID }>[];
}
```

### ChannelParticipant
```typescript
interface ChannelParticipant {
  agentId: UUID;                       // Agent identifier
  mode: ParticipantMode;               // Participation permissions
  state: ParticipantState;             // Current participation state
}
```

### ParticipantMode
```typescript
enum ParticipantMode {
  READ_WRITE = "read_write",           // Full participation
  BROADCAST_ONLY = "broadcast_only",   // Can send but doesn't receive replies
  OBSERVE_ONLY = "observe_only"        // Read-only participation
}
```

### ParticipantState
```typescript
enum ParticipantState {
  FOLLOWED = "FOLLOWED",               // Active participation
  MUTED = "MUTED"                      // Receive only, cannot send
}
```

## Event System

### GameEvent<T>
```typescript
interface GameEvent<T = any> {
  type: string;                        // Event type identifier
  payload: T;                          // Event-specific payload
  sourceAgent: UUID;                   // Agent that triggered the event
  channelId?: UUID;                    // Associated channel (if applicable)
  timestamp: number;                   // Unix timestamp
}
```

### StreamedMessage
```typescript
interface StreamedMessage {
  id: UUID;                            // Message identifier
  channelId: UUID;                     // Source channel
  authorId: UUID;                      // Message author
  content: string;                     // Message text content
  timestamp: number;                   // Creation timestamp
  metadata?: {
    senderName?: string;               // Author display name
    source?: string;                   // Message source type
    [key: string]: any;                // Additional metadata
  };
  source: "client" | "agent" | "system";  // Message source classification
}
```

## Manager APIs

### AgentManager<AgentContext>

#### `addAgent(config): Promise<Agent<AgentContext>>`
Creates a new agent with the specified configuration.

#### `getAgentRuntime(agentId): IAgentRuntime | undefined`
Retrieves an agent's runtime by ID.

#### `getStats(): AgentManagerStats`
Returns agent management statistics.

#### `cleanup(): Promise<void>`
Cleans up all managed agents and resources.

### ChannelManager

#### `createChannel(config): Promise<UUID>`
Creates a new channel with the specified configuration.

#### `getChannel(channelId): Channel | undefined`
Retrieves channel information by ID.

#### `getStats(): ChannelManagerStats`
Returns channel management statistics.

#### `cleanup(): Promise<void>`
Cleans up all managed channels and resources.

### AssociationManager

#### `createAssociation(association): Promise<void>`
Creates an agent-channel association.

#### `getAssociationsForAgent(agentId): AgentChannelAssociation[]`
Retrieves all associations for an agent.

#### `getAssociationsForChannel(channelId): AgentChannelAssociation[]`
Retrieves all associations for a channel.

#### `getStats(): AssociationManagerStats`
Returns association statistics.

#### `cleanup(): Promise<void>`
Cleans up all managed associations.

## Type Definitions

### RuntimeDecorator<Runtime, Context>
```typescript
type RuntimeDecorator<
  Runtime extends IAgentRuntime,
  Context extends Record<string, unknown> = Record<string, unknown>
> = (runtime: Runtime, context?: Context) => Runtime | Promise<Runtime>;
```

### Agent<AgentContext>
```typescript
interface Agent<AgentContext> {
  id: UUID;                            // Agent identifier
  character: Character;                // Agent personality and behavior
  runtime?: IAgentRuntime;             // Active runtime instance
  metadata?: AgentContext;             // Application-specific agent data
}
```

## Error Handling

### Common Error Patterns
- **Agent Not Found**: Methods return `undefined` for missing agents
- **Channel Not Found**: Throws descriptive errors for invalid channel operations
- **Capacity Exceeded**: Messages silently dropped, events emitted for monitoring
- **Initialization Errors**: Thrown during `initialize()` for configuration problems

### Best Practices
- Always check return values for `undefined` when retrieving agents/channels
- Subscribe to capacity exceeded events for limit monitoring
- Use try-catch blocks around initialization and cleanup methods
- Implement proper subscription cleanup for event streams

## Performance Notes

- **Memory Efficient**: Managers use Map-based storage for O(1) lookups
- **Streaming Optimized**: Message and event streams use RxJS for efficient distribution
- **Capacity Tracking**: Minimal overhead with real-time limit enforcement
- **Concurrent Safe**: Thread-safe operations for multi-agent scenarios