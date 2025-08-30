// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, emit, setup } from "xstate";
import { Phase } from "./types";
import { UUID } from "@elizaos/core";

export interface GameplayContext {
  players: UUID[];
  playersReady: Record<UUID, boolean>;
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
export type GameplayEvent =
  | { type: "ARE_YOU_READY" }
  | { type: "ADD_PLAYER"; playerId: UUID }
  | { type: "PLAYER_READY"; playerId: UUID }
  | { type: "END_ROUND" };

export type GameplayEmitted =
  | { type: "PHASE_ENTERED"; phase: Phase }
  | { type: "PLAYER_READY_ERROR"; error: Error }
  | {
      type: "ALL_PLAYERS_READY";
      fromPhase: Phase;
      toPhase: Phase;
      transitionReason: string;
    };

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
            type: "ALL_PLAYERS_READY",
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
    }),
    initial: "gameplay",
    states: {
      gameplay: {
        on: { END_ROUND: "diary" },
        after: {
          [phaseTimeoutMs]: {
            target: "diary",
          },
        },
      },
      diary: {
        on: {
          ARE_YOU_READY: {
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
          PLAYER_READY: {
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
