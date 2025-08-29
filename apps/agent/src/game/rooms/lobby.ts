import { assign, emit, sendTo, setup } from "xstate";
import { Phase } from "../types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine } from "../gameplay";

export type LobbyContext = {
  players: UUID[];
  // playerId -> list of messageIds they have sent during LOBBY
  lobbyMessages: Record<UUID, UUID[]>;
};

export type LobbyInput = {
  players: UUID[];
};

export type LobbyEvent =
  | { type: "MESSAGE_SENT"; playerId: UUID; messageId: UUID }
  | { type: "END_ROUND" }
  | { type: "ARE_YOU_READY" }
  | { type: "PLAYER_READY"; playerId: UUID };

export type LobbyEmitted =
  | { type: "PLAYER_READY_ERROR"; error: Error }
  | { type: "ARE_YOU_READY" };

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
    }),
    initial: "chat",
    states: {
      chat: {
        on: {
          MESSAGE_SENT: {
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
          END_ROUND: {
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
          emit(() => ({ type: "ARE_YOU_READY" })),
          sendTo("strategy", { type: "END_ROUND" }),
          sendTo("strategy", { type: "ARE_YOU_READY" }),
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
