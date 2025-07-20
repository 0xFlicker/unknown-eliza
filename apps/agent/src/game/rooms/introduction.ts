import { setup, assign, emit } from "xstate";
// Needed for type inference
import "xstate/guards";
import { GameContext, GameEvent, Phase } from "../types";
import { TimerService } from "../timers/TimerService";
import { UUID } from "@elizaos/core";

export const DEFAULT_INTRO_TIMER_MS = 3 * 60 * 1000; // 3 minutes
export const DEFAULT_READY_TIMER_MS = 60 * 1000; // 1 minute

export interface IntroductionInput {
  introTimerMs?: number;
  readyTimerMs?: number;
}

export interface IntroductionContext {
  introTimerId?: string;
  readyTimerId?: string;
  playersReady: Record<UUID, boolean>;
  introductionMessages?: Record<UUID, number>;
  diaryRooms?: Record<UUID, UUID>;
}

export interface IntroductionOutput {
  allPlayersReady: boolean;
  introductionMessages: Record<UUID, number>;
  diaryRooms: Record<UUID, UUID>;
}

export type IntroductionEvent =
  | {
      type: "PLAYER_READY";
      playerId: string;
    }
  | {
      type: "RESET_READY";
    }
  | { type: "INTRO_MESSAGE"; playerId: string }
  | { type: "TIMER_EXPIRED" }
  | { type: "PHASE_CHANGE_INITIATED" }
  | { type: "ALL_PLAYERS_READY" }
  | { type: "DIARY_ROOM_QUESTION"; playerId: string; diaryRoomId: string }
  | { type: "ARE_YOU_READY"; nextPhase: Phase };

export function createGameMachine({
  initialContext,
  timers,
  initialPhase,
}: {
  initialContext: IntroductionContext;
  timers: TimerService;
  initialPhase: Phase;
}) {
  return setup({
    types: {
      context: {} as IntroductionContext,
      events: {} as IntroductionEvent,
      input: {} as IntroductionInput,
      output: {} as IntroductionOutput,
    },
    actions: {
      cancelIntroTimer: ({ context }) => {
        if (context.introTimerId) timers.cancel(context.introTimerId);
      },
      cancelReadyTimer: ({ context }) => {
        if (context.readyTimerId) timers.cancel(context.readyTimerId);
      },

      clearIntroData: assign({
        introductionMessages: () => undefined,
        introTimerId: () => undefined,
        readyTimerId: () => undefined,
        diaryRooms: () => undefined,
      }),
      resetReady: assign({ playersReady: () => ({}) }),
    },
    guards: {
      allPlayersReady: ({ context }) => {
        const playerIds = Object.keys(context.playersReady);
        if (playerIds.length === 0) return false;
        return playerIds.every((id) => context.playersReady[id]);
      },
      allIntroduced: ({ context }) => {
        const playerIds = Object.keys(context.playersReady);
        const intro = context.introductionMessages ?? {};
        return playerIds.every((id) => intro[id] > 0);
      },
    },
  }).createMachine({
    id: "introduction",
    context: initialContext,
    initial: initialPhase,
    output: ({ context }) => ({
      allPlayersReady: Object.keys(context.playersReady).every(
        (id) => context.playersReady[id],
      ),
      introductionMessages: context.introductionMessages ?? {},
      diaryRooms: context.diaryRooms ?? {},
    }),
    states: {
      [Phase.INIT]: {
        on: {
          PLAYER_READY: {
            actions: [
              assign({
                playersReady: ({ context, event }) => {
                  return { ...context.playersReady, [event.playerId]: true };
                },
              }),
            ],
          },
        },
        always: {
          guard: ({ context }) => {
            const playerIds = Object.keys(context.playersReady);
            return playerIds.every((id) => context.playersReady[id]);
          },
          target: Phase.INTRODUCTION,
        },
      },
      [Phase.INTRODUCTION]: {
        entry: [
          assign({
            introTimerId: ({ self }) => {
              return timers.schedule(DEFAULT_INTRO_TIMER_MS, () => {
                self.send({ type: "TIMER_EXPIRED" });
              });
            },
          }),
        ],
        on: {
          INTRO_MESSAGE: {
            actions: [
              assign({
                introductionMessages: ({ context, event }) => {
                  const curr = context.introductionMessages ?? {};
                  return {
                    ...curr,
                    [event.playerId]: (curr[event.playerId] ?? 0) + 1,
                  };
                },
              }),
              ({ context, self }) => {
                if (
                  Object.keys(context.introductionMessages ?? {}).length ===
                  Object.keys(context.playersReady).length
                ) {
                  self.send({
                    type: "ARE_YOU_READY",
                    nextPhase: Phase.INTRO_DR,
                  });
                }
              },
            ],
          },
          ARE_YOU_READY: {
            actions: [
              assign({
                readyTimerId: ({ self }) => {
                  return timers.schedule(DEFAULT_READY_TIMER_MS, () => {
                    self.send({ type: "TIMER_EXPIRED" });
                  });
                },
              }),
            ],
          },
          ALL_PLAYERS_READY: Phase.INTRO_DR,
          TIMER_EXPIRED: Phase.INTRO_DR,
        },
        always: {
          guard: ({ context }) => {
            const playerIds = Object.keys(context.playersReady);
            const intro = context.introductionMessages ?? {};
            return playerIds.every((id) => intro[id] && intro[id] > 0);
          },
          target: Phase.INTRO_DR,
        },
      },
      [Phase.INTRO_DR]: {
        entry: [
          "resetReady",
          ({ context, self }) => {
            if (!context.introTimerId) {
              const id = timers.schedule(DEFAULT_READY_TIMER_MS, () => {
                self.send({ type: "TIMER_EXPIRED" });
              });
              return { introTimerId: id };
            }
          },
        ],
        exit: ["cancelIntroTimer", "clearIntroData"],
        on: {
          // Handshake: when players say ready, move to next phase
          PLAYER_READY: [
            {
              actions: [
                assign({
                  playersReady: ({ context, event }) => {
                    return { ...context.playersReady, [event.playerId]: true };
                  },
                }),
                ({ context, self }) => {
                  if (
                    Object.keys(context.playersReady).length ===
                    Object.keys(context.playersReady).length
                  ) {
                    self.send({ type: "ALL_PLAYERS_READY" });
                  }
                },
              ],
            },
          ],
          ARE_YOU_READY: {
            actions: [
              assign({
                readyTimerId: ({ self }) => {
                  return timers.schedule(DEFAULT_READY_TIMER_MS, () => {
                    self.send({ type: "TIMER_EXPIRED" });
                  });
                },
              }),
            ],
          },
          ALL_PLAYERS_READY: Phase.LOBBY,
          TIMER_EXPIRED: Phase.LOBBY,
        },
      },
      [Phase.LOBBY]: {
        entry: ({ context, self }) => {
          if (!context.introTimerId) {
            const id = timers.schedule(DEFAULT_INTRO_TIMER_MS, () => {
              self.send({ type: "TIMER_EXPIRED" });
            });
            return { introTimerId: id };
          }
        },
        exit: ["cancelIntroTimer"],
        on: { TIMER_EXPIRED: Phase.LOBBY_DR },
        type: "atomic",
      },
      [Phase.LOBBY_DR]: {
        on: {
          TIMER_EXPIRED: Phase.LOBBY,
        },
      },
    },
  });
}
