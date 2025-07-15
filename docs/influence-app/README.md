# InfluenceApp - Multi-Agent Game Server

**Status**: ✅ Production Ready  
**Last Updated**: 2025-07-15

InfluenceApp is a sophisticated multi-agent game server built on ElizaOS, designed specifically for the social strategy game "Influence". It provides a complete infrastructure for managing AI agents, channels, and real-time game events with advanced features like channel capacity limits and strategic intelligence systems.

## Overview

InfluenceApp enhances the standard ElizaOS runtime to support complex multi-agent game scenarios through:

1. **Agent Management** - Per-agent runtime configuration with custom decorators
2. **Game Management** - Complete game lifecycle management with GameManager
3. **Cross-Agent Coordination** - Type-safe event coordination via coordinator plugin
4. **Channel Capacity System** - Exhaustible conversation channels with participant limits
5. **Strategic Intelligence** - Diary room and strategic thinking capabilities

## Quick Start

```typescript
import { InfluenceApp } from '@/server';

const app = new InfluenceApp({
  dataDir: './game-data',
  serverPort: 3333,
  runtimeConfig: {
    defaultPlugins: [coordinatorPlugin, influencerPlugin, housePlugin],
    runtime: (runtime) => {
      // Custom runtime decorators
      return runtime;
    }
  },
  context: { gameMode: 'influence' }
});

await app.initialize();
await app.start();

// Create a game session
const gameId = await app.createGame({
  players: [player1.id, player2.id],
  settings: { minPlayers: 2, maxPlayers: 4 },
  initialPhase: Phase.INIT
});

// Create a game channel with pre-loaded game state
const channelId = await app.createGameChannel(gameId, {
  name: "main-game",
  participants: [...],
  type: ChannelType.GROUP
});
```

## Core Architecture

### InfluenceApp Class

The main orchestrator that manages all game components:

- **AgentManager**: Creates and manages AI agent lifecycles
- **ChannelManager**: Handles communication channels with capacity limits
- **AssociationManager**: Manages agent-channel relationships
- **GameManager**: Manages game sessions and game-specific channels
- **Coordinator Plugin**: Cross-agent event coordination and messaging
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

#### GameManager

Manages game sessions and game-specific channels:

- Creates and tracks game sessions with unique IDs
- Associates channels with specific games
- Injects game state into agents when they join game channels
- Provides game lifecycle management

## Key Features

### ✅ Implemented Features

#### Channel Capacity System

- **Per-participant limits**: Block individual agents when they reach `maxRepliesPerParticipant`
- **Total message limits**: Exhaust channels when `maxTotalMessages` reached
- **Conservative exhaustion**: Channels remain open for new participants until global limits hit
- **Real-time tracking**: Capacity information available to agents via providers

#### Cross-Agent Coordination

- **Coordinator Plugin**: Centralized event coordination between agents
- **Type-safe events**: Strongly typed game event system with payload validation
- **Internal Message Bus**: Efficient inter-agent communication
- **Event Targeting**: Precise event routing to specific agents or groups

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

// Game management
const gameId = await app.createGame(config)
const channelId = await app.createGameChannel(gameId, channelConfig)
const gameManager = app.getGameManager()
const game = app.getGame(gameId)

// Statistics
const stats = app.getStats()
```

## Configuration

### AppServerConfig

```typescript
interface AppServerConfig<AppContext, Runtime> {
  dataDir?: string; // Data storage directory
  serverPort?: number; // HTTP server port
  runtimeConfig?: {
    runtime?: RuntimeDecorator<Runtime>;
    defaultPlugins?: Plugin[];
    runtimeSettings?: RuntimeSettings;
  };
  context: AppContext; // Application-specific context
}
```

### Channel Configuration

```typescript
interface ChannelConfig {
  name: string;
  participants: ChannelParticipant[];
  type: ChannelType;
  maxMessages?: number; // Total message limit
  timeoutMs?: number; // Channel timeout
  metadata?: any; // Custom metadata
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

## Recent Changes (v0.2.0)

### Major Architecture Updates

**Game Management System**

- Added **GameManager** for complete game session lifecycle management
- Game sessions now have proper unique IDs and state tracking
- Channels are automatically associated with games
- Game state is pre-loaded into agents when they join game channels

**Coordinator Plugin Architecture**

- **BREAKING**: Game events moved from InfluenceApp to coordinator plugin
- Cross-agent coordination now handled by CoordinationService
- Type-safe event system with proper payload validation
- Plugin-based event handlers for game events
- Improved message targeting (all, others, specific agents)

**Event System Refactor**

- Game events now use coordinator plugin instead of direct InfluenceApp streaming
- Events are distributed via internal message bus with proper filtering
- Plugin event handlers provide better separation of concerns
- Type-safe event coordination with GameEventPayloadMap

### Migration Guide

**For Existing Code:**

1. Add `coordinatorPlugin` to all agents that need cross-agent coordination
2. Use `CoordinationService.sendGameEvent()` instead of direct event emission
3. Update event handlers to use plugin event system
4. Use `GameManager` methods for game lifecycle management

**New Methods:**

- `app.createGame(config)` - Create game sessions
- `app.createGameChannel(gameId, config)` - Create game-specific channels
- `app.getGameManager()` - Access game management functionality
