import { assign, emit, setup } from "xstate";
import { UUID } from "@elizaos/core";

// Events
export type DiaryEventDiaryResponse = {
  type: "GAME:DIARY_RESPONSE";
  playerId: UUID;
  roomId: UUID;
  messageId: UUID;
};
export type DiaryEventPlayerReady = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};
export type DiaryEventDiaryPrompt = {
  type: "GAME:DIARY_PROMPT";
  playerId: UUID;
  messageId: UUID; // messageId provided externally by house agent
};

export type DiaryEvent =
  | DiaryEventDiaryResponse
  | DiaryEventPlayerReady
  | DiaryEventDiaryPrompt;

// Emitted events (House -> Players / System)
export type DiaryEmittedAllPlayersReady = {
  type: "GAME:ALL_PLAYERS_READY";
  roomId: UUID;
  transitionReason: string;
};

export type DiaryEmitted = DiaryEmittedAllPlayersReady;

export interface DiaryContext {
  roomId: UUID;
  players: UUID[];
  // playerId -> list of messageIds
  prompts: Record<UUID, UUID[]>;
  // prompt messageId -> response messageId
  responses: Record<UUID, UUID>;
  // playerId -> whether they are ready
  playersReady: Record<UUID, boolean>;
}

export interface DiaryInput {
  roomId: UUID;
  players: UUID[];
}

export function createDiaryMachine() {
  return setup({
    types: {
      context: {} as DiaryContext,
      input: {} as DiaryInput,
      events: {} as DiaryEvent,
      emitted: {} as DiaryEmitted,
    },
    guards: {
      allPlayersReady: ({ context }) =>
        context.players.every((p) => context.playersReady[p]),
    },
    actions: {
      markResponse: assign(({ context, event }) => {
        if (event.type !== "GAME:DIARY_RESPONSE") return {};
        const list = context.responses[event.playerId] || [];
        return {
          responses: {
            ...context.responses,
            [event.playerId]: [...list, event.messageId],
          },
        };
      }),
      markPlayerReady: assign(({ context, event }) => {
        if (event.type !== "GAME:PLAYER_READY") return {};
        return {
          playersReady: {
            ...context.playersReady,
            [event.playerId]: true,
          },
        };
      }),
    },
  }).createMachine({
    id: "house-diary",
    context: ({ input }) => ({
      roomId: input.roomId,
      players: input.players,
      responses: {},
      prompts: {},
      playersReady: input.players.reduce(
        (acc, p) => {
          acc[p] = false;
          return acc;
        },
        {} as Record<UUID, boolean>,
      ),
    }),
    initial: "prompting",
    states: {
      prompting: {
        on: {
          ["GAME:DIARY_PROMPT"]: {
            target: "prompting",
            actions: [
              assign(({ context, event }) => ({
                prompts: {
                  ...context.prompts,
                  [event.playerId]: [
                    ...(context.prompts[event.playerId] ?? []),
                    event.messageId,
                  ],
                },
              })),
            ],
          },
          ["GAME:PLAYER_READY"]: {
            actions: ["markPlayerReady"],
            target: "prompting",
          },
        },
        always: [{ guard: "allPlayersReady", target: "finalize" }],
      },
      finalize: {
        entry: [
          emit(({ context }) => {
            const evt: DiaryEmittedAllPlayersReady = {
              type: "GAME:ALL_PLAYERS_READY",
              roomId: context.roomId,
              transitionReason: "all_players_ready",
            };
            return evt;
          }),
        ],
        type: "final",
      },
    },
  });
}
