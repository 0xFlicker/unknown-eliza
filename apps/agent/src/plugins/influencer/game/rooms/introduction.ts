// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, emit, sendTo, setup } from "xstate";
import { Phase } from "../types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine } from "../gameplay";

export type IntroductionContext = {
  players: UUID[];
  // playerId -> list of messageIds they have sent
  introductionMessages: Record<UUID, UUID>;
  roomId: UUID;
};

export type IntroductionInput = {
  players: UUID[];
  roomId: UUID;
};

export type IntroductionMessageEvent = {
  type: "GAME:MESSAGE_SENT";
  playerId: UUID;
  messageId: UUID;
};

export type IntroductionEmittedPlayerReadyError = {
  type: "GAME:PLAYER_READY_ERROR";
  error: Error;
  roomId?: UUID;
};

export type IntroductionEmittedAreYouReady = {
  type: "GAME:ARE_YOU_READY";
  roomId?: UUID;
  playerId: UUID;
};

export type IntroductionEmitted =
  | IntroductionEmittedPlayerReadyError
  | IntroductionEmittedAreYouReady;

export function createIntroductionMachine({
  roundTimeoutMs,
  diaryTimeoutMs,
}: {
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
    types: {
      context: {} as IntroductionContext,
      input: {} as IntroductionInput,
      events: {} as IntroductionMessageEvent,
      emitted: {} as IntroductionEmitted,
    },
    actors: {
      gameplay: createGameplayMachine({
        phaseTimeoutMs: roundTimeoutMs,
        diaryTimeoutMs: diaryTimeoutMs,
      }),
    },
    guards: {
      allPlayersIntroduced: ({ context }) => {
        return (
          Object.keys(context.introductionMessages).length ===
          context.players.length
        );
      },
    },
  }).createMachine({
    id: "introduction",
    context: ({ input }) => ({
      players: input.players,
      introductionMessages: {},
      roomId: input.roomId,
    }),
    initial: "waiting",
    states: {
      waiting: {
        after: {
          0: {
            target: "strategy",
          },
          [roundTimeoutMs]: {
            target: "strategy",
          },
        },
        on: {
          ["GAME:MESSAGE_SENT"]: {
            actions: assign(({ context, event }) => ({
              introductionMessages: {
                ...context.introductionMessages,
                [event.playerId]: event.messageId,
              },
            })),
          },
        },
        always: {
          guard: "allPlayersIntroduced",
          target: "strategy",
        },
      },
      strategy: {
        entry: [
          // Broadcast and kick off readiness collection for the gameplay child
          emit(({ context }) => ({
            type: "GAME:ARE_YOU_READY",
            roomId: context.roomId,
            playerId: context.players[0],
          })),
          sendTo("strategy", { type: "GAME:END_ROUND" }),
          sendTo("strategy", { type: "GAME:ARE_YOU_READY" }),
        ],
        on: {
          "*": {
            actions: [sendTo("strategy", ({ event }) => event)],
          },
        },
        invoke: {
          id: "strategy",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.INTRODUCTION,
            nextPhase: Phase.LOBBY,
          }),
          onDone: {
            target: "end",
          },
          onError: {
            target: "end",
          },
        },
      },
      end: { type: "final" },
    },
  });
}
