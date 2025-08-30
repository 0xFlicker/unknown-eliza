import { assign, emit, sendTo, setup } from "xstate";
import { Phase } from "../types";
import { UUID } from "@elizaos/core";
import { createGameplayMachine, GameplayEvent } from "../gameplay";
import { shuffleArray } from "@/utils/random";

export type WhisperContext = {
  players: UUID[]; // participants in the overall game
  // roomId -> { participants: UUID[], messagesByPlayer: Record<UUID, number> }
  rooms: Record<
    UUID,
    {
      participants: UUID[];
      owner: UUID;
      messagesByPlayer: Record<UUID, number>;
      createdAt: number;
    }
  >;
  // Secret turn order owned by the house (kept here for sequencing)
  turnOrder: UUID[];
  currentTurnIndex: number;
  remainingRequests: Record<UUID, number>;
  settings?: WhisperSettings;
};

export type WhisperSettings = {
  maxMessagesPerPlayerPerRoom?: number;
  perRoomMaxParticipants?: number;
};

export type WhisperInput = {
  players: {
    id: UUID;
    maxRequests: number;
  }[];
  settings?: WhisperSettings;
};

export type WhisperEvent =
  | { type: "CREATE_ROOM"; roomId: UUID; ownerId: UUID; participantIds: UUID[] }
  | { type: "LEAVE_ROOM"; roomId: UUID; playerId: UUID }
  | { type: "MESSAGE_SENT"; roomId: UUID; playerId: UUID }
  | { type: "END_ROOM"; roomId: UUID }
  | { type: "PASS"; playerId: UUID }
  | GameplayEvent;

export type WhisperEmitted =
  | { type: "WHISPER_ERROR" }
  | { type: "WHISPER_COMPLETE" }
  | { type: "WHISPER_YOUR_TURN"; playerId: UUID };

// room lifecycle events emitted by the whisper machine
export type WhisperRoomOpened = { type: "WHISPER_ROOM_OPENED"; roomId: UUID };
export type WhisperRoomClosed = { type: "WHISPER_ROOM_CLOSED"; roomId: UUID };

export type WhisperEmittedFull =
  | WhisperEmitted
  | WhisperRoomOpened
  | WhisperRoomClosed;

export function createWhisperMachine({
  roomTimeoutMs,
  roundTimeoutMs,
  diaryTimeoutMs,
  pickTimeoutMs,
}: {
  roomTimeoutMs: number;
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
  pickTimeoutMs: number;
}) {
  return setup({
    types: {
      context: {} as WhisperContext,
      input: {} as WhisperInput,
      events: {} as WhisperEvent,
      emitted: {} as WhisperEmittedFull,
    },
    actions: {
      nextPlayer: assign(({ context }) => {
        if (context.turnOrder.length === 0) return { currentTurnIndex: 0 };
        return {
          currentTurnIndex:
            (context.currentTurnIndex + 1) % context.turnOrder.length,
        };
      }),
      nextRound: assign(({ context }) => {
        const playersWithRequestRemaining = context.turnOrder.filter(
          (playerId) => (context.remainingRequests[playerId] ?? 0) > 0,
        );
        return {
          turnOrder: shuffleArray(playersWithRequestRemaining),
          currentTurnIndex: 0,
        };
      }),
      emitYourTurn: emit(({ context }) => {
        const payload: WhisperEmitted = {
          type: "WHISPER_YOUR_TURN",
          playerId: context.turnOrder[context.currentTurnIndex],
        };
        return payload as WhisperEmittedFull;
      }),
      emitRoomOpened: emit(({ event }) => {
        if (event.type === "CREATE_ROOM") {
          const payload: WhisperRoomOpened = {
            type: "WHISPER_ROOM_OPENED",
            roomId: event.roomId,
          };
          return payload;
        }
        return { type: "WHISPER_ERROR" } as WhisperEmittedFull;
      }),
      emitRoomClosed: emit(({ event }) => {
        if (event.type === "LEAVE_ROOM" || event.type === "END_ROOM") {
          const rid = (event as { roomId: UUID }).roomId;
          const payload: WhisperRoomClosed = {
            type: "WHISPER_ROOM_CLOSED",
            roomId: rid,
          };
          return payload;
        }
        return { type: "WHISPER_ERROR" } as WhisperEmittedFull;
      }),
    },
    actors: {
      gameplay: createGameplayMachine({
        phaseTimeoutMs: roundTimeoutMs,
        diaryTimeoutMs,
      }),
    },
    guards: {
      hasActiveRooms: ({ context }) => Object.keys(context.rooms).length > 0,
      hasRemainingRequests: ({ context }) => {
        // console.log("Checking remaining requests", context);
        if (context.turnOrder.length === 0) return false;
        const currentPlayerId = context.turnOrder[context.currentTurnIndex];
        return (context.remainingRequests[currentPlayerId] ?? 0) > 0;
      },
      hasActiveAndRemainingRequests: ({ context }) => {
        if (context.turnOrder.length === 0) return false;
        const currentPlayerId = context.turnOrder[context.currentTurnIndex];
        return (
          (context.remainingRequests[currentPlayerId] ?? 0) > 0 &&
          Object.keys(context.rooms).length > 0
        );
      },
      hasNextPlayer: ({ context }) => {
        return context.turnOrder.length > 0;
      },
      isLastPlayer: ({ context }) => {
        return (
          context.turnOrder.length > 0 &&
          context.currentTurnIndex === context.turnOrder.length - 1
        );
      },
      isLastPlayerAndNoRemainingRequests: ({ context }) => {
        if (context.turnOrder.length === 0) return false;
        const isLast =
          context.currentTurnIndex === context.turnOrder.length - 1;
        if (!isLast) return false;
        const playersWithRequestRemaining = context.turnOrder.filter(
          (playerId) => (context.remainingRequests[playerId] ?? 0) > 0,
        );
        return playersWithRequestRemaining.length === 0;
      },
    },
  }).createMachine({
    id: "whisper",
    context: ({ input }) => ({
      players: input.players.map((p) => p.id),
      rooms: {},
      turnOrder: shuffleArray(input.players.map((p) => p.id)),
      currentTurnIndex: 0,
      remainingRequests: input.players.reduce(
        (acc, { id, maxRequests }) => ({ ...acc, [id]: maxRequests }),
        {} as Record<UUID, number>,
      ),
      settings: {
        maxMessagesPerPlayerPerRoom:
          input.settings?.maxMessagesPerPlayerPerRoom ?? 3,
        perRoomMaxParticipants: input.settings?.perRoomMaxParticipants ?? 4,
      } as WhisperSettings,
    }),
    initial: "idle",
    states: {
      idle: {
        always: [
          { guard: "hasRemainingRequests", target: "picking" },
          { target: "diary" },
        ],
      },
      next: {
        always: [
          {
            description:
              "If this is the last player and no one has requests, go to diary",
            guard: "isLastPlayerAndNoRemainingRequests",
            target: "diary",
          },
          {
            description: "If this is the last player, start a new round",
            guard: "isLastPlayer",
            actions: "nextRound",
            target: "picking",
          },
          {
            description:
              "Move to the next player. Should only be called by the house",
            guard: "hasNextPlayer",
            actions: "nextPlayer",
            target: "picking",
          },
        ],
      },
      picking: {
        entry: [
          // Notify current player that it's their turn
          emit(({ context }) => ({
            type: "WHISPER_YOUR_TURN",
            playerId: context.turnOrder[context.currentTurnIndex],
          })),
        ],
        after: {
          [pickTimeoutMs]: {
            target: "pick-timeout",
          },
        },
        on: {
          PASS: [
            {
              description:
                "Pass the turn to the next player and forfeit remaining requests",
              guard: "hasNextPlayer",
              actions: [
                assign(({ context }) => {
                  const currentPlayerId =
                    context.turnOrder[context.currentTurnIndex];
                  return {
                    ...context,
                    remainingRequests: {
                      ...context.remainingRequests,
                      [currentPlayerId]: 0,
                    },
                  };
                }),
                "nextPlayer",
                "emitYourTurn",
              ],
            },
          ],
          CREATE_ROOM: [
            {
              guard: ({ context, event }) => {
                const cap = context.settings?.perRoomMaxParticipants ?? 4;
                if (event.participantIds.length > cap) return false;
                const required = Math.max(0, event.participantIds.length - 1);
                return (
                  (context.remainingRequests[event.ownerId] ?? 0) >= required
                );
              },
              actions: [
                assign(({ context, event }) => {
                  const required = Math.max(0, event.participantIds.length - 1);
                  return {
                    rooms: {
                      ...context.rooms,
                      [event.roomId]: {
                        participants: event.participantIds,
                        messagesByPlayer: {},
                        createdAt: Date.now(),
                        owner: event.ownerId,
                      },
                    },
                    remainingRequests: {
                      ...context.remainingRequests,
                      [event.ownerId]: Math.max(
                        0,
                        (context.remainingRequests[event.ownerId] ?? 0) -
                          required,
                      ),
                    },
                  } as Partial<typeof context>;
                }),
                "emitRoomOpened",
              ],
              target: "active",
            },
          ],
        },
      },
      ["pick-timeout"]: {
        entry: [
          assign(({ context }) => {
            const currentPlayerId = context.turnOrder[context.currentTurnIndex];
            return {
              ...context,
              remainingRequests: {
                ...context.remainingRequests,
                [currentPlayerId]: 0,
              },
            };
          }),
        ],
        target: "next",
      },
      active: {
        on: {
          MESSAGE_SENT: [
            {
              guard: ({ context, event }) => {
                const room = context.rooms[event.roomId];
                if (!room) return false;
                if (!room.participants.includes(event.playerId)) return false;
                const prev = room.messagesByPlayer[event.playerId] || 0;
                const maxPer =
                  (context.settings as WhisperSettings)
                    .maxMessagesPerPlayerPerRoom ?? 3;
                return prev < maxPer;
              },
              actions: assign(({ context, event }) => {
                const room = context.rooms[event.roomId];
                const prev = room.messagesByPlayer[event.playerId] || 0;
                return {
                  rooms: {
                    ...context.rooms,
                    [event.roomId]: {
                      participants: room.participants,
                      messagesByPlayer: {
                        ...room.messagesByPlayer,
                        [event.playerId]: prev + 1,
                      },
                      createdAt: room.createdAt,
                    },
                  },
                };
              }),
              target: "active",
            },
          ],
          END_ROOM: {
            actions: [
              assign(({ context, event }) => {
                const { [event.roomId]: _removed, ...rest } = context.rooms;
                return { rooms: rest } as Partial<WhisperContext>;
              }),
              "emitRoomClosed",
            ],
            target: "next",
          },
          LEAVE_ROOM: [
            {
              description:
                "When the owner of the room leaves, it closes the room immediately",
              guard: ({ context, event: { playerId, roomId } }) => {
                const room = context.rooms[roomId];
                if (!room) return false;
                return room.owner === playerId;
              },
              actions: [
                assign(({ context, event: { playerId, roomId } }) => {
                  const { [roomId]: _removed, ...restRooms } = context.rooms;
                  return {
                    rooms: {
                      ...restRooms,
                    },
                  } as Partial<WhisperContext>;
                }),
                "emitRoomClosed",
              ],
              target: "next",
            },
            {
              description: "When the last participant leaves the room",
              guard: ({ context, event: { playerId, roomId } }) => {
                const room = context.rooms[roomId];
                if (!room) return false;
                return (
                  room.participants.includes(playerId) &&
                  room.participants.length === 1
                );
              },
              actions: [
                assign(({ context, event: { playerId, roomId } }) => {
                  const { [roomId]: _removed, ...restRooms } = context.rooms;
                  return {
                    rooms: {
                      ...restRooms,
                    },
                  } as Partial<WhisperContext>;
                }),
                "emitRoomClosed",
              ],
              target: "next",
            },
            {
              description:
                "When a participant leaves the room but there are still other participants",
              guard: ({ context, event: { playerId, roomId } }) => {
                const room = context.rooms[roomId];
                if (!room) return false;
                return (
                  room.participants.includes(playerId) &&
                  room.participants.length > 1
                );
              },
              actions: [
                assign(({ context, event: { playerId, roomId } }) => {
                  const {
                    [roomId]: { participants, ...restRoom },
                    ...restRooms
                  } = context.rooms;
                  return {
                    rooms: {
                      [roomId]: {
                        participants: participants.filter(
                          (id) => id !== playerId,
                        ),
                        ...restRoom,
                      },
                      ...restRooms,
                    },
                  } as Partial<WhisperContext>;
                }),
              ],
              target: "active",
            },
          ],
        },
        after: {
          // room must end by this timeout
          [roomTimeoutMs]: {
            target: "idle",
          },
        },
      },
      diary: {
        entry: [
          // Broadcast and kick off readiness collection for the gameplay child
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
            initialPhase: Phase.WHISPER,
            nextPhase: Phase.RUMOR,
          }),
          onDone: {
            target: "end",
            actions: [emit({ type: "WHISPER_COMPLETE" })],
          },
          onError: {
            target: "end",
            actions: [emit({ type: "WHISPER_ERROR" })],
          },
        },
      },
      end: { type: "final" },
    },
  });
}
