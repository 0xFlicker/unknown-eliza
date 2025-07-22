// This file defines a standalone Diary Room state machine for handling diary phases.
import { setup, assign, emit, sendTo } from "xstate";
import { TimerService } from "./timers/TimerService";
import { Phase } from "./types";
import { UUID } from "@elizaos/core";
import { createReadyToPlayMachine } from "./ready-to-play";

export interface DiaryContext {
  playersReady: Record<UUID, boolean>;
}

export type DiaryInput = {
  players: UUID[];
};

export type DiaryEvent =
  | { type: "ARE_YOU_READY" }
  | { type: "PLAYER_READY"; playerId: string }
  | { type: "READY_TIMER_EXPIRED" };

export function createDiaryMachine({ readyTimerMs }: { readyTimerMs: number }) {
  return setup({
    types: {
      context: {} as DiaryContext,
      events: {} as DiaryEvent,
      input: {} as DiaryInput,
    },
    delays: {
      readyTimerMs,
    },
    actors: {
      readyToPlay: createReadyToPlayMachine(),
    },
  }).createMachine({
    id: "diaryRoom",
    initial: "interviewing",
    context: ({ input }) => ({
      playersReady: input.players.reduce(
        (acc, player) => {
          acc[player] = false;
          return acc;
        },
        {} as Record<UUID, boolean>,
      ),
    }),
    states: {
      interviewing: {
        on: {
          ARE_YOU_READY: {
            target: "await_ready",
            after: {
              readyTimerMs: {
                target: "completed",
              },
            },
          },
        },
      },
      await_ready: {
        always: {
          actions: sendTo("readyToPlay", ({ event }) => event),
        },
        invoke: {
          id: "readyToPlay",
          src: "readyToPlay",
          input: ({ context }) => ({
            players: Object.keys(context.playersReady) as UUID[],
          }),
          onDone: {
            target: "completed",
          },
          onError: {
            target: "completed",
          },
        },
      },
      completed: { type: "final" },
    },
  });
}
