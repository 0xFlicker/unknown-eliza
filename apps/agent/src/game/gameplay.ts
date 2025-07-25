// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, setup } from "xstate";
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
  | { type: "ALL_PLAYERS_READY" }
  | { type: "END_ROUND" }
  | { type: "PLAYER_READY"; playerId: string };

export type GameplayEmitted = { type: "PLAYER_READY_ERROR"; error: Error };

export function createGameplayMachine({
  phaseTimeoutMs,
  diaryTimeoutMs,
}: {
  phaseTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
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
      allPlayersReady: { type: "final" },
    },
  });
}
