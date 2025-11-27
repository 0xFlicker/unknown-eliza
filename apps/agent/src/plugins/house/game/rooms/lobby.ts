import { assign, emit, sendTo, setup } from "xstate";
import { Phase } from "../types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine } from "../gameplay";

export type LobbyContext = {
  players: UUID[];
  roomId: UUID;
  // playerId -> list of messageIds they have sent during LOBBY
  lobbyMessages: Record<UUID, UUID[]>;
};

export type LobbyInput = {
  players: UUID[];
  roomId: UUID;
};

export type LobbyEventMessageSent = {
  type: "GAME:MESSAGE_SENT";
  playerId: UUID;
  messageId: UUID;
};

export type LobbyEventChannelExhausted = { type: "GAME:CHANNEL_EXHAUSTED" };
export type LobbyEventEndRound = { type: "GAME:END_ROUND" };
export type LobbyEventAreYouReady = { type: "GAME:ARE_YOU_READY" };
export type LobbyEventPlayerReady = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};

export type LobbyEvent =
  | LobbyEventMessageSent
  | LobbyEventChannelExhausted
  | LobbyEventEndRound
  | LobbyEventAreYouReady
  | LobbyEventPlayerReady;

export type LobbyEmittedAreYouReady = {
  type: "GAME:ARE_YOU_READY";
  roomId?: UUID;
  playerId: UUID;
};
export type LobbyEmittedPlayerReadyError = {
  type: "GAME:PLAYER_READY_ERROR";
  error: Error;
  roomId?: UUID;
};

export type LobbyEmitted =
  | LobbyEmittedPlayerReadyError
  | LobbyEmittedAreYouReady;

export function createLobbyMachine({
  roundTimeoutMs,
  diaryTimeoutMs,
}: {
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
    types: {
      context: {} as LobbyContext,
      input: {} as LobbyInput,
      events: {} as LobbyEvent,
      emitted: {} as LobbyEmitted,
    },
    actors: {
      gameplay: createGameplayMachine({
        phaseTimeoutMs: roundTimeoutMs,
        diaryTimeoutMs: diaryTimeoutMs,
      }),
    },
  }).createMachine({
    id: "lobby",
    context: ({ input }) => ({
      players: input.players,
      lobbyMessages: {},
      roomId: input.roomId,
    }),
    initial: "chat",
    states: {
      chat: {
        on: {
          ["GAME:MESSAGE_SENT"]: {
            actions: assign(({ context, event }) => ({
              lobbyMessages: {
                ...context.lobbyMessages,
                [event.playerId]: [
                  ...(context.lobbyMessages[event.playerId] || []),
                  event.messageId,
                ],
              },
            })),
          },
          ["GAME:END_ROUND"]: {
            target: "strategy",
          },
          ["GAME:CHANNEL_EXHAUSTED"]: {
            target: "strategy",
          },
        },
        after: {
          [roundTimeoutMs]: {
            target: "strategy",
          },
        },
      },
      strategy: {
        entry: [
          // Kick off diary collection for the gameplay child
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
            initialPhase: Phase.LOBBY,
            nextPhase: Phase.WHISPER,
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
