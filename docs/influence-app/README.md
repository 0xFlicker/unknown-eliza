# InfluenceApp - Multi-Agent Game Server

**Status**: ✅ Production Ready  
**Last Updated**: 2025-07-11

InfluenceApp is a sophisticated multi-agent game server built on ElizaOS, designed specifically for the social strategy game "Influence". It provides a complete infrastructure for managing AI agents, channels, and real-time game events with advanced features like channel capacity limits and strategic intelligence systems.

## Overview

InfluenceApp enhances the standard ElizaOS runtime to support complex multi-agent game scenarios through:

1. **Agent Management** - Per-agent runtime configuration with custom decorators
2. **Game Event Streaming** - Observable real-time game event system
3. **Channel Capacity System** - Exhaustible conversation channels with participant limits
4. **Strategic Intelligence** - Diary room and strategic thinking capabilities

## Quick Start

```typescript
import { InfluenceApp } from '@/server';

const app = new InfluenceApp({
  dataDir: './game-data',
  serverPort: 3333,
  runtimeConfig: {
    defaultPlugins: [influencerPlugin, housePlugin],
    runtime: (runtime) => {
      // Custom runtime decorators
      return runtime;
    }
  },
  context: { gameMode: 'influence' }
});

await app.initialize();
await app.start();
```

## Core Architecture

### InfluenceApp Class
The main orchestrator that manages all game components:

- **AgentManager**: Creates and manages AI agent lifecycles
- **ChannelManager**: Handles communication channels with capacity limits
- **AssociationManager**: Manages agent-channel relationships
- **Game Event Streaming**: Real-time observable event system
- **Message Streaming**: Real-time message distribution

### Managers

#### AgentManager
Handles AI agent creation, configuration, and lifecycle management.

#### ChannelManager  
Creates and manages communication channels with support for:
- Participant modes (READ_WRITE, BROADCAST_ONLY, OBSERVE_ONLY)
- Participant states (FOLLOWED, MUTED)
- Channel capacity limits
- Runtime decorators for per-channel logic

#### AssociationManager
Manages relationships between agents and channels, supporting complex game scenarios.

## Key Features

### ✅ Implemented Features

#### Channel Capacity System
- **Per-participant limits**: Block individual agents when they reach `maxRepliesPerParticipant`
- **Total message limits**: Exhaust channels when `maxTotalMessages` reached
- **Conservative exhaustion**: Channels remain open for new participants until global limits hit
- **Real-time tracking**: Capacity information available to agents via providers

#### Game Event Streaming
- **Observable streams**: Subscribe to real-time game events
- **Cross-agent coordination**: Events distributed across all agents
- **Type-safe events**: Strongly typed event system with payload validation

#### Strategic Intelligence
- **Diary Room**: Private strategic thinking sessions
- **Player Intelligence**: Relationship tracking and strategic analysis
- **Phase Coordination**: Automated game phase transitions

#### Message Streaming
- **Real-time messaging**: SocketIO-based message distribution
- **Channel-specific streams**: Subscribe to individual channel messages
- **Message metadata**: Rich message context and routing information

## API Reference

### InfluenceApp Methods

```typescript
// Core lifecycle
await app.initialize()
await app.start()
await app.stop()

// Agent management
const agent = await app.addAgent(config)
const agentManager = app.getAgentManager()

// Channel management
const channelId = await app.createChannel(config)
const channelManager = app.getChannelManager()

// Messaging
await app.sendMessage(channelId, content, mentionAgentId?)
const messageStream = app.getChannelMessageStream(channelId)
const globalStream = app.getMessageStream()

// Game events
const eventStream = app.getGameEventStream()
const subscription = app.observeGameEvents(callback)

// Statistics
const stats = app.getStats()
```

## Configuration

### AppServerConfig
```typescript
interface AppServerConfig<AppContext, Runtime> {
  dataDir?: string;           // Data storage directory
  serverPort?: number;        // HTTP server port
  runtimeConfig?: {
    runtime?: RuntimeDecorator<Runtime>;
    defaultPlugins?: Plugin[];
    runtimeSettings?: RuntimeSettings;
  };
  context: AppContext;        // Application-specific context
}
```

### Channel Configuration
```typescript
interface ChannelConfig {
  name: string;
  participants: ChannelParticipant[];
  type: ChannelType;
  maxMessages?: number;          // Total message limit
  timeoutMs?: number;           // Channel timeout
  metadata?: any;               // Custom metadata
  runtimeDecorators?: RuntimeDecorator<Runtime, { channelId?: UUID }>[];
}
```

## Next Steps

See the individual documentation files for detailed information:

- [Channel Capacity System](./channel-capacity.md) - Complete capacity implementation details
- [Game Events](./game-events.md) - Event system architecture
- [Agent Management](./agent-management.md) - Agent lifecycle and configuration
- [Message Streaming](./message-streaming.md) - Real-time messaging system

## Status Summary

**✅ Production Ready**: All core features implemented and tested
- Channel capacity system with proper semantics
- Game event streaming with Observable support
- Agent management with custom decorators
- Real-time message streaming
- Strategic intelligence systems
- Comprehensive E2E test coverage

**🔧 Development Notes**: The system successfully handles complex multi-agent scenarios including the race condition fixes for database relationship creation.