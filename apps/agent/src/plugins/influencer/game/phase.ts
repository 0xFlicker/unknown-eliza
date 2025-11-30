import { UUID } from "@elizaos/core";
import { assign, createActor, setup, sendTo } from "xstate";
import type { SnapshotFrom } from "xstate";
import { Phase } from "./types";
import { createPlayerIntroductionMachine } from "./rooms/introduction";

export type PlayerPhaseEvent =
  | { type: "GAME:PHASE_ENTERED"; phase: Phase; roomId?: UUID }
  | { type: "GAME:DIARY_PROMPT"; roomId: UUID; messageId: UUID }
  | { type: "GAME:MESSAGE_SENT"; playerId: UUID; messageId: UUID }
  | { type: "GAME:AGENT_ENTERED"; playerId: UUID }
  | { type: "GAME:AGENT_LEFT"; playerId: UUID }
  | { type: "GAME:ARE_YOU_READY" }
  | { type: "GAME:PLAYER_READY"; playerId: UUID };

/**
 * Minimal identity record for the local player or other observed participants.
 */
export interface PlayerIdentity {
  id: UUID;
  name?: string;
}

/**
 * Information a player could reasonably infer about another participant based
 * solely on public/DM events routed to them. We avoid storing any global state
 * that the player would not directly observe.
 */
export interface KnownPlayer extends PlayerIdentity {
  /**
   * Timestamp (ms) when this player was first seen in any channel.
   */
  firstSeenAt: number;
  /**
   * Latest timestamp (ms) we observed activity from this player.
   */
  lastSeenAt: number;
  /**
   * Rooms where we have seen this player speak or be referenced.
   */
  roomsSeenIn: UUID[];
}

/**
 * Runtime configuration for the player phase machine.
 */
export interface PhaseInput {
  self: PlayerIdentity;
  initialPhase?: Phase;
  /**
   * Seeds for previously seen players (useful when restoring from persistence).
   */
  initialKnownPlayers?: Record<UUID, KnownPlayer>;
  /**
   * Optional clock override (facilitates deterministic tests).
   */
  getNow?: () => number;
}

/**
 * Top-level context tracked by the influencer-specific phase machine. This is
 * strictly the player's point-of-view: no global player lists, no shared
 * coordinators.
 */
export interface PlayerPhaseContext {
  self: PlayerIdentity;
  currentPhase: Phase;
  phaseEnteredAt: number;
  knownPlayers: Record<UUID, KnownPlayer>;
}

export function createPlayerPhaseMachine({
  roundTimeoutMs,
  diaryTimeoutMs,
}: {
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
    types: {
      context: {} as PlayerPhaseContext,
      input: {} as PhaseInput,
      events: {} as PlayerPhaseEvent,
    },
    actors: {
      introduction: createPlayerIntroductionMachine({
        roundTimeoutMs,
        diaryTimeoutMs,
      }),
    },
  }).createMachine({
    id: "player-phase",
    context: ({ input }) => ({
      self: input.self,
      knownPlayers: input.initialKnownPlayers ?? {},
      phaseEnteredAt: input.getNow ? input.getNow() : Date.now(),
      roundTimeoutMs: 60000,
      diaryTimeoutMs: 30000,
      currentPhase: Phase.INIT,
    }),
    initial: "idle",
    states: {
      idle: {
        on: {
          ["GAME:PHASE_ENTERED"]: {
            guard: ({ event }) => event.phase === Phase.INTRODUCTION,
            target: "introduction",
            actions: assign(({ event }) => ({ currentPhase: event.phase })),
          },
        },
      },
      introduction: {
        on: {
          ["GAME:MESSAGE_SENT"]: {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
          ["GAME:AGENT_ENTERED"]: {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
          ["GAME:AGENT_LEFT"]: {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
          ["GAME:DIARY_PROMPT"]: {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
          ["GAME:ARE_YOU_READY"]: {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
          ["GAME:PLAYER_READY"]: {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
        },
        invoke: {
          id: "introduction",
          src: "introduction",
          input: ({ context }) => ({
            playerId: context.self.id,
            players: Object.keys(context.knownPlayers).map((id) => id as UUID),
          }),
          onDone: {
            target: "complete",
          },
          onError: {
            target: "complete",
          },
        },
      },
      complete: { type: "final" },
    },
  });
}

export function createPlayerPhaseActor(
  input: PhaseInput,
  {
    roundTimeoutMs,
    diaryTimeoutMs,
  }: { roundTimeoutMs: number; diaryTimeoutMs: number },
) {
  const machine = createPlayerPhaseMachine({ roundTimeoutMs, diaryTimeoutMs });
  return createActor(machine, { input });
}

export type PlayerPhaseSnapshot = SnapshotFrom<
  ReturnType<typeof createPlayerPhaseMachine>
>;
