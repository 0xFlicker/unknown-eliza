// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, createActor, emit, sendTo, setup } from "xstate";
import "xstate/guards";
import { GameSettings, Phase } from "./types";
import { UUID } from "@elizaos/core";
import {
  createGameplayMachine,
  GameplayEmitted,
  GameplayEvent,
} from "./gameplay";
import {
  createIntroductionMachine,
  IntroductionEmitted,
  IntroductionEvent,
} from "./rooms/introduction";
import { createLobbyMachine, LobbyEmitted, LobbyEvent } from "./rooms/lobby";
import { WhisperEmitted, WhisperEvent } from "./rooms/whisper";

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
  | GameplayEvent
  | IntroductionEvent
  | LobbyEvent
  | WhisperEvent
  | { type: "PHASE_STARTED"; phase: Phase }
  | { type: "DIARY_PROMPT"; targetAgentName: string };

export type PhaseEmitted =
  | GameplayEmitted
  | IntroductionEmitted
  | LobbyEmitted
  | WhisperEmitted;

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
    // actions: {
    //   emitEvent: emit(({ event }) => event),
    // },
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
      lobby: createLobbyMachine({
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
              // emit(({ event }) => ({
              //   type: "PLAYER_READY",
              //   playerId: event.playerId,
              // })),
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
          actions: [sendTo("lobby", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "PHASE_ENTERED",
            phase: Phase.LOBBY,
          }),
        ],
        invoke: {
          id: "lobby",
          src: "lobby",
          input: ({ context }) => ({
            players: context.players,
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
          actions: [sendTo("whisper", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "PHASE_ENTERED",
            phase: Phase.WHISPER,
          }),
        ],
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
          actions: [sendTo("rumor", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "PHASE_ENTERED",
            phase: Phase.RUMOR,
          }),
        ],
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
          actions: [sendTo("vote", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "PHASE_ENTERED",
            phase: Phase.VOTE,
          }),
        ],
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
          actions: [sendTo("power", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "PHASE_ENTERED",
            phase: Phase.POWER,
          }),
        ],
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
          actions: [sendTo("reveal", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "PHASE_ENTERED",
            phase: Phase.REVEAL,
          }),
        ],
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
