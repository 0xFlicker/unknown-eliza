# Social Strategy Agent Documentation

This directory contains documentation for the Social Strategy Agent project, a sophisticated multi-agent system built on ElizaOS for playing the social strategy game "Influence".

## InfluenceApp - Multi-Agent Game Server

**Primary Documentation**: [`influence-app/`](./influence-app/)

The InfluenceApp is the core server infrastructure that orchestrates multi-agent gameplay sessions with advanced features like channel capacity management, real-time event streaming, and strategic intelligence systems.

### Quick Links

- **[InfluenceApp Overview](./influence-app/README.md)** - Getting started and feature overview
- **[API Reference](./influence-app/api-reference.md)** - Complete API documentation
- **[Channel Capacity System](./influence-app/channel-capacity.md)** - Advanced message limiting capabilities
- **[Game Event System](./influence-app/game-events.md)** - Real-time event coordination

## Implementation Status

✅ **Production Ready** - All core features implemented and tested
- Multi-agent game orchestration
- Channel capacity management with sophisticated limiting
- Real-time event streaming and coordination
- Strategic intelligence systems
- Comprehensive E2E test coverage

## Architecture Overview

The system is built on ElizaOS and consists of several key components:

### Core Infrastructure
- **InfluenceApp**: Main orchestrator for multi-agent game sessions
- **AgentManager**: Handles AI agent lifecycle and configuration
- **ChannelManager**: Manages communication channels with capacity limits
- **AssociationManager**: Tracks agent-channel relationships

### Advanced Features
- **Channel Capacity System**: Intelligent message limiting with participant vs channel exhaustion semantics
- **Game Event Streaming**: Observable real-time event distribution across agents
- **Strategic Intelligence**: Diary room systems and player relationship tracking
- **Message Streaming**: Real-time SocketIO-based message distribution

## Getting Started

```typescript
import { InfluenceApp } from '@/server';

const app = new InfluenceApp({
  dataDir: './game-data',
  serverPort: 3333,
  runtimeConfig: {
    defaultPlugins: [influencerPlugin, housePlugin],
  },
  context: { gameMode: 'influence' }
});

await app.initialize();
await app.start();

// Create agents and channels
const agent = await app.addAgent({ character, plugins });
const channelId = await app.createChannel({ name, participants, type });

// Subscribe to events
app.getGameEventStream().subscribe(event => {
  console.log(`Event: ${event.type} from ${event.sourceAgent}`);
});
```

## Development History

The complete development journey, including planning documents, architectural decisions, and implementation details, is preserved in [`.codex/InfluenceAppDevelopment.md`](../.codex/InfluenceAppDevelopment.md).

## Contributing

When adding new features or documentation:

1. **Update API Documentation**: Ensure `api-reference.md` reflects any API changes
2. **Update Feature Docs**: Add or update feature-specific documentation files
3. **Test Coverage**: Maintain comprehensive test coverage for new features
4. **Examples**: Include usage examples in documentation

## Support

For implementation questions or issues:
- Review the comprehensive API documentation
- Check the E2E test examples in `apps/agent/src/__tests__/influence/`
- Examine the actual implementation in `apps/agent/src/server/`