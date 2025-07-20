import { setup, assign, emit } from "xstate";
// Needed for type inference
import "xstate/guards";
import { GameContext, GameEvent, Phase } from "./types";
import { TimerService } from "./timers/TimerService";

export const INTRO_TIMER_MS = 3 * 60 * 1000; // 3 minutes
export const READY_TIMER_MS = 10 * 1000; // 10 seconds

export function createGameMachine({
  initialContext,
  timers,
  initialPhase,
}: {
  initialContext: GameContext;
  timers: TimerService;
  initialPhase: Phase;
}) {
  return setup({
    types: {
      context: {} as GameContext,
      events: {} as GameEvent,
      output: {} as GameContext,
    },
    actions: {
      cancelIntroTimer: ({ context }) => {
        if (context.introTimerId) timers.cancel(context.introTimerId);
      },
      cancelReadyTimer: ({ context }) => {
        if (context.readyTimerId) timers.cancel(context.readyTimerId);
      },
      sendDiaryQuestions: ({ context, self }) => {
        if (!context.diaryRooms) {
          const ids = Object.keys(context.players);
          return {
            diaryRooms: ids.reduce<Record<string, string>>((acc, id) => {
              acc[id] = `diary-${id}`;
              return acc;
            }, {}),
          };
        }
        for (const [playerId, diaryRoomId] of Object.entries(
          context.diaryRooms!,
        )) {
          self.send({
            type: "DIARY_ROOM_QUESTION",
            playerId,
            diaryRoomId,
          });
        }
      },
      clearIntroData: assign({
        introductionMessages: () => undefined,
        introTimerId: () => undefined,
        diaryRooms: () => undefined,
      }),
      resetReady: assign({ ready: () => ({}) }),
    },
    guards: {
      allPlayersReady: ({ context }) => {
        const playerIds = Object.keys(context.players);
        if (playerIds.length === 0) return false;
        return playerIds.every((id) => context.ready[id]);
      },
      allIntroduced: ({ context }) => {
        const playerIds = Object.keys(context.players);
        const intro = context.introductionMessages ?? {};
        return playerIds.every((id) => intro[id] > 0);
      },
    },
  }).createMachine({
    id: "influence-game",
    context: initialContext,
    initial: initialPhase,
    output: (ctx) => ctx.context,
    states: {
      [Phase.INIT]: {
        on: {
          PLAYER_READY: {
            actions: [
              assign({
                ready: ({ context, event }) => {
                  return { ...context.ready, [event.playerId]: true };
                },
              }),
            ],
          },
        },
        always: {
          guard: ({ context }) => {
            const playerIds = Object.keys(context.players);
            return playerIds.every((id) => context.ready[id]);
          },
          target: Phase.INTRODUCTION,
        },
      },
      [Phase.INTRODUCTION]: {
        entry: [
          assign({
            introTimerId: ({ self }) => {
              return timers.schedule(INTRO_TIMER_MS, () => {
                self.send({ type: "INTRODUCTION_TIMER_EXPIRED" });
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
                  Object.keys(context.players).length
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
                  return timers.schedule(READY_TIMER_MS, () => {
                    self.send({ type: "READY_TIMER_EXPIRED" });
                  });
                },
              }),
            ],
          },
          ALL_PLAYERS_READY: Phase.INTRO_DR,
          INTRODUCTION_TIMER_EXPIRED: Phase.INTRO_DR,
          READY_TIMER_EXPIRED: Phase.INTRO_DR,
        },
      },
      [Phase.INTRO_DR]: {
        // entry: [
        //   "resetReady",
        //   ({ context, self }) => {
        //     if (!context.introTimerId) {
        //       const id = timers.schedule(READY_TIMER_MS, () => {
        //         self.send({ type: "TIMER_EXPIRED" });
        //       });
        //       return { introTimerId: id };
        //     }
        //   },
        // ],
        // exit: ["cancelIntroTimer", "clearIntroData"],
        on: {
          // Handshake: when players say ready, move to next phase
          PLAYER_READY: [
            {
              actions: [
                assign({
                  ready: ({ context, event }) => {
                    return { ...context.ready, [event.playerId]: true };
                  },
                }),
                ({ context, self }) => {
                  if (
                    Object.keys(context.ready).length ===
                    Object.keys(context.players).length
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
                  return timers.schedule(READY_TIMER_MS, () => {
                    self.send({ type: "READY_TIMER_EXPIRED" });
                  });
                },
              }),
            ],
          },
          ALL_PLAYERS_READY: Phase.LOBBY,
          READY_TIMER_EXPIRED: Phase.LOBBY,
        },
      },
      [Phase.LOBBY]: {
        entry: ({ context, self }) => {
          if (!context.introTimerId) {
            const id = timers.schedule(INTRO_TIMER_MS, () => {
              self.send({ type: "INTRODUCTION_TIMER_EXPIRED" });
            });
            return { introTimerId: id };
          }
        },
        exit: ["cancelIntroTimer"],
        on: { INTRODUCTION_TIMER_EXPIRED: Phase.LOBBY_DR },
        type: "atomic",
      },
      [Phase.LOBBY_DR]: {
        on: {
          INTRODUCTION_TIMER_EXPIRED: Phase.LOBBY,
        },
      },
    },
  });
}
