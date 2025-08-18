# Influence – Introduction Phase Implementation

This document explains how the Introduction phase is implemented in `apps/agent`, with exact file references and the agentic control flow used by House and Influencer (player) plugins.

## Goals

- Each player posts exactly one introduction in the main game channel
- Diary round immediately follows, where House asks each player for a single private assessment in the same channel (for this iteration)
- No text matching in providers; state is driven by structured events and per‑room flags
- One‑message replies are generated via LLM prompts without invoking the generic chat action chain

## Components and Files

- House plugin (MC): `src/plugins/house/index.ts`
- Coordinator types (events): `src/plugins/coordinator/types.ts`
- Phase machine: `src/game/phase.ts`
- Influencer plugin (players): `src/plugins/influencer/index.ts`
- Player flags service: `src/plugins/influencer/playerStateService.ts`
- LLM generation service: `src/plugins/influencer/services/introductionDiaryService.ts`
- Provider policy: `src/plugins/influencer/providers/shouldRespond.ts`
- E2E test: `src/__tests__/influence/introduction-diary-room.test.ts`

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

- House posts a message like `@Alpha Diary Question for Alpha: …`
- House emits `GAME:DIARY_PROMPT { targetAgentName }` for structured consumers.
- Influencer also detects immediate mentions and sets `diaryPending = true` (race guard) via `PlayerStateService`.
- Reference: `src/plugins/house/index.ts`, `src/plugins/influencer/index.ts`

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

- `src/__tests__/influence/introduction-diary-room.test.ts` bootstraps a House and three players, starts a game in INTRODUCTION, posts the Introduction prompt, collects one intro per player, then posts diary questions per player and collects one diary response per player. It prints both introduction and diary summaries (no channel send).

## Extensibility Notes

- To persist summaries as memories, add a House service that writes `game` table memories after both collections, and optionally fans them out to each runtime.
- To evolve the actor model, forward `PHASE_STARTED` and `DIARY_PROMPT` into the `introduction` actor in `src/game/rooms/introduction.ts` and gate completion on per‑player message counts (already partially implemented).
- To refine text style, replace `TEXT_LARGE` with provider‑specific models and add character‑specific prompt slots (e.g., tone, quirks) in `IntroductionDiaryService`.
