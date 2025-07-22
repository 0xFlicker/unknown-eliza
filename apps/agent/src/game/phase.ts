// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { emit, sendTo, setup } from "xstate";
import { Phase } from "./types";
import { createDiaryMachine } from "./diary-room";
import { UUID } from "@elizaos/core";
import { createReadyToPlayMachine } from "./ready-to-play";

export interface PhaseContext {
  players: UUID[];
  currentPhase: Phase;
  nextPhase: Phase;
}

export type PhaseInput = {
  players: UUID[];
  initialPhase: Phase;
  nextPhase: Phase;
};

export type PhaseState = "gameplay" | "diary" | "strategy" | "end";

// PhaseEvent includes both phase triggers and diary events
export type PhaseEvent =
  | { type: "ARE_YOU_READY" }
  | { type: "ALL_PLAYERS_READY" }
  | { type: "END_ROUND" }
  | { type: "PLAYER_READY"; playerId: string };

export type PhaseEmitted = { type: "PLAYER_READY_ERROR"; error: Error };

export function createPhaseMachine({
  phaseTimeoutMs,
  readyTimerMs,
}: {
  phaseTimeoutMs: number;
  readyTimerMs: number;
}) {
  return setup({
    types: {
      context: {} as PhaseContext,
      events: {} as PhaseEvent,
      input: {} as PhaseInput,
      emitted: {} as PhaseEmitted,
    },
    actors: {
      diary: createDiaryMachine({ readyTimerMs }),
      readyToPlay: createReadyToPlayMachine(),
    },
  }).createMachine({
    id: "phase",
    context: ({ input }) => ({
      players: input.players,
      currentPhase: input.initialPhase,
      nextPhase: input.nextPhase,
    }),
    initial: "gameplay",
    states: {
      gameplay: {
        on: { END_ROUND: "diary" },
        after: {
          [phaseTimeoutMs]: {
            target: "diary",
          },
        },
      },
      diary: {
        always: {
          actions: sendTo("diary", ({ event }) => event),
        },
        // Invoke the diary interview flow
        invoke: {
          id: "diary",
          src: "diary",
          input: ({ context }) => ({
            players: context.players,
          }),
          onDone: {
            target: "strategy",
          },
          onError: {
            target: "strategy",
          },
        },
        after: {
          [phaseTimeoutMs]: {
            target: "strategy",
          },
        },
      },
      strategy: {
        always: {
          actions: sendTo("readyToPlay", ({ event }) => event),
        },
        invoke: {
          id: "readyToPlay",
          src: "readyToPlay",
          input: ({ context }) => ({
            players: context.players,
          }),
          onDone: {
            target: "end",
          },
          onError: {
            target: "end",
            actions: [
              emit(({ event }) => ({
                type: "PLAYER_READY_ERROR",
                error: event.error as Error,
              })),
            ],
          },
        },
      },
      end: { type: "final" },
    },
  });
}
