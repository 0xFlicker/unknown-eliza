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

## 2. Plugin End‑Goal Behavior to Mirror Discord Plugin

The architecture of this game is a multi-room chat environment for agents, with group rooms and DMs. Eventually we would like to support image generation and analysis. Therefor this package will likely adopt many of the patters of plugin-discord

> **End‑goal for this plugin:**  
> Map Message events into runtime/world/room/entity abstractions, and emit standardized events (`WORLD_JOINED`, `MESSAGE_RECEIVED`, etc.) so that the multi‑agent coordination layer can operate uniformly.

```typescript
// packages/plugin-discord/src/service.ts (excerpt)
private async handleGuildCreate(guild: Guild) {
  this.runtime.emitEvent([DiscordEventTypes.WORLD_JOINED], { runtime: this.runtime, server: guild, source: "discord" });
  this.runtime.emitEvent([EventType.WORLD_JOINED], standardizedData);
}

// packages/plugin-discord/src/messages.ts (excerpt)
this.runtime.emitEvent(
  [DiscordEventTypes.MESSAGE_RECEIVED, EventType.MESSAGE_RECEIVED],
  { runtime: this.runtime, message: newMessage, callback }
);
```

【F:packages/plugin-discord/src/service.ts†L529-L537】【F:packages/plugin-discord/src/messages.ts†L287-L295】

---

## 3. Coordination Channel Protocol

The Influence game’s House/Influencer agents exchange structured JSON messages over a dedicated “coordination” channel.

```typescript
// apps/agent/src/house/coordination/types.ts
export const COORDINATION_CHANNEL_ID = "00000000-0000-0000-0000-000000000001" as UUID;

export interface GameEventCoordinationMessage<T> {
  version: "1.0"; type: "game_event"; sourceAgent: UUID;
  targetAgents: UUID[]|"all"|"others"; messageId: UUID; timestamp: number;
  gameEventType: T; payload: GameEventPayloadMap[T];
}
… // AgentReady, Heartbeat, Ack messages + guards
```

【F:apps/agent/src/house/coordination/types.ts†L1-L53】【F:apps/agent/src/house/coordination/types.ts†L144-L163】

---

## 4. CoordinationService (House Plugin)

House’s `CoordinationService` wraps `sendMessageToTarget` into `sendGameEvent`/`sendAgentReady`, publishing JSON onto the coordination channel.

```typescript
// apps/agent/src/house/coordination/service.ts
async sendCoordinationMessage(msg: AnyCoordinationMessage): Promise<void> {
  await this.runtime.sendMessageToTarget(
    { roomId: COORDINATION_CHANNEL_ID, channelId: COORDINATION_CHANNEL_ID, source: "coordination" },
    { text: JSON.stringify(msg), source: this.runtime.agentId, action: "coordination" }
  );
}
```

【F:apps/agent/src/house/coordination/service.ts†L146-L167】

---

## 5. HousePlugin: Routing Coordination Messages

HousePlugin intercepts coordination‑channel messages, parses them, and dispatches to `handleGameEvent`, `handleAgentReady`, etc.

```typescript
// apps/agent/src/house/index.ts
events: {
  [EventType.MESSAGE_RECEIVED]: [
    async ({ message, runtime }) => {
      if (message.roomId !== COORDINATION_CHANNEL_ID) return;
      try {
        const parsed = JSON.parse(message.content.text!);
        if (isCoordinationMessage(parsed)) {
          const msg = parsed as AnyCoordinationMessage;
          if (/* msg.targetAgents includes runtime.agentId */) {
            switch (msg.type) {
              case "game_event":    await handleGameEvent(runtime, msg);    return;
              case "agent_ready":   await handleAgentReady(runtime, msg);   return;
              case "heartbeat":     await handleHeartbeat(runtime, msg);    return;
              case "coordination_ack": await handleCoordinationAck(runtime, msg); return;
            }
          }
        }
      } catch { /* ignore */ }
    },
  ],
},
services: [PhaseCoordinator, CoordinationService],
init: async (_cfg, runtime) => {
  await PhaseCoordinator.start(runtime);
  await CoordinationService.start(runtime);
},
```

【F:apps/agent/src/house/index.ts†L62-L104】【F:apps/agent/src/house/index.ts†L138-L145】

---

## 6. Synthetic Messages: Forcing Player Actions

When House broadcasts a game event (e.g. `DIARY_ROOM_OPENED`), it synthesizes a Memory so that player agents process it as if it were a normal incoming message and run their actions.

```typescript
// apps/agent/src/house/coordination/action.ts
case GameEventType.DIARY_ROOM_OPENED:
  await createSyntheticMessage(runtime, gameEventType, payload);

async function createSyntheticMessage(runtime, gameEventType, payload) {
  const text = `The diary room is now open for strategic thinking…`;
  const syntheticMessage: Memory = { … };
  const state = await runtime.composeState(syntheticMessage, ["GAME_STATE"]);
  await runtime.processActions(syntheticMessage, [], state);
}
```

【F:apps/agent/src/house/coordination/action.ts†L56-L61】【F:apps/agent/src/house/coordination/action.ts†L172-L194】

---

## 7. InfluencerPlugin: Player‑Side Hooks

The player plugin listens for the same `GameEventType.*` events and (e.g.) signals readiness or waits for synthetic diary messages to trigger diary‑room actions.

```typescript
// apps/agent/src/influencer/index.ts
[GameEventType.PHASE_STARTED]: [
  async ({ message, runtime }) => {
    if (message.payload.phase === Phase.INIT) {
      const coord = runtime.getService(CoordinationService.serviceType) as CoordinationService;
      await coord.sendGameEvent(GameEventType.I_AM_READY, { … });
    }
  },
],
[GameEventType.DIARY_ROOM_OPENED]: [
  async ({ message, runtime }) => {
    // synthetic diary messages will drive the diary room action
  },
],
```

【F:apps/agent/src/influencer/index.ts†L67-L75】【F:apps/agent/src/influencer/index.ts†L95-L104】

---
