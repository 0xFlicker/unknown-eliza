import { createActor, createMachine, setup } from "xstate";
import { AllGameEvents, GameState } from "../types";
import { Phase } from "../types";

export function createPhaseMachine(initialContext: GameState) {
  return setup({
    types: {
      context: {} as GameState,
      events: {} as AllGameEvents,
    },
  }).createMachine({
    context: initialContext,
    initial: Phase.INIT as Phase,
    states: {
      [Phase.INIT]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.INTRODUCTION,
          },
        },
      },
      [Phase.INTRODUCTION]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.INTRODUCTION_DIARY_ROOM,
          },
        },
      },
      [Phase.INTRODUCTION_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.LOBBY,
          },
        },
      },
      [Phase.LOBBY]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.LOBBY_DIARY_ROOM,
          },
        },
      },
      [Phase.LOBBY_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.WHISPER,
          },
        },
      },
      [Phase.WHISPER]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.WHISPER_DIARY_ROOM,
          },
        },
      },
      [Phase.WHISPER_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.RUMOR,
          },
        },
      },
      [Phase.RUMOR]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.RUMOR_DIARY_ROOM,
          },
        },
      },
      [Phase.RUMOR_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.VOTE,
          },
        },
      },
      [Phase.VOTE]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.VOTE_DIARY_ROOM,
          },
        },
      },
      [Phase.VOTE_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.POWER,
          },
        },
      },
      [Phase.POWER]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.POWER_DIARY_ROOM,
          },
        },
      },
      [Phase.POWER_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.REVEAL,
          },
        },
      },
      [Phase.REVEAL]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.REVEAL_DIARY_ROOM,
          },
        },
      },
      [Phase.REVEAL_DIARY_ROOM]: {
        on: {
          ALL_PLAYERS_READY: {
            target: Phase.LOBBY,
          },
        },
      },
    },
  });
}
