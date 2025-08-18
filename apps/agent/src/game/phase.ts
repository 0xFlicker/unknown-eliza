// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, createActor, emit, sendTo, setup } from "xstate";
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
  playersReady: Record<UUID, boolean>;
  minPlayers: number;
  maxPlayers: number;
}

export type PhaseInput = {
  players: UUID[];
  maxPlayers: number;
  minPlayers: number;
};

export type PhaseEvent =
  | { type: "ADD_PLAYER"; playerId: UUID }
  | { type: "PLAYER_READY"; playerId: UUID }
  | GameplayEvent
  | IntroductionEvent
  | { type: "PHASE_STARTED"; phase: Phase }
  | { type: "DIARY_PROMPT"; targetAgentName: string };

export type PhaseEmitted =
  | { type: "PLAYER_READY_ERROR"; error: Error }
  | PhaseEvent;

export function createPhaseActor(
  phase: ReturnType<typeof createPhaseMachine>,
  {
    players,
    maxPlayers,
    minPlayers,
  }: {
    players: UUID[];
    maxPlayers: number;
    minPlayers: number;
  },
) {
  return createActor(phase, {
    input: {
      players,
      maxPlayers,
      minPlayers,
    },
  });
}

export function createPhaseMachine(gameSettings: GameSettings) {
  const {
    timers: { round, diary },
  } = gameSettings;
  return setup({
    actions: {
      emitEvent: emit(({ event }) => event),
    },
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
      playersReady: {},
      minPlayers: input.minPlayers,
      maxPlayers: input.maxPlayers,
    }),
    initial: "init",
    states: {
      init: {
        on: {
          ADD_PLAYER: {
            target: "init",
            actions: [
              assign({
                players: ({ context, event }) => [
                  ...context.players,
                  event.playerId,
                ],
              }),
            ],
          },
          PLAYER_READY: {
            target: "init",
            actions: [
              assign({
                playersReady: ({ context, event }) => ({
                  ...context.playersReady,
                  ...(event.type === "PLAYER_READY" &&
                  Object.keys(context.playersReady).length < context.maxPlayers
                    ? { [event.playerId]: true }
                    : {}),
                }),
              }),
              {
                type: "emitEvent",
              },
            ],
          },
        },
        always: [
          {
            guard: ({ context }) => {
              if (context.players.length < context.minPlayers) return false;
              const playerIds = Object.keys(context.playersReady);
              if (playerIds.length < context.minPlayers) return false;
              return playerIds.every((id) => context.playersReady[id]);
            },
            target: "introduction",
            actions: [
              emit(() => ({
                type: "ALL_PLAYERS_READY",
                fromPhase: Phase.INTRODUCTION,
                toPhase: Phase.LOBBY,
                transitionReason: "all_players_ready",
              })),
            ],
          },
        ],
      },
      introduction: {
        on: {
          "*": {
            actions: [sendTo("introduction", ({ event }) => event)],
          },
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
          actions: [
            sendTo("lobby", ({ event }) => event),
            {
              type: "emitEvent",
            },
          ],
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
          actions: [
            sendTo("whisper", ({ event }) => event),
            {
              type: "emitEvent",
            },
          ],
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
          actions: [
            sendTo("rumor", ({ event }) => event),
            {
              type: "emitEvent",
            },
          ],
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
          actions: [
            sendTo("vote", ({ event }) => event),
            {
              type: "emitEvent",
            },
          ],
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
          actions: [
            sendTo("power", ({ event }) => event),
            {
              type: "emitEvent",
            },
          ],
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
          actions: [
            sendTo("reveal", ({ event }) => event),
            {
              type: "emitEvent",
            },
          ],
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
