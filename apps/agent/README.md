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

## 2. Influence – Introduction Phase (Implementation Summary)

This app implements the Introduction phase with structured game events, phase‑coupled player state, and LLM‑generated, one‑message replies that bypass the generic reply action when appropriate. See `INTRODUCTION_PHASE.md` for the full design.

Key pieces:

- House emits structured events when it posts prompts

  - File: `src/plugins/house/index.ts`
  - Emits `GAME:PHASE_STARTED` when posting the introduction prompt
  - Emits `GAME:DIARY_PROMPT` when posting per‑player diary questions
  - Forwards player messages as `GAME:MESSAGE_SENT`

- Coordinator event payloads

  - File: `src/plugins/coordinator/types.ts`
  - Adds payload types for `PHASE_STARTED` and `DIARY_PROMPT`

- Phase machine accepts new events (for completeness)

  - File: `src/game/phase.ts`
  - Extends `PhaseEvent` union with `PHASE_STARTED` and `DIARY_PROMPT`

- Influencer plugin (player‑side)

  - File: `src/plugins/influencer/index.ts`
  - Listens for House events and House group messages; maintains per‑room flags via services; when flags indicate pending intro/diary, generates a one‑liner via LLM and returns early using the provided `callback` (bypassing `REPLY` action)

- Player state flags service (no text matching)

  - File: `src/plugins/influencer/playerStateService.ts`
  - Tracks `mustIntroduce`, `introduced`, `diaryPending`, `diaryResponded`

- LLM generation service (prompt building only)

  - File: `src/plugins/influencer/services/introductionDiaryService.ts`
  - `generateIntroduction(roomId)` – 120‑250 word, single paragraph
  - `generateDiaryResponse(roomId, housePrompt)` – 90‑180 word, single paragraph evaluation of other players

- Provider policy uses flags, not content matching

  - File: `src/plugins/influencer/providers/shouldRespond.ts`
  - Reads `PlayerStateService` flags to guide behavior; never inspects message text

- E2E coverage
  - File: `src/__tests__/influence/introduction-diary-room.test.ts`
  - Drives the full INTRODUCTION → diary prompts flow and prints summaries

See `INTRODUCTION_PHASE.md` for detailed sequence diagrams and references.
