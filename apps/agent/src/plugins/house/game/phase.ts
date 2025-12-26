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

/**
 * Configuration options for the WHISPER phase.
 *
 * These values are provided via `GameSettings` and control how many
 * rooms and messages can be created during the whisper phase.
 */
export type WhisperSettings = {
  requestsPerPlayer?: number;
  maxMessagesPerPlayerPerRoom?: number;
  perRoomMaxParticipants?: number;
};

/**
 * Long–lived context for the phase state machine – this is the single
 * source of truth for phase orchestration across the full game round.
 */
export interface PhaseContext {
  gameId: UUID;
  players: UUID[];
  playersReady: Record<UUID, boolean>;
  minPlayers: number;
  maxPlayers: number;
  startPhase?: Phase;
  diaryRooms: Record<UUID, UUID>;
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
  rumor?: {
    roomId: UUID;
    messages: Record<UUID, UUID>;
  };
  whisperSettings?: WhisperSettings;
}

export type PlayerSettings = {
  agentId: UUID;
  diaryRoomId: UUID;
};

/**
 * Static input used to initialise the phase machine.
 */
export type PhaseInput = {
  playerSettings: PlayerSettings[];
  maxPlayers: number;
  minPlayers: number;
  startPhase?: Phase;
  whisperSettings?: WhisperSettings;
};

// ---------------------------------------------------------------------------
// Game events (shared across multiple phases)
// ---------------------------------------------------------------------------

export type PhaseEventDiaryPrompt = {
  type: "GAME:DIARY_PROMPT";
  playerId: UUID;
  messageId: UUID;
  roomId: UUID;
};

/**
 * Generic event for a player sending a message to a room.
 * Used by introduction, lobby and whisper phases.
 */
export type GameMessageEvent = {
  type: "GAME:MESSAGE_SENT";
  roomId: UUID;
  playerId: UUID;
  messageId: UUID;
};

/**
 * Event emitted when the House creates a new game room.
 * Used by multiple phases (introduction, lobby, whisper).
 */
export type GameEventCreateRoom = {
  type: "GAME:CREATE_ROOM";
  ownerId: UUID;
  roomId: UUID;
  participantIds: UUID[];
};

/**
 * Emitted when a channel can no longer accept new messages for the phase.
 */
export type GameChannelExhaustedEvent = {
  type: "GAME:CHANNEL_EXHAUSTED";
  roomId: UUID;
};

/**
 * Emitted when the House explicitly ends the public round.
 */
export type GameEndRoundEvent = {
  type: "GAME:END_ROUND";
  roomId: UUID;
};

// ---------------------------------------------------------------------------
// Introduction phase events
// ---------------------------------------------------------------------------

export type IntroductionAreYouReadyEvent = {
  type: "GAME:ARE_YOU_READY";
};

export type IntroductionPlayerReadyEvent = {
  type: "GAME:PLAYER_READY";
  playerId: UUID;
};

/**
 * Player has responded to a diary prompt during the introduction phase.
 */
export type IntroductionDiaryResponseEvent = {
  type: "GAME:DIARY_RESPONSE";
  playerId: UUID;
  roomId: UUID;
  messageId: UUID;
};

/**
 * House has prompted a specific player to write a diary entry.
 */
export type IntroductionDiaryPromptEvent = {
  type: "GAME:DIARY_PROMPT";
  targetPlayerId: UUID;
  messageId: UUID;
};

// ---------------------------------------------------------------------------
// Whisper phase events
// ---------------------------------------------------------------------------

export type WhisperEventEndRoom = { type: "GAME:END_ROOM"; roomId: UUID };
export type WhisperEventLeaveRoom = { type: "GAME:LEAVE_ROOM"; playerId: UUID };
export type WhisperEventPass = { type: "GAME:PASS"; playerId: UUID };

export type WhisperEvent =
  | WhisperEventLeaveRoom
  | WhisperEventPass
  | WhisperEventEndRoom;

// ---------------------------------------------------------------------------
// Phase event unions
// ---------------------------------------------------------------------------

/**
 * Events that are specific to the introduction phase.
 */
export type PhaseIntroductionEvents =
  | GameMessageEvent
  | GameEventCreateRoom
  | GameChannelExhaustedEvent
  | GameEndRoundEvent
  | IntroductionAreYouReadyEvent
  | IntroductionPlayerReadyEvent
  | IntroductionDiaryResponseEvent
  | IntroductionDiaryPromptEvent;

/**
 * Main event type accepted by the phase state machine.
 *
 * This intentionally combines both phase orchestration events and
 * gameplay/diary events forwarded down to child machines.
 */
export type PhaseEvent =
  | PhaseIntroductionEvents
  | GameplayEvent
  | GameMessageEvent
  | PhaseEventDiaryPrompt
  | WhisperEvent;

// ---------------------------------------------------------------------------
// Emitted events – notifications from the phase machine out to the world
// ---------------------------------------------------------------------------

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

export type IntroductionRoomPhaseEnteredEmitted = {
  type: "GAME:PHASE_ENTERED";
  phase: Phase.INTRODUCTION;
  roomId?: UUID;
};

export type IntroductionRoomCreatedEmitted = {
  type: "GAME:INTRODUCTION_ROOM_CREATED";
  roomId: UUID;
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
  | IntroductionRoomPhaseEnteredEmitted
  | IntroductionRoomCreatedEmitted;

/**
 * High‑level events emitted by the phase machine.
 *
 * These are consumed by the coordinator / EventBus and are the
 * only events that should leave the internal state machine boundary.
 */
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
  | IntroductionEmitted
  | WhisperEmittedYourTurn
  | WhisperRoomClosed;

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
    /** @xstate-layout N4IgpgJg5mDOIC5QAcAWBDWYB0BLAdrgC4DEA4gIICyAoggAoAyFAmjQEoD67NFAIiwDaABgC6iFAHtYxXJPwSQAD0QAmAKwBGbAA4AnMIBsAZk0B2HZvXCdqwwBoQATzWad2VQBY9ez8dVmhurGfgC+oY5omDgExCQi4kggyNKy8ooqCOqe7j556qrCmsKqqsaOLgjGwmbYnsGamsb6peYm4ZEYWHiEpIKaiVIyRHIKSZnZuXl6BUUlZRWInmXYM6Y6xnobwupmmh3JXTG98aqDyakj6eOIZqqLCIWN2IHquwaqtsbfB1HdsX1jOcUsNRhlEMEpvknvNys5EJp6thrMJUaVhNVDHYdL8jj0iAAnSQQACuAGMrvhOAB3dBxSi0BAAYR4FAAKjRuAB5LlUBKKEFpMagTK2B6IyzYQzCPSFCyGMxFWW46L4omkimjEgQeQ4WBEdBEHB-Y6E4nkyn8pKCyngx4BdQeSwBTSGNpecXWR0bXY6IJ6BU7dQq-74M0aynYWmyfBQcjUOi0ADKSYoZE5SZoADk2VahkK7fVDNh-CUfajfHpAp7lnUzAYin5655DHoQ6b1RbRlG6SNY-ExALLmCbgh6+5NF4A54Z6Z1ArxYZvNg3KUAjPhJ4McZ22rzZr5Nh9QTDWAoE5tbqegA3SQAaxwEFw6AJTjzF1B1xFCLdql06j0TFUUnZoHHhBBzH8bAijeAJW2WYxW13Ahwy7Q9j1Pc8SDAAkiQJbBkAAG0NAAzSQCQAW2wJ8XzfQdrWHL9lB-Sd-0AoxgLKP1Fx0TxkSsXY3U8NwMWQsNOwPfAj0JTCLwZOg+AASQodgWG4Ggk3oLks0zd8bRHb8ILgjw7GCIpNiMBdwKsLFdBA4TJg2YxgwiQ5VRQiTIwwo0sPkhhmDYLhWQEPTGOFZijN43RbDMRC9mMesLHFFtix0ADEU8WLMuyVQxNQyTpJPHy5ITBAlJUtT6HYXl6Fzej81tUdJyiowvB0CwdBsQodHFBLhFWDjnLuVRfFi3dCMkAAjSanBpXt40ZFleA5bleVCz9wtFe5wJGgoPDeb4dH0P0yk8cappmy98D1A0jQIvEJumujgTCu1SkMYt5y8IxnOKIwHhGwI6ksWwtjsDEzHOp7sDJDBSD87M+G5ABVLM+HWgtR1sCcZWabwvT8HrwPWdxPiXWUjDMAod1ck1sEemaYbhha6CZAAJCgsyzGhGE4GgAA0OeRpMOXR+qP0xwzsZXXHeJmHZCYeUwEpeP1pRKdQ0rMMwztph6LqcQrZKu45bwfajn1fDHGsM11NxXLc3RMTZXSxJXNB8OpGjeLRpTsXXOlVBnDe8s8LxwvCCOIogyMoi3aOtgyIrtvjESMV1vj0V3tsqOdtCzqwrE6n2dahxnQ980rytU9TNO03Txf0pjMhA9wEpRLwm14pWSmMF4bDeVtAMA+oy5DmTipZ-zWA4dT+CERvXqarxagxScCizgMtDMAHZVqKngmlcwtmyFzA+6YOjcnvzq8q6qqFqxPm4RLxi1UYos6xXit3MAGNm0Tq79nZBG1tkXc1JUC4FgMgHCeAICETAAOF6G07TNEQh4EIMoSge0RIhJWyxcheDeDKTqTR9h61VBAqBMD8K4HgYg-oyDJYRTQW-TBHwcF+DArnTKfFZT1ECNUbIo8KHdCodA2B10lB9EXig0crCMFbg4VnLhSsyYrirJ-Nw+gAyQ1ETgcRNDsBSL6AMIccjDIKNOlg9+Ki8HExKP1es5gyF+BCHo8+BjIESPwiY04TCbYsI2GwpR2C7HcMQKYPwLwZyWEnNrTYZ83JiO8UY5AuAyR3gIHGPy9AKApifptJYnxHTWJ8GvTYnhd7NF0G6dqWwLBNGcuA1JsD0mZOyVPJa7JOTVTWrI5hmRNgBDqEAhU1gNCISqTtdq7gtA7HalTQCzT9FRlafhdAmpryIL8smVM6ZOCZhzIUt6vtoJpX0FoACew1FuheD4L0lhEI+ADskrx1DYGbJGNsqeiNVp8gGYEzII1omnTah7LOR13ZU10MsmYVh-BaBaR8jZWydmlXZpzbmvMBZCxFjQMWASk7At8H3MFOQIXaLUXsXQLZhImCxBYFsyKfHYC+bgH5flGC8AAGq9J5AColz9HiksUeCnwVLiZxXuaSqmdx1g008WslFbK0VT25RQPl-zGHmMGWoUV5LLASqhQ49+qx2puCdiYKmLKjHss5aVDVWq+l8jOLqoFaheGKP8HsFoxR1Du0RLSoIIRhK8Q+kkumhjYE0VfCbG894bpFTDic0cmUPaKOKEyqZESqhemRFnV+7VDCdQ8W85VrLY3h1wuRKOpFyJUQrs9d1xKlh7D0JmmovEc34NrHK-Q5hNytnIUq6N+Eq0kAAFSpsMjODNgFfVXM6oBJW1R+qtGaDrbIJgyi7gJCSCi5F40EDNjgfdh6CQzoipCVYeQaibHat4aZlRZnIlMArWKaslx7oPUeiOtaiL1rjue8iV6Jg1OmPehpT6Hj-2gqYD2JC0pBh-RepBLbhXVA7YqUw0pTDa2WAscCrZaiuiaC6bwgFdi7lvEaY9+BT3YFo2AMDEIc5qH8H+EICVWzfCxFnGjkg6P-vwoBmODamNCZY4C1tCA3Y7XXLShKI0thF2Zas5j6GGIWIigEAwugqYQ1An6He4E9j5waABJ9NQSi7hSNSHC9HGP2ZwqxuT+gPCUbuFlGodwAbfFI85DcioZiykVeWlzBJsI1tE9HWOVFItuZLR2qcVYAiYO1ux+0HmTDZHMo5YIdnJAOai25gSf4LAGECAYSCVlKjvzeC8II84FQbB1qJVZBIwDbPQIRJzibsBdZ64RNzBQlY+2RI09eI1CgBj3d1sAvXouRzE-FwbC3etJay85Gw0ELD3vMPUEohh5vDa0w1WT9Rlx3A+m1J4iSAaDuRLsYSPGi56NcvgYkcABRHAw0UhAABaTQDxAcndWQCf7hZTO5wzYUKJFZ05oLyp5UYc1iBQ9HOxaCqIiiBCIY2cU7UpR+Hfllcw7UNAo-3IEpuAORp9w-iETWORmjWDhJUScGbHbbi0FsXiZa6YeRp92aMfYoCY8scJGWI8WcbGQxzn80TSce1sLMOw4OlXC4jN2Jtkvk7HxXFOP0X77Gc4+n3V4kJEIjSadTnXh4wD4AgPrluVMyVxKOkJfw3FrIfTmfzr0sVGg1DHujogruOMebWIUaUgZ5ww4RN4WoGhX4WHSwYSN+snqR8eEdGXzQqz4wawDEt-VqilByNOE+gvs+M1hoaXPfGC-6B1jMEvxNGh-gxCGjEOQlljyvmHXPjRWJpyxI0ZouDn2RMnHxD6Vh0995LeFuml8ncu+03qiCOs+JfW8Jc0oX13bOVvVXuwdwFe2pwrnsoJaxUb1Ux9UvCpoLFBbJnD2mVV94jHXAhBTe3wfEp0q4tgGIvgM+VQywfEMoc+NgreI0OIqyf+JigBIQma2M8OEBaie0-g1QiG1yTY1+omGSWSsYuehGKemCbUW4zk7s0SdwTQW4RQ5gVmxBBEpBgOIwFEYAkgJIEeW+Hqjw9KD+Kmlgz+O0MwbcdKfoVYbwVG7B9qYAt+Ihp0mCnUm4mwq6tkVMqeioZQZQiE7BVaFBpQVBW4NBGIAaUqWwK4W6X0Moe8telC6y2AG+FB9SqwCUTYLYGuuazOfcqI44uMtBc2nWv6BIFBieY4MwK4GUoWOwZQNggmRoueJafC78zobgsEsGMoA0boBQS4FKYRSqkWI+VYnmPgoC3wCsegAMkyLwbgsUB0BgKySqQ2i2hEuebW0ELYpaGglmWW70cy7+RghafGP+qo7hghsmcoHgTRvE2R2sio1hPCsoK4QkKIwk9YYC4QoQQAA */
    id: "phase",
    description:
      "Top-level phase machine that orchestrates the Influence game phases from INIT through REVEAL.",
    context: ({ input }) => ({
      players: input.playerSettings.map((p) => p.agentId),
      diaryRooms: input.playerSettings.reduce(
        (acc, p) => {
          acc[p.agentId] = p.diaryRoomId;
          return acc;
        },
        {} as Record<UUID, UUID>,
      ),
      playersReady: {},
      minPlayers: input.minPlayers,
      maxPlayers: input.maxPlayers,
      startPhase: input.startPhase,
      whisperSettings: input.whisperSettings,
    }),
    initial: "init",
    states: {
      // ─────────────────────────────────────────────────────────────
      // INIT PHASE
      // ─────────────────────────────────────────────────────────────
      init: {
        description:
          "Bootstrap state that waits for players to be ready and routes to the configured starting phase.",
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
            description:
              "If a start phase is explicitly configured as INTRODUCTION, immediately move there once context is ready.",
            guard: ({ context }) => {
              return context.startPhase === Phase.INTRODUCTION;
            },
            target: "introduction_wait",
          },
          {
            description:
              "If a start phase is explicitly configured as LOBBY, immediately wait for the lobby room.",
            guard: ({ context }) => {
              return context.startPhase === Phase.LOBBY;
            },
            target: "lobby_wait",
          },
          {
            description:
              "If a start phase is explicitly configured as WHISPER, immediately enter the whisper phase.",
            guard: ({ context }) => {
              return context.startPhase === Phase.WHISPER;
            },
            target: "whisper",
          },
          {
            description:
              "Default path: once minimum players are present and all are ready, move into the INTRODUCTION phase.",
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
      // ─────────────────────────────────────────────────────────────
      // INTRODUCTION PHASE
      // ─────────────────────────────────────────────────────────────
      // Wait for house to create the introduction room
      introduction_wait: {
        description:
          "Intermediate state that waits for The House to create the public introduction room.",
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
        description:
          "Agents introduce themselves publicly, then immediately transition into diary strategy and end in the lobby.",
        initial: "waiting",
        states: {
          waiting: {
            description:
              "Players are composing their initial introductions in the shared room.",
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
              description:
                "Once every player has posted at least one introduction, move to diary strategy without waiting for the timeout.",
              guard: "allPlayersIntroduced",
              target: "strategy",
            },
          },
          strategy: {
            description:
              "Diary-driven strategy evaluation for the INTRODUCTION phase.",
            on: {
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "introduction-diary",
              src: "diary",
              input: ({ context }) => ({
                players: context.players,
                playerRoomIds: context.diaryRooms,
              }),
              onDone: {
                target: "end",
              },
              onError: {
                target: "end",
              },
            },
          },
          end: {
            description:
              "Terminal internal state for the INTRODUCTION phase, signalling transition to the lobby.",
            type: "final",
          },
        },
        onDone: {
          target: "lobby_wait",
        },
      },
      lobby_wait: {
        description:
          "Waits for The House to create the public lobby room between rounds.",
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
        description:
          "Public lobby where agents can only speak in the shared room before whispers open.",
        initial: "chat",
        states: {
          chat: {
            description:
              "Agents are freely chatting in the public lobby until the round ends or the timer expires.",
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
            description:
              "Diary-driven strategy evaluation for the LOBBY phase before moving into whispers.",
            on: {
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("lobby-diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("lobby-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("lobby-diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "lobby-diary",
              src: "diary",
              input: ({ context }) => ({
                playerRoomIds: context.diaryRooms,
              }),
              onDone: {
                target: "end",
              },
              onError: {
                target: "end",
              },
            },
          },
          end: {
            description:
              "Terminal internal state for the LOBBY phase, signalling transition to WHISPER.",
            type: "final",
          },
        },
        onDone: {
          target: "whisper",
        },
      },
      whisper: {
        description:
          "Turn-based WHISPER phase where agents create private rooms, spend request budget, and then transition to gameplay diaries.",
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
            description:
              "Idle substate that decides whether there are remaining requests; either start picking or advance directly to diary.",
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
            description:
              "Calculates which player should act next or whether to end the WHISPER phase.",
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
            description:
              "Current player is choosing whether to PASS or create a new whisper room.",
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
            description:
              "Timeout handler when a player fails to make a pick in time; forfeits their remaining requests.",
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
            description:
              "A WHISPER room is currently active and accepting a limited number of messages.",
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
            description:
              "After whispers complete, transition into the gameplay diary/strategy machine.",
            on: {
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("whisper-diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("whisper-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("whisper-diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "whisper-diary",
              src: "diary",
              input: ({ context }) => ({
                playerRoomIds: context.diaryRooms,
              }),
              onDone: {
                target: "end",
              },
              onError: {
                target: "end",
              },
            },
          },
          end: {
            description:
              "Terminal internal state for the WHISPER phase, signalling transition to RUMOR.",
            type: "final",
          },
        },
      },
      rumor_wait: {
        description:
          "Waits for The House to create the public rumor room between rounds.",
        on: {
          ["GAME:CREATE_ROOM"]: {
            actions: [
              assign(({ event }) => ({
                rumor: { roomId: event.roomId, messages: {} },
              })),
            ],
          },
        },
      },
      rumor: {
        initial: "waiting",
        description:
          "RUMOR phase where each player must post exactly one public message or image.",
        always: {
          actions: [sendTo("rumor", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.RUMOR,
          }),
        ],
        states: {
          // Follow the same pattern as the INTRODUCTION state. Each player is allowed to post exactly one public message or image.
          waiting: {
            description:
              "Players are composing their public messages or images in the shared room.",
            on: {
              ["GAME:MESSAGE_SENT"]: {
                actions: assign(({ context, event }) => ({
                  rumor: {
                    ...context.rumor!,
                    messages: {
                      ...context.rumor!.messages,
                      [event.playerId]: event.messageId,
                    },
                  },
                })),
              },
            },
            after: {
              [round]: {
                target: "diary",
              },
            },
          },
          diary: {
            description:
              "After rumors are posted, transition into the gameplay diary/strategy machine.",
            on: {
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("rumor-diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("rumor-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("rumor-diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "rumor-diary",
              src: "diary",
              input: ({ context }) => ({
                playerRoomIds: context.diaryRooms,
              }),
              onDone: {
                target: "end",
              },
              onError: {
                target: "end",
              },
            },
          },
          end: {
            description:
              "Terminal internal state for the WHISPER phase, signalling transition to RUMOR.",
            type: "final",
          },
        },
        onDone: {
          target: "vote",
        },
      },
      vote: {
        description:
          "VOTE phase where players empower and expose targets according to the game rules (one vote for each per player).",
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
        description:
          "POWER phase where the empowered agent chooses to auto eliminate, protect and pick a new revealed candidate, or send the vote to council as-is",
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
        description:
          "REVEAL phase that announces the results of the power phase and determines whether the game should continue.",
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
            nextPhase: Phase.COUNCIL,
          }),
          onDone: {
            target: "end",
          },
          onError: {
            target: "end",
          },
        },
      },
      council: {
        description:
          "COUNCIL phase where players vote to eliminate one of the two revealed candidates.",
        always: {
          actions: [sendTo("reveal", ({ event }) => event)],
        },
        entry: [
          emit({
            type: "GAME:PHASE_ENTERED",
            phase: Phase.COUNCIL,
          }),
        ],
        invoke: {
          id: "council",
          src: "gameplay",
          input: ({ context }) => ({
            players: context.players,
            initialPhase: Phase.COUNCIL,
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
      end: {
        description:
          "Top-level terminal state for the phase machine; external caller should decide whether to start a new game.",
        type: "final",
      },
    },
  });
}
