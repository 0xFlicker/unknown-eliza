# Cross‑Channel Coordination in ElizaOS Plugins

This document captures the research and design for cross‑channel, multi‑agent communication in ElizaOS, with a focus on the Influence game’s House and Influencer plugins. It records:

1.  **Informational context** from the ElizaOS runtime and bootstrap plugin
2.  **End‑goal behavior** for the eventual Discord plugin
3.  The **coordination channel protocol** and implementation in the House/Influencer plugins

---

## 1. ElizaOS Runtime & Bootstrap Plug‑in (Informational)

### 1.1 AgentRuntime Core

The `AgentRuntime` is the central orchestrator that manages character config, plugins, services, message routing, and memory. All stateful I/O (messages, memories, entities, rooms, worlds) flows through it.

Key methods (informational):

```typescript
// packages/core/src/runtime.ts
class AgentRuntime implements IAgentRuntime {
  registerSendHandler(source: string, handler: SendHandlerFunction): void { … }
  async sendMessageToTarget(target: TargetInfo, content: Content): Promise<void> { … }
  async emitEvent(event: string | string[], params: any): Promise<void> { … }
  async createMemory(memory: Memory, tableName?: string): Promise<Memory> { … }
  async ensureConnection(params: {entityId,roomId,worldId,…}): Promise<void> { … }
  async ensureConnections(entities, rooms, source, world): Promise<void> { … }
  async composeState(message: Memory, includeList?: string[]): Promise<State> { … }
}
```

【F:packages/core/src/runtime.ts†L2062-L2076】【F:packages/core/src/runtime.ts†L879-L896】

### 1.2 Bootstrap Plugin

The built‑in bootstrap plugin standardizes multi‑world/room/entity syncing and implements the generic MESSAGE_RECEIVED → action/evaluator pipeline.

```typescript
// packages/plugin-bootstrap/src/index.ts
// On WORLD_JOINED / WORLD_CONNECTED:
await runtime.ensureConnections(entities, rooms, source, world);

// On ENTITY_JOINED:
await runtime.ensureConnection({ entityId, roomId, worldId, type, source, … });

// On MESSAGE_RECEIVED / VOICE_MESSAGE_RECEIVED:
await messageReceivedHandler({ runtime, message, callback, onComplete });
```

【F:packages/plugin-bootstrap/src/index.ts†L1180-L1246】【F:packages/plugin-bootstrap/src/index.ts†L1433-L1470】

---
