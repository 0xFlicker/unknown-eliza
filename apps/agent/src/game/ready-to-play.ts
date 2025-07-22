import { UUID } from "@elizaos/core";
import { assign, emit, setup } from "xstate";

export type ReadyToPlayContext = {
  playersReady: Record<UUID, boolean>;
};

export type ReadyToPlayInput = {
  players: UUID[];
};

export type ReadyToPlayEvent = { type: "PLAYER_READY"; playerId: string };

export function createReadyToPlayMachine() {
  return setup({
    types: {
      context: {} as ReadyToPlayContext,
      events: {} as ReadyToPlayEvent,
      input: {} as ReadyToPlayInput,
    },
    guards: {
      allPlayersReady: ({ context }) => {
        const playerIds = Object.keys(context.playersReady);
        if (playerIds.length === 0) return false;
        return playerIds.every((id) => context.playersReady[id]);
      },
    },
  }).createMachine({
    id: "readyToPlay",
    context: ({ input }) => ({
      playersReady: input.players.reduce(
        (acc, player) => {
          acc[player] = false;
          return acc;
        },
        {} as Record<UUID, boolean>,
      ),
    }),
    initial: "awaitingPlayers",
    states: {
      awaitingPlayers: {
        always: [
          {
            guard: "allPlayersReady",
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
      },
      allPlayersReady: {
        type: "final",
      },
    },
  });
}
