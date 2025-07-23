// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { emit, sendTo, setup } from "xstate";
import { Phase } from "./types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine } from "./gameplay";

export interface PhaseContext {
  players: UUID[];
}

export type PhaseInput = {
  players: UUID[];
};

export type PhaseEvent = { type: "NEXT_PHASE" };
export type PhaseEmitted = { type: "PLAYER_READY_ERROR"; error: Error };

export function createPhaseMachine({
  roundTimeoutMs,
  phaseTimeoutMs,
  readyTimerMs,
}: {
  roundTimeoutMs: number;
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
      gameplay: createGameplayMachine({ phaseTimeoutMs, readyTimerMs }),
    },
  }).createMachine({
    id: "phase",
    context: ({ input }) => ({
      players: input.players,
    }),
    initial: "init",
    states: {
      init: {
        on: { NEXT_PHASE: "introduction" },
      },
      introduction: {
        always: {
          actions: sendTo("gameplay", ({ event }) => event),
        },
        invoke: {
          id: "gameplay",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.INIT,
            nextPhase: Phase.INTRODUCTION,
          }),
          onDone: {
            target: "strategy",
          },
          onError: {
            target: "strategy",
          },
        },
        after: {
          [roundTimeoutMs]: {
            target: "whisper",
          },
        },
      },
      whisper: {
        always: {
          actions: sendTo("gameplay", ({ event }) => event),
        },
        invoke: {
          id: "gameplay",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.INTRODUCTION,
            nextPhase: Phase.WHISPER,
          }),
          onDone: {
            target: "rumor",
          },
          onError: {
            target: "rumor",
            actions: [
              emit(({ event }) => ({
                type: "PLAYER_READY_ERROR",
                error: event.error as Error,
              })),
            ],
          },
        },
      },
      rumor: {
        always: {
          actions: sendTo("gameplay", ({ event }) => event),
        },
        invoke: {
          id: "gameplay",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.WHISPER,
            nextPhase: Phase.RUMOR,
          }),
          onDone: {
            target: "vote",
          },
          onError: {
            target: "vote",
          },
        },
      },
      vote: {
        always: {
          actions: sendTo("gameplay", ({ event }) => event),
        },
        invoke: {
          id: "gameplay",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.RUMOR,
            nextPhase: Phase.VOTE,
          }),
        },
        onDone: {
          target: "power",
        },
        onError: {
          target: "power",
        },
      },
      power: {
        always: {
          actions: sendTo("gameplay", ({ event }) => event),
        },
        invoke: {
          id: "gameplay",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.VOTE,
            nextPhase: Phase.POWER,
          }),
        },
        onDone: {
          target: "reveal",
        },
        onError: {
          target: "reveal",
        },
      },
      reveal: {
        always: {
          actions: sendTo("gameplay", ({ event }) => event),
        },
        invoke: {
          id: "gameplay",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.POWER,
            nextPhase: Phase.REVEAL,
          }),
        },
        onDone: {
          target: "end",
        },
        onError: {
          target: "end",
        },
      },
      end: { type: "final" },
    },
  });
}
