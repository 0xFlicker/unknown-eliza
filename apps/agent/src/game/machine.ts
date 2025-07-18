import { setup, assign } from "xstate";
import { GameContext, GameEvent, Phase } from "./types";
import { TimerService } from "./timers/TimerService";

export const INTRO_TIMER_MS = 3 * 60 * 1000; // 3 minutes

export function createGameMachine(
  initialContext: GameContext,
  timers: TimerService,
) {
  return setup({
    types: {
      context: {} as GameContext,
      events: {} as GameEvent,
    },
    actions: {
      markReady: [
        assign({
          ready: ({ context, event }) => {
            if (event.type !== "PLAYER_READY") return context.ready;
            return { ...context.ready, [event.playerId]: true };
          },
        }),
        ({ self }) => self.send({ type: "READY_CHECK" }),
      ],
      recordIntroMessage: [
        assign({
          introductionMessages: ({ context, event }) => {
            if (event.type !== "INTRO_MESSAGE")
              return context.introductionMessages ?? {};
            const curr = context.introductionMessages ?? {};
            return {
              ...curr,
              [event.playerId]: (curr[event.playerId] ?? 0) + 1,
            };
          },
        }),
        ({ self }) => self.send({ type: "READY_CHECK" }),
      ],
      scheduleIntroTimer: ({ context, self }) => {
        if (!context.introTimerId) {
          const id = timers.schedule(INTRO_TIMER_MS, () => {
            self.send({ type: "TIMER_EXPIRED" });
          });
          // eslint-disable-next-line no-param-reassign
          (context as any).introTimerId = id;
        }
      },
      cancelIntroTimer: ({ context }) => {
        if (context.introTimerId) timers.cancel(context.introTimerId);
      },
      sendDiaryQuestions: ({ context, self }) => {
        if (!context.diaryRooms) {
          const ids = Object.keys(context.players);
          (context as any).diaryRooms = ids.reduce<Record<string, string>>(
            (acc, id) => {
              acc[id] = `diary-${id}`;
              return acc;
            },
            {},
          );
        }
        for (const [playerId, diaryRoomId] of Object.entries(
          context.diaryRooms!,
        )) {
          self.send({
            type: "DIARY_ROOM_QUESTION",
            playerId,
            diaryRoomId,
          } as GameEvent);
        }
      },
      clearIntroData: assign({
        introductionMessages: () => undefined,
        introTimerId: () => undefined,
        diaryRooms: () => undefined,
        // handshake timer removed
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
    initial: Phase.INIT,
    states: {
      [Phase.INIT]: {
        on: {
          PLAYER_READY: {
            actions: "markReady",
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
        entry: ["scheduleIntroTimer"],
        exit: ["cancelIntroTimer", "clearIntroData"],
        on: {
          INTRO_MESSAGE: {
            actions: "recordIntroMessage",
          },
          TIMER_EXPIRED: Phase.INTRO_DR,
        },
        always: {
          guard: ({ context }) => {
            const playerIds = Object.keys(context.players);
            const intro = context.introductionMessages ?? {};
            return playerIds.every((id) => intro[id] && intro[id] > 0);
          },
          target: Phase.INTRO_DR,
        },
      },
      [Phase.INTRO_DR]: {
        entry: ["resetReady", "sendDiaryQuestions"],
        exit: ["cancelIntroTimer", "clearIntroData"],
        on: {
          // Handshake: when players say ready, move to next phase
          PLAYER_READY: [
            {
              actions: "markReady",
              guard: "allPlayersReady",
              target: Phase.LOBBY,
            },
            { actions: "markReady" },
          ],
          // Timer fallback: go to next phase automatically
          TIMER_EXPIRED: Phase.LOBBY,
        },
      },
      [Phase.LOBBY]: {
        entry: "scheduleIntroTimer",
        exit: "cancelIntroTimer",
        on: { TIMER_EXPIRED: Phase.INTRO_DR },
        type: "atomic",
      },
    },
  });
}
