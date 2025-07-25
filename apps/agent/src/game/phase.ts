// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { emit, sendTo, setup } from "xstate";
import "xstate/guards";
import { GameSettings, Phase } from "./types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine, GameplayEvent } from "./gameplay";
import {
  createIntroductionMachine,
  IntroductionEvent,
} from "./rooms/introduction";

export interface PhaseContext {
  players: UUID[];
}

export type PhaseInput = {
  players: UUID[];
};

export type PhaseEvent =
  | { type: "NEXT_PHASE" }
  | GameplayEvent
  | IntroductionEvent;

export type PhaseEmitted = { type: "PLAYER_READY_ERROR"; error: Error };

export function createPhaseMachine(gameSettings: GameSettings) {
  const {
    timers: { round, diary },
    maxPlayers,
    minPlayers,
  } = gameSettings;
  return setup({
    types: {
      context: {} as PhaseContext,
      events: {} as PhaseEvent,
      input: {} as PhaseInput,
      emitted: {} as PhaseEmitted,
    },
    actors: {
      gameplay: createGameplayMachine({
        phaseTimeoutMs: round,
        diaryTimeoutMs: diary,
      }),
      introduction: createIntroductionMachine({
        roundTimeoutMs: round,
        diaryTimeoutMs: diary,
      }),
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
          actions: sendTo("introduction", ({ event }) => event),
        },
        invoke: {
          id: "introduction",
          src: "introduction",
          input: ({ context }) => ({
            players: context.players,
          }),
          onDone: {
            target: "lobby",
          },
          onError: {
            target: "lobby",
          },
        },
        after: {
          [round]: {
            target: "lobby",
          },
        },
      },
      lobby: {
        always: {
          actions: sendTo("lobby", ({ event }) => event),
        },
        invoke: {
          id: "lobby",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.LOBBY,
            nextPhase: Phase.WHISPER,
          }),
          onDone: {
            target: "whisper",
          },
          onError: {
            target: "whisper",
          },
        },
      },
      whisper: {
        always: {
          actions: sendTo("whisper", ({ event }) => event),
        },
        invoke: {
          id: "whisper",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.WHISPER,
            nextPhase: Phase.RUMOR,
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
          actions: sendTo("rumor", ({ event }) => event),
        },
        invoke: {
          id: "rumor",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.RUMOR,
            nextPhase: Phase.VOTE,
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
          actions: sendTo("vote", ({ event }) => event),
        },
        invoke: {
          id: "vote",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.VOTE,
            nextPhase: Phase.POWER,
          }),
          onDone: {
            target: "power",
          },
          onError: {
            target: "power",
          },
        },
      },
      power: {
        always: {
          actions: sendTo("power", ({ event }) => event),
        },
        invoke: {
          id: "power",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.POWER,
            nextPhase: Phase.REVEAL,
          }),
          onDone: {
            target: "reveal",
          },
          onError: {
            target: "reveal",
          },
        },
      },
      reveal: {
        always: {
          actions: sendTo("reveal", ({ event }) => event),
        },
        invoke: {
          id: "reveal",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.REVEAL,
            nextPhase: Phase.END,
          }),
          onDone: {
            target: "end",
          },
          onError: {
            target: "end",
          },
        },
      },
      // TODO: add state to evaluate if game is over
      end: { type: "final" },
    },
  });
}
