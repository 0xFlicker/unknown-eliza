import { assign, emit, sendTo, setup } from "xstate";
import { UUID } from "@elizaos/core";
import { Phase } from "../types";
import { createPlayerDiaryMachine } from "./diary";

export type PlayerIntroductionContext = {
  playerId: UUID;
  roomId?: UUID;
  players: UUID[];
  seenIntroductions: Record<UUID, UUID>;
  myIntroductionId?: UUID;
};

export type PlayerIntroductionInput = {
  playerId: UUID;
  players: UUID[];
};

export type PlayerIntroductionEventPhaseEntered = {
  type: "GAME:PHASE_ENTERED";
  phase: Phase;
  roomId?: UUID;
};
export type PlayerIntroductionEventMessageSent = {
  type: "GAME:MESSAGE_SENT";
  playerId: UUID;
  messageId: UUID;
};
export type PlayerIntroductionEventAgentEntered = {
  type: "GAME:AGENT_ENTERED";
  playerId: UUID;
};
export type PlayerIntroductionEventAgentLeft = {
  type: "GAME:AGENT_LEFT";
  playerId: UUID;
};
export type PlayerIntroductionEventDiaryPrompt = {
  type: "GAME:DIARY_PROMPT";
  roomId: UUID;
  messageId: UUID;
};
export type PlayerIntroductionEventAreYouReady = { type: "GAME:ARE_YOU_READY" };
export type PlayerIntroductionEventPlayerReady = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};

export type PlayerIntroductionEvent =
  | PlayerIntroductionEventPhaseEntered
  | PlayerIntroductionEventMessageSent
  | PlayerIntroductionEventAgentEntered
  | PlayerIntroductionEventAgentLeft
  | PlayerIntroductionEventDiaryPrompt
  | PlayerIntroductionEventAreYouReady
  | PlayerIntroductionEventPlayerReady;

export function createPlayerIntroductionMachine({
  roundTimeoutMs,
  diaryTimeoutMs,
}: {
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
    types: {
      context: {} as PlayerIntroductionContext,
      input: {} as PlayerIntroductionInput,
      events: {} as PlayerIntroductionEvent,
    },
    actors: {
      diary: createPlayerDiaryMachine(),
    },
    guards: {
      allIntroduced: ({ context }) =>
        context.players.length > 0 &&
        context.players.every(
          (p) => context.seenIntroductions[p] !== undefined,
        ),
    },
  }).createMachine({
    id: "player-introduction",
    context: ({ input }) => ({
      playerId: input.playerId,
      players: input.players,
      seenIntroductions: {},
    }),
    initial: "idle",
    states: {
      idle: {
        on: {
          ["GAME:PHASE_ENTERED"]: {
            guard: ({ event }) => event.phase === Phase.INTRODUCTION,
            target: "introduction",
            actions: assign(({ event }) => ({ roomId: event.roomId })),
          },
        },
      },
      introduction: {
        on: {
          ["GAME:MESSAGE_SENT"]: {
            actions: assign(({ context, event }) => ({
              seenIntroductions: {
                ...context.seenIntroductions,
                [event.playerId]: event.messageId,
              },
              myIntroductionId:
                event.playerId === context.playerId
                  ? event.messageId
                  : context.myIntroductionId,
            })),
          },
          ["GAME:AGENT_ENTERED"]: {
            actions: assign(({ context, event }) => ({
              players: Array.from(
                new Set([...context.players, event.playerId]),
              ),
            })),
          },
          ["GAME:AGENT_LEFT"]: {
            // We do not remove from players to keep expectations consistent
          },
        },
        always: [{ guard: "allIntroduced", target: "diary" }],
        after: { [roundTimeoutMs]: { target: "diary" } },
      },
      diary: {
        entry: [
          // Start diary child actor; influencer will respond when prompted
        ],
        on: {
          ["GAME:DIARY_PROMPT"]: {
            actions: [sendTo("diary", ({ event }) => event)],
          },
          ["GAME:ARE_YOU_READY"]: {
            actions: [sendTo("diary", ({ event }) => event)],
          },
          ["GAME:PLAYER_READY"]: {
            actions: [sendTo("diary", ({ event }) => event)],
          },
        },
        invoke: {
          id: "diary",
          src: "diary",
          input: ({ context }) => ({
            playerId: context.playerId,
            roomId: context.roomId!,
          }),
          onDone: {
            target: "complete",
          },
          onError: {
            target: "complete",
          },
        },
      },
      complete: { type: "final" },
    },
  });
}
