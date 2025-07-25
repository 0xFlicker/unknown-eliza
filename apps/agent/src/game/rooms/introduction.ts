// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, emit, sendTo, setup } from "xstate";
import { Phase } from "../types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine } from "../gameplay";

export type IntroductionContext = {
  players: UUID[];
  // playerId -> list of messageIds they have sent
  introductionMessages: Record<UUID, UUID[]>;
};

export type IntroductionInput = {
  players: UUID[];
};

export type IntroductionEvent = {
  type: "MESSAGE_SENT";
  playerId: UUID;
  messageId: UUID;
};

export type IntroductionEmitted = { type: "PLAYER_READY_ERROR"; error: Error };

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
      events: {} as IntroductionEvent,
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
    }),
    initial: "waiting",
    states: {
      waiting: {
        on: {
          MESSAGE_SENT: {
            actions: assign(({ context, event }) => ({
              introductionMessages: {
                ...context.introductionMessages,
                [event.playerId]: [
                  ...(context.introductionMessages[event.playerId] || []),
                  event.messageId,
                ],
              },
            })),
          },
        },
        after: {
          [roundTimeoutMs]: {
            target: "strategy",
          },
        },
        always: {
          guard: "allPlayersIntroduced",
          target: "strategy",
        },
      },
      strategy: {
        always: {
          actions: sendTo("strategy", ({ event }) => event),
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
