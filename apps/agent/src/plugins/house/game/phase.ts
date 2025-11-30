// Replace Phase state machine with basic setup builder (no diary invoke yet)
import { assign, createActor, emit, forwardTo, sendTo, setup } from "xstate";
import "xstate/guards";
import { GameSettings, Phase } from "./types";
import { UUID } from "@elizaos/core";
import {
  createGameplayMachine,
  GameplayEmitted,
  GameplayEvent,
} from "./gameplay";
import { randomUUID } from "@/lib/utils";
import { createDiaryMachine } from "./rooms/diary";
import { shuffleArray } from "@/utils/random";

export type WhisperSettings = {
  requestsPerPlayer?: number;
  maxMessagesPerPlayerPerRoom?: number;
  perRoomMaxParticipants?: number;
};

export interface PhaseContext {
  players: UUID[];
  playersReady: Record<UUID, boolean>;
  minPlayers: number;
  maxPlayers: number;
  startPhase?: Phase;
  introduction?: {
    roomId: UUID;
    messages: Record<UUID, UUID>;
  };
  lobby?: {
    roomId: UUID;
  };
  whisper?: {
    activeRoom?: {
      roomId: UUID;
      participants: UUID[];
      owner: UUID;
      messagesByPlayer: Record<UUID, number>;
      createdAt: number;
    };
    turnOrder: UUID[];
    currentTurnIndex: number;
    remainingRequests: Record<UUID, number>;
  };
  whisperSettings?: WhisperSettings;
}

export type PhaseInput = {
  players: UUID[];
  maxPlayers: number;
  minPlayers: number;
  startPhase?: Phase;
  whisperSettings?: WhisperSettings;
};

export type PhaseEventDiaryPrompt = {
  type: "GAME:DIARY_PROMPT";
  playerId: UUID;
  messageId: UUID;
  roomId: UUID;
};

export type GameMessageEvent = {
  type: "GAME:MESSAGE_SENT";
  roomId: UUID;
  playerId: UUID;
  messageId: UUID;
};

export type GameEventCreateRoom = {
  type: "GAME:CREATE_ROOM";
  ownerId?: UUID;
  roomId: UUID;
  participantIds: UUID[];
};

export type GameChannelExhaustedEvent = {
  type: "GAME:CHANNEL_EXHAUSTED";
  roomId: UUID;
};

export type GameEndRoundEvent = {
  type: "GAME:END_ROUND";
  roomId: UUID;
};

export type IntroductionAreYouReadyEvent = {
  type: "GAME:ARE_YOU_READY";
};

export type IntroductionPlayerReadyEvent = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};

export type IntroductionDiaryResponseEvent = {
  type: "GAME:DIARY_RESPONSE";
  playerId: UUID;
  roomId: UUID;
  messageId: UUID;
};

export type IntroductionDiaryPromptEvent = {
  type: "GAME:DIARY_PROMPT";
  targetPlayerId: UUID;
  messageId: UUID;
};

export type WhisperEventEndRoom = { type: "GAME:END_ROOM"; roomId: UUID };
export type WhisperEventLeaveRoom = { type: "GAME:LEAVE_ROOM"; playerId: UUID };
export type WhisperEventPass = { type: "GAME:PASS"; playerId: UUID };

export type WhisperEvent =
  | WhisperEventLeaveRoom
  | WhisperEventPass
  | WhisperEventEndRoom;

export type PhaseIntroductionEvents =
  | GameMessageEvent
  | GameEventCreateRoom
  | GameChannelExhaustedEvent
  | GameEndRoundEvent
  | IntroductionAreYouReadyEvent
  | IntroductionPlayerReadyEvent
  | IntroductionDiaryResponseEvent
  | IntroductionDiaryPromptEvent;

export type PhaseEvent =
  | PhaseIntroductionEvents
  | GameplayEvent
  | GameMessageEvent
  | PhaseEventDiaryPrompt
  | WhisperEvent;

export type IntroductionEmittedPlayerReadyErrorEmitted = {
  type: "GAME:PLAYER_READY_ERROR";
  error: Error;
  roomId?: UUID;
};

export type IntroductionEmittedAreYouReadyEmitted = {
  type: "GAME:ARE_YOU_READY";
  roomId?: UUID;
  playerId: UUID;
};

// export type IntroductionRoomCreatedEmitted = {
//   type: "GAME:INTRODUCTION_ROOM_CREATED";
//   roomId: UUID;
//   playerIds: UUID[];
// };

export type IntroductionRoomPhaseEnteredEmitted = {
  type: "GAME:PHASE_ENTERED";
  phase: Phase.INTRODUCTION;
  roomId?: UUID;
};

export type WhisperRoomClosed = {
  type: "GAME:WHISPER_ROOM_CLOSED";
  roomId?: UUID;
};
export type WhisperEmittedYourTurn = {
  type: "GAME:WHISPER_YOUR_TURN";
  playerId: UUID;
  roomId?: UUID;
};

export type IntroductionEmitted =
  | IntroductionEmittedPlayerReadyErrorEmitted
  | IntroductionEmittedAreYouReadyEmitted
  | IntroductionRoomPhaseEnteredEmitted;

export type PhaseEmitted =
  | {
      type: "GAME:PHASE_ENTERED";
      phase: Phase;
    }
  | {
      type: "GAME:ALL_PLAYERS_READY";
      fromPhase: Phase;
      toPhase: Phase;
      transitionReason: string;
    }
  | {
      type: "GAME:PLAYER_READY_ERROR";
      error: Error;
    }
  // | GameplayEmitted
  | IntroductionEmitted
  | WhisperEmittedYourTurn
  | WhisperRoomClosed;
// | LobbyEmitted
// | WhisperEmitted
// | IntroductionRoomCreatedEmitted;

export function createPhaseMachine(gameSettings: GameSettings) {
  const {
    timers: {
      round,
      diary,
      diary_response,
      diary_ready,
      diary_prompt,
      whisper,
      whisper_pick,
      whisper_room,
    },
  } = gameSettings;
  return setup({
    types: {
      context: {} as PhaseContext,
      events: {} as PhaseEvent,
      input: {} as PhaseInput,
      emitted: {} as PhaseEmitted,
    },
    actors: {
      gameplay: createGameplayMachine({
        phaseTimeoutMs: round,
        diaryTimeoutMs: diary,
      }),
      diary: createDiaryMachine(),
    },
    guards: {
      allPlayersIntroduced: ({ context }) => {
        return (
          Object.keys(context.introduction?.messages ?? {}).length >=
          context.players.length
        );
      },
    },
  }).createMachine({
    id: "phase",
    context: ({ input }) => ({
      players: input.players,
      playersReady: {},
      minPlayers: input.minPlayers,
      maxPlayers: input.maxPlayers,
      startPhase: input.startPhase,
      whisperSettings: input.whisperSettings,
    }),
    initial: "init",
    states: {
      init: {
        on: {
          ["GAME:PLAYER_READY"]: {
            target: "init",
            actions: [
              assign({
                playersReady: ({ context, event }) => ({
                  ...context.players.reduce(
                    (acc, p) => {
                      acc[p] = context.playersReady[p] ?? false;
                      return acc;
                    },
                    {} as Record<UUID, boolean>,
                  ),
                  [event.playerId]: true,
                }),
              }),
            ],
          },
        },
        always: [
          {
            guard: ({ context }) => {
              return context.startPhase === Phase.INTRODUCTION;
            },
            target: "introduction_wait",
          },
          {
            guard: ({ context }) => {
              return context.startPhase === Phase.LOBBY;
            },
            target: "lobby_wait",
          },
          {
            guard: ({ context }) => {
              return context.startPhase === Phase.WHISPER;
            },
            target: "whisper",
          },
          {
            guard: ({ context }) => {
              if (context.players.length < context.minPlayers) return false;
              const playerIds = Object.keys(context.playersReady);
              if (playerIds.length < context.players.length) return false;
              return context.players.every(
                (id) => context.playersReady[id] === true,
              );
            },
            target: "introduction_wait",
            actions: [
              emit(() => ({
                type: "GAME:ALL_PLAYERS_READY",
                fromPhase: Phase.INIT,
                toPhase: Phase.INTRODUCTION,
                transitionReason: "all_players_ready",
              })),
            ],
          },
        ],
      },
      // Wait for house to create the introduction room
      introduction_wait: {
        on: {
          ["GAME:CREATE_ROOM"]: {
            actions: [
              assign(({ event }) => ({
                introduction: {
                  roomId: event.roomId,
                  messages: {},
                },
              })),
            ],
            target: "introduction",
          },
        },
      },
      introduction: {
        initial: "waiting",
        states: {
          waiting: {
            entry: [
              emit(({ context }) => ({
                type: "GAME:PHASE_ENTERED",
                phase: Phase.INTRODUCTION,
                roomId: context.introduction!.roomId,
              })),
            ],
            after: {
              [round]: {
                target: "strategy",
              },
            },
            on: {
              ["GAME:MESSAGE_SENT"]: {
                actions: assign(({ context, event }) => ({
                  introduction: {
                    roomId: context.introduction?.roomId!,
                    messages: {
                      ...context.introduction?.messages,
                      [event.playerId]: event.messageId,
                    },
                  },
                })),
              },
            },
            always: {
              guard: "allPlayersIntroduced",
              target: "strategy",
            },
          },
          strategy: {
            on: {
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "diary",
              src: "diary",
              input: ({ context }) => ({
                players: context.players,
                roomId: context.introduction!.roomId,
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
        onDone: {
          target: "lobby_wait",
        },
      },
      lobby_wait: {
        on: {
          ["GAME:CREATE_ROOM"]: {
            actions: [
              assign(({ event }) => ({
                lobby: {
                  roomId: event.roomId,
                },
              })),
            ],
            target: "lobby",
          },
        },
      },
      lobby: {
        initial: "chat",
        states: {
          chat: {
            entry: [
              emit(({ context }) => ({
                type: "GAME:PHASE_ENTERED",
                phase: Phase.LOBBY,
                roomId: context.lobby!.roomId,
              })),
            ],
            on: {
              ["GAME:END_ROUND"]: {
                target: "strategy",
              },
              ["GAME:CHANNEL_EXHAUSTED"]: {
                target: "strategy",
              },
            },
            after: {
              [round]: {
                target: "strategy",
              },
            },
          },
          strategy: {
            on: {
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "diary",
              src: "diary",
              input: ({ context }) => ({
                players: context.players,
                roomId: context.lobby!.roomId,
                timeoutMs: diary,
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
        onDone: {
          target: "whisper",
        },
      },
      whisper: {
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.WHISPER,
          }),
          assign(({ context }) => ({
            whisper: {
              turnOrder: context.players,
              currentTurnIndex: 0,
              remainingRequests: context.players.reduce(
                (acc, p) => {
                  acc[p] = context.whisperSettings?.requestsPerPlayer ?? 3;
                  return acc;
                },
                {} as Record<UUID, number>,
              ),
            },
          })),
        ],
        initial: "idle",
        states: {
          idle: {
            always: [
              {
                guard: ({ context }) => {
                  // console.log("Checking remaining requests", context);
                  if (context.whisper!.turnOrder.length === 0) return false;
                  const currentPlayerId =
                    context.whisper!.turnOrder[
                      context.whisper!.currentTurnIndex
                    ];
                  return (
                    (context.whisper!.remainingRequests[currentPlayerId] ?? 0) >
                    0
                  );
                },
                target: "picking",
              },
              { target: "diary" },
            ],
          },
          next: {
            always: [
              {
                description:
                  "If this is the last player and no one has requests, go to diary",
                guard: ({ context }) => {
                  if (context.whisper!.turnOrder.length === 0) return false;
                  const isLast =
                    context.whisper!.currentTurnIndex ===
                    context.whisper!.turnOrder.length - 1;
                  if (!isLast) return false;
                  const playersWithRequestRemaining =
                    context.whisper!.turnOrder.filter(
                      (playerId) =>
                        (context.whisper!.remainingRequests[playerId] ?? 0) > 0,
                    );
                  return playersWithRequestRemaining.length === 0;
                },
                target: "diary",
              },
              {
                description: "If this is the last player, start a new round",
                guard: ({ context }) => {
                  return (
                    context.whisper!.turnOrder.length > 0 &&
                    context.whisper!.currentTurnIndex ===
                      context.whisper!.turnOrder.length - 1
                  );
                },
                actions: assign({
                  whisper: ({ context }) => {
                    const playersWithRequestRemaining =
                      context.whisper!.turnOrder.filter(
                        (playerId) =>
                          (context.whisper!.remainingRequests[playerId] ?? 0) >
                          0,
                      );
                    return {
                      ...context.whisper!,
                      turnOrder: shuffleArray(playersWithRequestRemaining),
                      currentTurnIndex: 0,
                    };
                  },
                }),
                target: "picking",
              },
              {
                description:
                  "Move to the next player. Should only be called by the house",
                guard: ({ context }) => {
                  return context.whisper!.turnOrder.length > 0;
                },
                actions: assign({
                  whisper: ({ context }) => {
                    if (context.whisper!.turnOrder.length === 0)
                      return { ...context.whisper!, currentTurnIndex: 0 };
                    return {
                      ...context.whisper!,
                      currentTurnIndex:
                        (context.whisper!.currentTurnIndex + 1) %
                        context.whisper!.turnOrder.length,
                    };
                  },
                }),
                target: "picking",
              },
            ],
          },
          picking: {
            entry: [
              // Notify current player that it's their turn
              emit(({ context }) => ({
                type: "GAME:WHISPER_YOUR_TURN",
                playerId:
                  context.whisper!.turnOrder[context.whisper!.currentTurnIndex],
                roomId: context.whisper!.activeRoom
                  ? context.whisper!.activeRoom.roomId
                  : undefined,
              })),
            ],
            on: {
              ["GAME:PASS"]: [
                {
                  description:
                    "Pass the turn to the next player and forfeit remaining requests",
                  guard: ({ context }) => {
                    return context.whisper!.turnOrder.length > 0;
                  },
                  actions: [
                    assign(({ context }) => {
                      const currentPlayerId =
                        context.whisper!.turnOrder[
                          context.whisper!.currentTurnIndex
                        ];
                      return {
                        ...context,
                        whisper: {
                          ...context.whisper!,
                          remainingRequests: {
                            ...context.whisper!.remainingRequests,
                            [currentPlayerId]: 0,
                          },
                        },
                      };
                    }),
                    assign({
                      whisper: ({ context }) => {
                        if (context.whisper!.turnOrder.length === 0)
                          return { ...context.whisper!, currentTurnIndex: 0 };
                        return {
                          ...context.whisper!,
                          currentTurnIndex:
                            (context.whisper!.currentTurnIndex + 1) %
                            context.whisper!.turnOrder.length,
                        };
                      },
                    }),
                    emit(({ context }) => ({
                      type: "GAME:WHISPER_YOUR_TURN",
                      playerId:
                        context.whisper!.turnOrder[
                          context.whisper!.currentTurnIndex
                        ],
                      roomId: context.whisper!.activeRoom
                        ? context.whisper!.activeRoom.roomId
                        : undefined,
                    })),
                  ],
                },
              ],
              ["GAME:CREATE_ROOM"]: [
                {
                  guard: ({ context, event }) => {
                    const cap =
                      context.whisperSettings?.perRoomMaxParticipants ?? 4;
                    if (event.participantIds.length + 1 > cap) return false;
                    return (
                      (context.whisper!.remainingRequests[event.ownerId] ??
                        0) >=
                      event.participantIds.length - 1
                    );
                  },
                  actions: [
                    assign({
                      whisper: ({ context, event }) => {
                        const required = Math.max(
                          0,
                          event.participantIds.length - 1,
                        );
                        const newRequired =
                          (context.whisper!.remainingRequests[event.ownerId] ??
                            0) - required;
                        return {
                          ...context.whisper!,
                          activeRoom: {
                            roomId: event.roomId,
                            participants: event.participantIds,
                            messagesByPlayer: {},
                            createdAt: Date.now(),
                            owner: event.ownerId,
                          },
                          remainingRequests: {
                            ...context.whisper!.remainingRequests,
                            [event.ownerId]: Math.max(0, newRequired),
                          },
                        };
                      },
                    }),
                  ],
                  target: "active",
                },
              ],
            },
            after: {
              [whisper_pick]: {
                target: "pick-timeout",
              },
            },
          },
          ["pick-timeout"]: {
            entry: [
              assign({
                whisper: ({ context }) => {
                  const currentPlayerId =
                    context.whisper!.turnOrder[
                      context.whisper!.currentTurnIndex
                    ];
                  return {
                    ...context.whisper!,
                    remainingRequests: {
                      ...context.whisper!.remainingRequests,
                      [currentPlayerId]: 0,
                    },
                  };
                },
              }),
            ],
            target: "next",
          },
          active: {
            on: {
              ["GAME:MESSAGE_SENT"]: [
                {
                  guard: ({ context, event }) => {
                    const room = context.whisper!.activeRoom;
                    if (!room) return false;
                    if (!room.participants.includes(event.playerId))
                      return false;
                    const prev = room.messagesByPlayer[event.playerId] || 0;
                    const maxPer =
                      context.whisperSettings?.maxMessagesPerPlayerPerRoom ?? 3;
                    return prev < maxPer;
                  },
                  actions: assign({
                    whisper: ({ context, event }) => {
                      const room = context.whisper!.activeRoom!;
                      const prev = room.messagesByPlayer[event.playerId] || 0;
                      return {
                        ...context.whisper!,
                        activeRoom: {
                          ...room,
                          messagesByPlayer: {
                            ...room.messagesByPlayer,
                            [event.playerId]: prev + 1,
                          },
                        },
                      };
                    },
                  }),
                  target: "active",
                },
              ],
              ["GAME:END_ROOM"]: {
                actions: [
                  assign({
                    whisper: ({ context }) => {
                      return { ...context.whisper!, activeRoom: undefined };
                    },
                  }),
                ],
                target: "next",
              },
              ["GAME:CHANNEL_EXHAUSTED"]: {
                actions: [
                  assign({
                    whisper: ({ context }) => {
                      return { ...context.whisper!, activeRoom: undefined };
                    },
                  }),
                ],
                target: "next",
              },
              ["GAME:LEAVE_ROOM"]: [
                {
                  description:
                    "When the owner of the room leaves, it closes the room immediately",
                  guard: ({ context, event: { playerId } }) => {
                    const room = context.whisper!.activeRoom;
                    if (!room) return false;
                    return room.owner === playerId;
                  },
                  actions: [
                    assign({
                      whisper: ({ context }) => {
                        return { ...context.whisper!, activeRoom: undefined };
                      },
                    }),
                    emit(({ context }) => ({
                      type: "GAME:WHISPER_ROOM_CLOSED",
                      roomId: context.whisper!.activeRoom?.roomId,
                    })),
                  ],
                  target: "next",
                },
                {
                  description: "When the last participant leaves the room",
                  guard: ({ context, event: { playerId } }) => {
                    const room = context.whisper!.activeRoom;
                    if (!room) return false;
                    return (
                      room.participants.includes(playerId) &&
                      room.participants.length === 1
                    );
                  },
                  actions: [
                    assign({
                      whisper: ({ context }) => {
                        return {
                          ...context.whisper!,
                          activeRoom: undefined,
                        };
                      },
                    }),
                    emit(({ context }) => ({
                      type: "GAME:WHISPER_ROOM_CLOSED",
                      roomId: context.whisper!.activeRoom?.roomId,
                    })),
                  ],
                  target: "next",
                },
                {
                  description:
                    "When a participant leaves the room but there are still other participants",
                  guard: ({ context, event: { playerId } }) => {
                    const room = context.whisper!.activeRoom;
                    if (!room) return false;
                    return (
                      room.participants.includes(playerId) &&
                      room.participants.length > 1
                    );
                  },
                  actions: [
                    assign({
                      whisper: ({ context, event: { playerId } }) => {
                        const room = context.whisper!.activeRoom!;
                        const { participants, ...restRoom } = room;
                        return {
                          ...context.whisper!,
                          activeRoom: {
                            participants: participants.filter(
                              (id) => id !== playerId,
                            ),
                            ...restRoom,
                          },
                        };
                      },
                    }),
                  ],
                  target: "active",
                },
              ],
            },
            after: {
              // room must end by this timeout
              [whisper_room]: {
                target: "idle",
              },
            },
          },
          diary: {
            entry: [
              // Broadcast and kick off readiness collection for the gameplay child
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
                initialPhase: Phase.WHISPER,
                nextPhase: Phase.RUMOR,
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
      },
      rumor: {
        always: {
          actions: [sendTo("rumor", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.RUMOR,
          }),
        ],
        invoke: {
          id: "rumor",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.RUMOR,
            nextPhase: Phase.VOTE,
          }),
          onDone: {
            target: "vote",
          },
          onError: {
            target: "vote",
          },
        },
      },
      vote: {
        always: {
          actions: [sendTo("vote", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.VOTE,
          }),
        ],
        invoke: {
          id: "vote",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.VOTE,
            nextPhase: Phase.POWER,
          }),
          onDone: {
            target: "power",
          },
          onError: {
            target: "power",
          },
        },
      },
      power: {
        always: {
          actions: [sendTo("power", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.POWER,
          }),
        ],
        invoke: {
          id: "power",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.POWER,
            nextPhase: Phase.REVEAL,
          }),
          onDone: {
            target: "reveal",
          },
          onError: {
            target: "reveal",
          },
        },
      },
      reveal: {
        always: {
          actions: [sendTo("reveal", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.REVEAL,
          }),
        ],
        invoke: {
          id: "reveal",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.REVEAL,
            nextPhase: Phase.END,
          }),
          onDone: {
            target: "end",
          },
          onError: {
            target: "end",
          },
        },
      },
      // TODO: add state to evaluate if game is over
      end: { type: "final" },
    },
  });
}
