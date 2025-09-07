// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, emit, setup } from "xstate";
import { Phase } from "./types";
import { UUID } from "@elizaos/core";
import { randomUUID } from "@/lib/utils";

export interface GameplayContext {
  players: UUID[];
  playersReady: Record<UUID, boolean>;
  // Map of playerId -> diary roomId
  playerDiaryRoomIds: Record<UUID, UUID>;
  currentPhase: Phase;
  nextPhase: Phase;
}

export type GameplayInput = {
  players: UUID[];
  initialPhase: Phase;
  nextPhase: Phase;
};

export type GameplayState = "gameplay" | "diary" | "end";

// PhaseEvent includes both phase triggers and diary events
export type GameplayAreYouReadyEvent = { type: "GAME:ARE_YOU_READY" };
export type GameplayAddPlayerEvent = {
  type: "GAME:ADD_PLAYER";
  playerId: UUID;
};
export type GameplayPlayerReadyEvent = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};
export type GameplayCreateDiaryRoomEvent = {
  type: "GAME:CREATE_DIARY_ROOM";
  playerId: UUID;
};
export type GameplayChannelExhaustedEvent = { type: "GAME:CHANNEL_EXHAUSTED" };
export type GameplayEndRoundEvent = { type: "GAME:END_ROUND" };

export type GameplayEvent =
  | GameplayAreYouReadyEvent
  | GameplayAddPlayerEvent
  | GameplayPlayerReadyEvent
  | GameplayChannelExhaustedEvent
  | GameplayEndRoundEvent;

export type GameplayEmittedPhaseEntered = {
  type: "GAME:PHASE_ENTERED";
  roomId?: UUID;
  phase: Phase;
};
export type GameplayEmittedDiaryRoomsCreated = {
  type: "GAME:DIARY_ROOMS_CREATED";
  playerDiaryRoomIds: Record<UUID, UUID>;
};
export type GameplayEmittedPlayerReadyError = {
  type: "GAME:PLAYER_READY_ERROR";
  roomId?: UUID;
  error: Error;
};
export type GameplayEmittedAllPlayersReady = {
  type: "GAME:ALL_PLAYERS_READY";
  fromPhase: Phase;
  toPhase: Phase;
  transitionReason: string;
  roomId?: UUID;
};
export type GameplayEmittedAreYouReady = {
  type: "GAME:ARE_YOU_READY";
  roomId?: UUID;
  playerId: UUID;
};

export type GameplayEmitted =
  | GameplayEmittedPhaseEntered
  | GameplayEmittedDiaryRoomsCreated
  | GameplayEmittedPlayerReadyError
  | GameplayEmittedAllPlayersReady
  | GameplayEmittedAreYouReady;

export function createGameplayMachine({
  phaseTimeoutMs,
  diaryTimeoutMs,
}: {
  phaseTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
    actions: {
      announceAllPlayersReady: emit(
        ({ context }) =>
          ({
            type: "GAME:ALL_PLAYERS_READY",
            fromPhase: context.currentPhase,
            toPhase: context.nextPhase,
            transitionReason: "all_players_ready",
          }) as const,
      ),
    },
    types: {
      context: {} as GameplayContext,
      events: {} as GameplayEvent,
      input: {} as GameplayInput,
      emitted: {} as GameplayEmitted,
    },
    guards: {
      allPlayersReady: ({ context }) => {
        const playerIds = Object.keys(context.playersReady);
        if (playerIds.length === 0) return false;
        return playerIds.every((id) => context.playersReady[id]);
      },
    },
  }).createMachine({
    id: "phase",
    context: ({ input }) => ({
      players: input.players,
      currentPhase: input.initialPhase,
      nextPhase: input.nextPhase,
      playersReady: input.players.reduce(
        (acc, player) => {
          acc[player] = false;
          return acc;
        },
        {} as Record<UUID, boolean>,
      ),
      playerDiaryRoomIds: input.players.reduce(
        (acc, player) => {
          acc[player] = randomUUID();
          return acc;
        },
        {} as Record<UUID, UUID>,
      ),
    }),
    initial: "gameplay",
    states: {
      gameplay: {
        entry: [
          emit(({ context }) => ({
            type: "GAME:PHASE_ENTERED",
            phase: context.currentPhase,
          })),
          emit(({ context }) => ({
            type: "GAME:DIARY_ROOMS_CREATED",
            playerDiaryRoomIds: context.playerDiaryRoomIds,
          })),
        ],
        on: {
          ["GAME:END_ROUND"]: "diary",
          ["GAME:CHANNEL_EXHAUSTED"]: "diary",
        },
        after: {
          [phaseTimeoutMs]: {
            target: "diary",
          },
        },
      },
      diary: {
        on: {
          ["GAME:ARE_YOU_READY"]: {
            target: "awaitingPlayers",
          },
        },
      },
      awaitingPlayers: {
        always: [
          {
            guard: ({ context }) => {
              const playerIds = Object.keys(context.playersReady);
              if (playerIds.length === 0) return false;
              return playerIds.every((id) => context.playersReady[id]);
            },
            target: "allPlayersReady",
          },
        ],
        on: {
          ["GAME:PLAYER_READY"]: {
            target: "awaitingPlayers",
            actions: [
              assign({
                playersReady: ({ context, event }) => ({
                  ...context.playersReady,
                  [event.playerId]: true,
                }),
              }),
            ],
          },
        },
        after: {
          [diaryTimeoutMs]: {
            target: "allPlayersReady",
          },
        },
      },
      allPlayersReady: {
        entry: ["announceAllPlayersReady"],
        type: "final",
      },
    },
  });
}
