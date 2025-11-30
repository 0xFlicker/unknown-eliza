import { assign, emit, setup } from "xstate";
import { UUID } from "@elizaos/core";

export type PlayerDiaryContext = {
  playerId: UUID;
  roomId: UUID;
  messageId?: UUID;
  responded: boolean;
};

export type PlayerDiaryInput = {
  playerId: UUID;
  roomId: UUID;
};

export type PlayerDiaryEventDiaryPrompt = {
  type: "GAME:DIARY_PROMPT";
  roomId: UUID;
  messageId: UUID;
};
export type PlayerDiaryEventAreYouReady = { type: "GAME:ARE_YOU_READY" };
export type PlayerDiaryEventPromptTimeout = {
  type: "GAME:DIARY_PROMPT_TIMEOUT";
};
export type PlayerDiaryEventPlayerReady = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};
export type PlayerDiaryEventDiaryResponse = {
  type: "GAME:DIARY_RESPONSE";
  playerId: UUID;
  roomId: UUID;
  messageId: UUID;
};
export type PlayerDiaryEventResponseTimeout = {
  type: "GAME:DIARY_RESPONSE_TIMEOUT";
};
export type PlayerDiaryEventReadyTimeout = { type: "GAME:DIARY_READY_TIMEOUT" };
export type PlayerDiaryEventForceContinue = { type: "PLAYER:FORCE_CONTINUE" };

export type PlayerDiaryEvent =
  | PlayerDiaryEventDiaryPrompt
  | PlayerDiaryEventAreYouReady
  | PlayerDiaryEventPlayerReady
  | PlayerDiaryEventDiaryResponse
  | PlayerDiaryEventPromptTimeout
  | PlayerDiaryEventResponseTimeout
  | PlayerDiaryEventReadyTimeout
  | PlayerDiaryEventForceContinue;

export type PlayerDiaryEmittedReady = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
  roomId?: UUID;
};
export type PlayerDiaryEmittedDiaryResponseForward = {
  type: "GAME:DIARY_RESPONSE";
  playerId: UUID;
  roomId: UUID;
  messageId: UUID;
};

export type PlayerDiaryEmitted =
  | PlayerDiaryEmittedReady
  | PlayerDiaryEmittedDiaryResponseForward;

export function createPlayerDiaryMachine() {
  return setup({
    types: {
      context: {} as PlayerDiaryContext,
      input: {} as PlayerDiaryInput,
      events: {} as PlayerDiaryEvent,
      emitted: {} as PlayerDiaryEmitted,
    },
  }).createMachine({
    id: "player-diary",
    context: ({ input }) => ({
      playerId: input.playerId,
      roomId: input.roomId,
      responded: false,
    }),
    initial: "awaitPrompt",
    states: {
      awaitPrompt: {
        on: {
          ["GAME:DIARY_PROMPT"]: {
            target: "responding",
            actions: assign(({ event }) => ({ messageId: event.messageId })),
          },
          ["GAME:DIARY_PROMPT_TIMEOUT"]: {
            target: "awaitNextOrReady",
          },
          ["PLAYER:FORCE_CONTINUE"]: {
            target: "awaitNextOrReady",
          },
        },
      },
      responding: {
        on: {
          ["GAME:DIARY_RESPONSE"]: {
            target: "awaitNextOrReady",
            actions: [
              assign({ responded: () => true }),
              emit(({ event }) => ({
                type: "GAME:DIARY_RESPONSE",
                playerId: event.playerId,
                roomId: event.roomId,
                messageId: event.messageId,
              })),
            ],
          },
          ["GAME:DIARY_RESPONSE_TIMEOUT"]: {
            target: "awaitNextOrReady",
          },
          ["PLAYER:FORCE_CONTINUE"]: {
            target: "awaitNextOrReady",
          },
        },
      },
      awaitNextOrReady: {
        on: {
          ["GAME:DIARY_PROMPT"]: {
            target: "responding",
            actions: assign(({ event }) => ({ messageId: event.messageId })),
          },
          ["GAME:ARE_YOU_READY"]: {
            target: "finishingUp",
          },
          ["GAME:DIARY_READY_TIMEOUT"]: {
            target: "finishingUp",
          },
          ["PLAYER:FORCE_CONTINUE"]: {
            target: "finishingUp",
          },
        },
      },
      finishingUp: {
        entry: [],
        on: {
          ["GAME:PLAYER_READY"]: {
            target: "complete",
            actions: emit(({ context }) => ({
              type: "GAME:PLAYER_READY",
              playerId: context.playerId,
              roomId: context.roomId,
            })),
          },
          ["PLAYER:FORCE_CONTINUE"]: {
            target: "complete",
            actions: emit(({ context }) => ({
              type: "GAME:PLAYER_READY",
              playerId: context.playerId,
              roomId: context.roomId,
            })),
          },
        },
      },
      complete: { type: "final" },
    },
  });
}
