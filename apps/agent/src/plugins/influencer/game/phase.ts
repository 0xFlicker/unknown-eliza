import { UUID } from "@elizaos/core";
import { assign, createActor, setup, sendTo } from "xstate";
import type { SnapshotFrom } from "xstate";
import { Phase } from "./types";
import { createPlayerDiaryMachine } from "./rooms/diary";

export type PlayerPhaseEvent =
  | { type: "GAME:PHASE_ENTERED"; phase: Phase; roomId?: UUID }
  | { type: "GAME:DIARY_PROMPT"; roomId: UUID; messageId: UUID }
  | { type: "GAME:MESSAGE_SENT"; playerId: UUID; messageId: UUID; roomId: UUID }
  | { type: "GAME:AGENT_ENTERED"; playerId: UUID; roomId: UUID }
  | { type: "GAME:AGENT_LEFT"; playerId: UUID; roomId: UUID }
  | { type: "GAME:ARE_YOU_READY" }
  | { type: "GAME:PLAYER_READY"; playerId: UUID }
  | { type: "GAME:DIARY_PROMPT_TIMEOUT" }
  | { type: "GAME:DIARY_RESPONSE_TIMEOUT" }
  | { type: "GAME:DIARY_READY_TIMEOUT" }
  | { type: "PLAYER:FORCE_CONTINUE" }
  | {
      type: "GAME:DIARY_RESPONSE";
      playerId: UUID;
      roomId: UUID;
      messageId: UUID;
    };

export interface PlayerIdentity {
  id: UUID;
  name?: string;
}

export interface KnownPlayer extends PlayerIdentity {
  firstSeenAt: number;
  lastSeenAt: number;
  roomsSeenIn: UUID[];
}

export interface PhaseInput {
  self: PlayerIdentity;
  initialPhase?: Phase;
  initialKnownPlayers?: Record<UUID, KnownPlayer>;
  getNow?: () => number;
}

export interface PlayerPhaseContext {
  self: PlayerIdentity;
  currentPhase: Phase;
  phaseEnteredAt: number;
  knownPlayers: Record<UUID, KnownPlayer>;
  introduction: {
    roomId?: UUID;
    players: UUID[];
    seenIntroductions: Record<UUID, UUID>;
    myIntroductionId?: UUID;
  };
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
  getNow: () => number;
}

export function createPlayerPhaseMachine({
  roundTimeoutMs,
  diaryTimeoutMs,
}: {
  roundTimeoutMs: number;
  diaryTimeoutMs: number;
}) {
  return setup({
    types: {
      context: {} as PlayerPhaseContext,
      input: {} as PhaseInput,
      events: {} as PlayerPhaseEvent,
    },
    actors: {
      introductionDiary: createPlayerDiaryMachine(),
    },
    guards: {
      allIntroductionsComplete: ({ context }) => {
        const players = context.introduction.players;
        if (players.length === 0) return false;
        return players.every(
          (playerId) =>
            context.introduction.seenIntroductions[playerId] !== undefined,
        );
      },
    },
  }).createMachine({
    id: "player-phase",
    context: ({ input }) => ({
      self: input.self,
      knownPlayers: input.initialKnownPlayers ?? {},
      phaseEnteredAt: input.getNow ? input.getNow() : Date.now(),
      currentPhase: input.initialPhase ?? Phase.INIT,
      roundTimeoutMs,
      diaryTimeoutMs,
      getNow: input.getNow ?? (() => Date.now()),
      introduction: {
        players: uniqueAppend(
          Object.keys(input.initialKnownPlayers ?? {}) as UUID[],
          input.self.id,
        ),
        seenIntroductions: {},
      },
    }),
    initial: "idle",
    states: {
      idle: {
        on: {
          ["GAME:PHASE_ENTERED"]: {
            guard: ({ event }) => event.phase === Phase.INTRODUCTION,
            target: "introduction",
            actions: assign(({ context, event }) => ({
              currentPhase: event.phase,
              phaseEnteredAt: context.getNow(),
              introduction: {
                ...context.introduction,
                roomId: event.roomId ?? context.introduction.roomId,
              },
            })),
          },
        },
      },
      introduction: {
        initial: "collecting",
        states: {
          collecting: {
            on: {
              ["GAME:AGENT_ENTERED"]: {
                actions: assign(({ context, event }) => ({
                  introduction: {
                    ...context.introduction,
                    roomId: event.roomId ?? context.introduction.roomId,
                    players: uniqueAppend(
                      context.introduction.players,
                      event.playerId,
                    ),
                  },
                  knownPlayers: touchKnownPlayer(
                    context.knownPlayers,
                    event.playerId,
                    context.getNow,
                    event.roomId,
                  ),
                })),
              },
              ["GAME:MESSAGE_SENT"]: {
                guard: ({ context, event }) =>
                  !context.introduction.roomId ||
                  context.introduction.roomId === event.roomId,
                actions: assign(({ context, event }) => {
                  const introduction = context.introduction;
                  const seenIntroductions = {
                    ...introduction.seenIntroductions,
                    [event.playerId]: event.messageId,
                  };
                  return {
                    introduction: {
                      ...introduction,
                      roomId: introduction.roomId ?? event.roomId,
                      seenIntroductions,
                      myIntroductionId:
                        event.playerId === context.self.id
                          ? event.messageId
                          : introduction.myIntroductionId,
                      players: uniqueAppend(
                        introduction.players,
                        event.playerId,
                      ),
                    },
                    knownPlayers: touchKnownPlayer(
                      context.knownPlayers,
                      event.playerId,
                      context.getNow,
                      event.roomId,
                    ),
                  };
                }),
              },
              ["GAME:AGENT_LEFT"]: {
                actions: assign(({ context, event }) => ({
                  knownPlayers: touchKnownPlayer(
                    context.knownPlayers,
                    event.playerId,
                    context.getNow,
                    event.roomId,
                  ),
                })),
              },
            },
            always: {
              guard: "allIntroductionsComplete",
              target: "diary",
            },
            after: {
              [roundTimeoutMs]: { target: "diary" },
            },
          },
          diary: {
            on: {
              ["GAME:DIARY_PROMPT"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_PROMPT_TIMEOUT"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_RESPONSE"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_RESPONSE_TIMEOUT"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:DIARY_READY_TIMEOUT"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:ARE_YOU_READY"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["GAME:PLAYER_READY"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
              ["PLAYER:FORCE_CONTINUE"]: {
                actions: [sendTo("introduction-diary", ({ event }) => event)],
              },
            },
            invoke: {
              id: "introduction-diary",
              src: "introductionDiary",
              input: ({ context }) => ({
                playerId: context.self.id,
                roomId: context.introduction.roomId ?? context.self.id,
              }),
              onDone: {
                target: "complete",
              },
              onError: {
                target: "complete",
              },
            },
          },
          complete: {
            type: "final",
          },
        },
        onDone: {
          target: "complete",
        },
      },
      complete: { type: "final" },
    },
  });
}

export function createPlayerPhaseActor(
  input: PhaseInput,
  {
    roundTimeoutMs,
    diaryTimeoutMs,
  }: { roundTimeoutMs: number; diaryTimeoutMs: number },
) {
  const machine = createPlayerPhaseMachine({ roundTimeoutMs, diaryTimeoutMs });
  return createActor(machine, { input });
}

export type PlayerPhaseSnapshot = SnapshotFrom<
  ReturnType<typeof createPlayerPhaseMachine>
>;

function uniqueAppend(list: UUID[], value: UUID): UUID[] {
  if (list.includes(value)) return list;
  return [...list, value];
}

function touchKnownPlayer(
  known: Record<UUID, KnownPlayer>,
  playerId: UUID,
  getNow: () => number,
  roomId?: UUID,
): Record<UUID, KnownPlayer> {
  if (!playerId) return known;
  const timestamp = getNow();
  const previous = known[playerId];
  const rooms = roomId
    ? uniqueAppend(previous?.roomsSeenIn ?? [], roomId)
    : (previous?.roomsSeenIn ?? []);
  const updated: KnownPlayer = previous
    ? {
        ...previous,
        lastSeenAt: timestamp,
        roomsSeenIn: rooms,
      }
    : {
        id: playerId,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        roomsSeenIn: rooms,
      };
  return {
    ...known,
    [playerId]: updated,
  };
}
