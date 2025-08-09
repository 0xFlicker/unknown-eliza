## Influence – INTRODUCTION Phase Enablement Plan

### Context

- Goal: Make INIT → INTRODUCTION work end-to-end with explicit, game-controlled chat flow and no dependency on `plugin-bootstrap`.
- Test target: `apps/agent/src/__tests__/influence/e2e-introduction-flow.test.ts` expects a coordination event `GAME:ALL_PLAYERS_READY` after all players introduce.

### Findings

- **Current behavior**
  - `house` initializes a `Phase` actor and forwards any phase actor events onto the coordination bus, but it does not forward app message events back into the phase actor.
  - `introduction` machine advances to `strategy` only when it sees `MESSAGE_SENT` per unique player.
  - `gameplay` machine requires an `ARE_YOU_READY` trigger to begin collecting `PLAYER_READY` and conclude with an “all players ready” signal.
  - `influencer` already responds to `GAME:ARE_YOU_READY` by sending `PLAYER_READY`.
- **Gaps causing the timeout**
  - Nothing emits `GAME:MESSAGE_SENT` when players post introductions; the phase actor never receives `MESSAGE_SENT` and cannot detect that players have introduced.
  - Nothing emits `ARE_YOU_READY` into the invoked `gameplay` actor during `introduction.strategy`, so readiness is never collected.
  - `influencer`’s `SHOULD_RESPOND` provider currently tells players to ignore House messages in group channels, which blocks the mandatory intro message.

### `plugin-bootstrap` evaluation (in this game context)

- Pros (general infra): provides generic message loop, providers, and examples; hooks core events (e.g., `MESSAGE_SENT`).
- Cons for Influence:
  - Chat-first prompting and cancellation semantics (drops generations on new messages) conflicts with phase-gated flow where we want controlled, single-turn responses.
  - Not phase-aware; no built-in way to require/forbid speaking based on game state.
  - No direct bridge from app message events to Influence-specific game coordination events (e.g., `GAME:MESSAGE_SENT`).

Conclusion: Do not reuse `plugin-bootstrap` for Influence’s game loop. Implement a minimal, phase-aware alternative.

### Reuse vs. New plugin decision

- Keep and extend existing plugins:
  - `coordinator`: OK as the cross-agent bus and role gating.
  - `house`: Extend to translate app events ↔ phase actor events.
  - `influencer`: Add a phase-aware response gate for INTRODUCTION and keep readiness behavior.
  - No new plugin is needed for this iteration.

### Plan to pass INTRODUCTION E2E test

1. House: bridge app messages into the phase actor

   - On `EventType.MESSAGE_SENT` (author is a player in the game room), call `CoordinationService.sendGameEvent({ action: { type: "MESSAGE_SENT", playerId, messageId } })`.
   - GameStateManager already forwards coordination events (`gameEvent$`) into the phase actor via `phaseActor.send(payload.action)`.

2. Introduction → Strategy → Readiness handshake

   - In `createIntroductionMachine`, when entering `strategy`, immediately send `ARE_YOU_READY` to the invoked `gameplay` child (e.g., `entry: sendTo("strategy", { type: "ARE_YOU_READY" })`).
   - This starts the readiness collection.

3. Gameplay: emit an explicit completion event

   - In `createGameplayMachine`, on entering the `allPlayersReady` final state, emit an event `{ type: "ALL_PLAYERS_READY" }`.
   - The phase actor already re-emits processed events; House relays them onto the coordination bus as `GAME:ALL_PLAYERS_READY`, satisfying the test.

4. Influencer: allow one mandatory introduction

   - Update the `SHOULD_RESPOND` provider logic to permit a single response to a House message in a group channel during INTRODUCTION (and otherwise ignore House in groups).
   - Keep existing behavior: on `GAME:ARE_YOU_READY`, send `PLAYER_READY`.

5. Guardrails (“speak only when spoken to”)
   - Phase-aware response rules: INTRODUCTION allows exactly one intro per player; other phases restrict based on game prompts.
   - Centralize these rules in a lightweight provider (`PHASE_CONTEXT`/`SHOULD_RESPOND`) without keyword matching; rely on phase state and sender role.

### Acceptance criteria

- After House posts the INTRODUCTION prompt:
  - Each player sends exactly one introduction message to the channel.
  - House forwards these as `GAME:MESSAGE_SENT` events.
  - `introduction` machine observes all players introduced and moves to `strategy`.
  - `strategy` sends `ARE_YOU_READY` to `gameplay`; players reply `PLAYER_READY`.
  - `gameplay` emits `ALL_PLAYERS_READY`; House relays `GAME:ALL_PLAYERS_READY` to the bus.
  - The E2E test detects `GAME:ALL_PLAYERS_READY` and passes.

### Next iteration (diary room preview)

- Reuse the same handshake pattern: House opens DM, prompts; players respond; `gameplay` collects `PLAYER_READY` and emits `ALL_PLAYERS_READY` to advance.

### Implementation notes

- Avoid text keyword validation; use sender identity, channel type, and phase state.
- Keep changes minimal, focused on the INTRODUCTION path; do not introduce new services unless necessary.
