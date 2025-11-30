# Influence – Introduction Phase Implementation

This document explains how the Introduction phase is implemented in `apps/agent`, with exact file references and the agentic control flow used by House and Influencer (player) plugins.

## Goals

- Each player posts exactly one introduction in the main game channel
- Diary round immediately follows, where House asks each player for a single private assessment in the same channel (for this iteration)
- No text matching in providers; state is driven by structured events and per‑room flags
- One‑message replies are generated via LLM prompts without invoking the generic chat action chain

## Current Status (2025‑11‑27)

- House Phase Machines

  - `introduction` room now emits `GAME:INTRODUCTION_ROOM_CREATED` and `GAME:PHASE_ENTERED` with `roomId`.
  - After all intros or timer, House invokes a centralized `diary` machine (child actor) and starts it via `GAME:DIARY_START`.
  - House Diary Machine implements targeted prompt → response → ready flow:
    - Emits `GAME:DIARY_PROMPT { roomId, targetPlayerId, promptId }` per player in sequence.
    - Accepts `GAME:DIARY_RESPONSE { playerId, roomId, messageId }` and advances.
    - After all prompts, broadcasts targeted `GAME:ARE_YOU_READY` events and awaits `GAME:PLAYER_READY` from all players.
    - Finalizes with `GAME:ALL_PLAYERS_READY { roomId, transitionReason }`.
  - All timeouts are factory parameters on the House diary machine (`promptTimeoutMs`, `responseTimeoutMs`, `readyTimeoutMs`).

- Influencer (Player) Machines

  - Added player‐side `introduction` room that records other players’ intro messages and transitions to diary.
  - Player Diary Machine now models:
    - `awaitPrompt` → waits for `GAME:DIARY_PROMPT`.
    - `responding` → emits `GAME:DIARY_RESPONSE` when the agent crafts a reply.
    - `awaitNextOrReady` → awaits either a followup `GAME:DIARY_PROMPT` or `GAME:ARE_YOU_READY`.
    - `finishingUp` → sends `GAME:PLAYER_READY` when the agent is done.
  - Player no longer owns timers; instead it reacts to House timeout events:
    - `GAME:DIARY_PROMPT_TIMEOUT`, `GAME:DIARY_RESPONSE_TIMEOUT`, `GAME:DIARY_READY_TIMEOUT`.
    - Also supports `PLAYER:FORCE_CONTINUE` for deterministic test control or agent override.
  - Player `phase.ts` is partially wired to the new rooms and will be updated to accept explicit `playerId` input and emit phase update events.

- Event Contracts (no text matching)

  - Structured events drive behavior: `PHASE_ENTERED`, `INTRODUCTION_ROOM_CREATED`, `DIARY_START`, `DIARY_PROMPT`, `DIARY_RESPONSE`, `ARE_YOU_READY`, `PLAYER_READY`, `ALL_PLAYERS_READY`.
  - Providers remain policy‐only and do not parse message text.

- Tests
  - House unit tests for INIT → INTRODUCTION → LOBBY and whisper unaffected and passing prior to diary changes; diary integration tests will be added next.
  - Upcoming end‑to‑end test will boot House + 2–3 players, simulate introductions, targeted diary prompts/responses, and readiness completion.

## Components and Files

- House plugin (MC): `src/plugins/house/index.ts`
- Coordinator types (events): `src/plugins/coordinator/types.ts`
- Phase machine: `src/game/phase.ts`
- Influencer plugin (players): `src/plugins/influencer/index.ts`
- Player flags service: `src/plugins/influencer/playerStateService.ts`
- LLM generation service: `src/plugins/influencer/services/introductionDiaryService.ts`
- Provider policy: `src/plugins/influencer/providers/shouldRespond.ts`
- E2E test: `src/__tests__/influence/introduction-diary-room.test.ts`

### New/Updated Actor Files

- House: `apps/agent/src/plugins/house/game/rooms/introduction.ts`
- House: `apps/agent/src/plugins/house/game/rooms/diary.ts`
- Influencer: `apps/agent/src/plugins/influencer/game/rooms/introduction.ts`
- Influencer: `apps/agent/src/plugins/influencer/game/rooms/diary.ts`

## Event Flow

1. House posts Introduction prompt in the group channel

- House receives `EventType.MESSAGE_RECEIVED` for its own message and emits a structured coordination event:
  - `GAME:PHASE_STARTED` with `phase: INTRODUCTION`
  - Influencer reacts to `GAME:PHASE_STARTED` and sets `mustIntroduce = true` via `PlayerStateService`
- Reference: `src/plugins/house/index.ts`, `src/plugins/influencer/index.ts`, `src/plugins/influencer/playerStateService.ts`

2. Player introduction posting

- On the next House group message, Influencer validates flags:
  - If `mustIntroduce && !introduced`, it generates a single intro paragraph via `IntroductionDiaryService.generateIntroduction(roomId)` and immediately calls the Eliza callback with `{ text, actions: ['REPLY'] }`, then `markIntroduced(roomId)` and returns.
  - This short‑circuits the generic REPLY action in `actions/reply.ts` and bypasses the prompt builder there.
- Reference: `src/plugins/influencer/index.ts`, `src/plugins/influencer/services/introductionDiaryService.ts`

3. House posts diary questions (one per player)

- House diary actor emits targeted prompts via events:
  - `GAME:DIARY_PROMPT { roomId, targetPlayerId, promptId }` (House → Players)
  - Players respond with `GAME:DIARY_RESPONSE { playerId, roomId, messageId }` (Players → House)
  - House then emits targeted `GAME:ARE_YOU_READY` to transition toward round completion and awaits `GAME:PLAYER_READY`.

4. Player diary response posting

- On the next House group message seen by a player with `diaryPending && !diaryResponded`, the Influencer:
  - Builds a diary prompt with the House message text and calls `IntroductionDiaryService.generateDiaryResponse(roomId, housePrompt)`
  - Calls the callback with `{ text, actions: ['REPLY'] }`, then `markDiaryResponded(roomId)` and returns.
- Reference: `src/plugins/influencer/index.ts`, `src/plugins/influencer/services/introductionDiaryService.ts`

## Why Providers Don’t Match Text

- `SHOULD_RESPOND` reads only the flags from `PlayerStateService` to compose guidance for the LLM. It does not parse the raw text content to drive state.
- All phase transitions and per‑player targeting are conveyed through structured events (`PHASE_STARTED`, `DIARY_PROMPT`) or by inspecting the identity of the sender (House) and the channel type.
- Reference: `src/plugins/influencer/providers/shouldRespond.ts`, `src/plugins/influencer/playerStateService.ts`

## Bypassing the Generic REPLY Action

- The one‑liner path uses `callback({ text, actions: ['REPLY'] })` directly from within the `EventType.MESSAGE_RECEIVED` handler in the Influencer plugin and returns early.
- This ensures the generic `replyAction` in `actions/reply.ts` is not executed for introductions or diary assessments.
- Reference: `src/plugins/influencer/index.ts`, `src/plugins/influencer/actions/reply.ts`

## Prompt Construction (LLM)

- Introduction prompt template (120–250 words, single paragraph) and diary template (90–180 words) are defined in `IntroductionDiaryService`.
- Prompts are composed using `composePrompt`, then executed via `runtime.useModel(ModelType.TEXT_LARGE, { prompt })`.
- Reference: `src/plugins/influencer/services/introductionDiaryService.ts`

## E2E Coverage

- Planned: `src/__tests__/influence/introduction-diary-room.test.ts` will bootstrap a House and 2–3 players, run INTRODUCTION → DIARY prompt/response → ARE_YOU_READY → PLAYER_READY, and assert `ALL_PLAYERS_READY` is emitted.

## Extensibility Notes

- To persist summaries as memories, add a House service that writes `game` table memories after both collections, and optionally fans them out to each runtime.
- To evolve the actor model, forward `PHASE_STARTED` and `DIARY_PROMPT` into the `introduction` actor in `src/game/rooms/introduction.ts` and gate completion on per‑player message counts (already partially implemented).
- To refine text style, replace `TEXT_LARGE` with provider‑specific models and add character‑specific prompt slots (e.g., tone, quirks) in `IntroductionDiaryService`.

## Next Steps

- Finalize influencer `phase.ts` input and emitted events.
- Add end‑to‑end tests for House + Players covering the full introduction + diary flow.
- Ensure House broadcasts `GAME:DIARY_*_TIMEOUT` events to players where applicable; players already handle these.
