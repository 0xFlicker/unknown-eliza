import { UUID } from "@elizaos/core";
import { assign, createActor, emit, setup } from "xstate";
import type { SnapshotFrom } from "xstate";
import {
  DiaryPromptState,
  KnownPlayer,
  Phase,
  PhaseInput,
  PlayerPhaseContext,
} from "./types";

/**
 * Internal context adds a clock helper so we can generate deterministic
 * timestamps during tests while defaulting to Date.now() in production.
 */
interface InternalPhaseContext extends PlayerPhaseContext {
  getNow: () => number;
}

/**
 * Events that influence a single player's perception of the game.
 *
 * These only include information that a player would directly observe via
 * coordinator events or their own actions. Anything requiring omniscient
 * awareness remains in the House implementation.
 */
export type PlayerPhaseEvent =
  | {
      type: "GAME:PHASE_ENTERED";
      phase: Phase;
      roomId?: UUID;
      timestamp?: number;
    }
  | {
      type: "GAME:DIARY_PROMPT";
      roomId: UUID;
      targetAgentId?: UUID;
      targetAgentName?: string;
      promptMessageId?: UUID;
      phase?: Phase;
      timestamp?: number;
    }
  | {
      type: "PLAYER:DIARY_RESPONSE_SENT";
      playerId: UUID;
      roomId: UUID;
      messageId?: UUID;
      timestamp?: number;
    }
  | {
      type: "PLAYER:SEEN";
      playerId: UUID;
      name?: string;
      roomId: UUID;
      introductionMessageId?: UUID;
      timestamp?: number;
    };

/**
 * Emitted signals from the player-phase machine. These can drive higher-level
 * services such as PlayerStateService without giving them direct access to the
 * machine internals.
 */
export type PlayerPhaseEmitted =
  | {
      type: "PLAYER:PHASE_UPDATED";
      phase: Phase;
      roomId?: UUID;
      timestamp: number;
    }
  | {
      type: "PLAYER:INTRO_REQUIRED";
      roomId?: UUID;
      timestamp: number;
    }
  | {
      type: "PLAYER:INTRO_COMPLETED";
      roomId?: UUID;
      messageId?: UUID;
      timestamp: number;
    }
  | {
      type: "PLAYER:DIARY_PROMPT";
      prompt: DiaryPromptState;
    }
  | {
      type: "PLAYER:DIARY_COMPLETED";
      roomId: UUID;
      timestamp: number;
    }
  | {
      type: "PLAYER:KNOWN_PLAYER_SEEN";
      player: KnownPlayer;
    };

function normaliseName(name?: string): string | undefined {
  return name?.trim().toLowerCase();
}

/**
 * Builds an influencer-focused view of the game state. Only player-observable
 * events influence the context.
 */
export function createPlayerPhaseMachine() {
  return setup({
    types: {
      context: {} as InternalPhaseContext,
      events: {} as PlayerPhaseEvent,
      input: {} as PhaseInput,
      emitted: {} as PlayerPhaseEmitted,
    },
    actions: {
      notifyDiaryCompleted(args) {
        if (args.event.type !== "PLAYER:DIARY_RESPONSE_SENT") return;
        const responseEvent = args.event;
        const prompt = args.context.diaryPrompts[responseEvent.roomId];
        const timestamp =
          prompt?.respondedAt ??
          responseEvent.timestamp ??
          args.context.getNow();
        emit({
          type: "PLAYER:DIARY_COMPLETED",
          roomId: responseEvent.roomId,
          timestamp,
        });
      },
      notifyDiaryPrompt(args) {
        if (args.event.type !== "GAME:DIARY_PROMPT") return;
        const promptEvent = args.event;
        const prompt = args.context.diaryPrompts[promptEvent.roomId];
        if (prompt) {
          emit({ type: "PLAYER:DIARY_PROMPT", prompt });
        }
      },
      notifyKnownPlayerSeen(args) {
        if (args.event.type !== "PLAYER:SEEN") return;
        const seen = args.event;
        const player = args.context.knownPlayers[seen.playerId];
        if (player) {
          emit({
            type: "PLAYER:KNOWN_PLAYER_SEEN",
            player,
          });
        }
      },
      markDiaryResponse: assign({
        diaryPrompts: ({ context, event }) => {
          if (event.type !== "PLAYER:DIARY_RESPONSE_SENT") {
            return context.diaryPrompts;
          }
          const existing = context.diaryPrompts[event.roomId];
          if (!existing) {
            return context.diaryPrompts;
          }
          const timestamp = event.timestamp ?? context.getNow();
          return {
            ...context.diaryPrompts,
            [event.roomId]: {
              ...existing,
              respondedAt: timestamp,
            },
          };
        },
      }),
      // recordIntroduction: assign({
      //   introduction: ({ context, event }) => {
      //     if (event.type !== "PLAYER:INTRODUCTION_SENT") {
      //       return context.introduction;
      //     }
      //     const timestamp = event.timestamp ?? context.getNow();
      //     return {
      //       ...context.introduction,
      //       required: false,
      //       roomId: event.roomId ?? context.introduction.roomId,
      //       messageId: event.messageId ?? context.introduction.messageId,
      //       completedAt: timestamp,
      //     };
      //   },
      // }),
      recordKnownPlayer: assign({
        knownPlayers: ({ context, event }) => {
          if (
            event.type !== "PLAYER:SEEN" ||
            event.playerId === context.self.id
          ) {
            return context.knownPlayers;
          }
          const now = event.timestamp ?? context.getNow();
          const existing = context.knownPlayers[event.playerId];
          const rooms = new Set(existing?.roomsSeenIn ?? []);
          rooms.add(event.roomId);
          return {
            ...context.knownPlayers,
            [event.playerId]: {
              id: event.playerId,
              name: event.name ?? existing?.name,
              firstSeenAt: existing?.firstSeenAt ?? now,
              lastSeenAt: now,
              roomsSeenIn: Array.from(rooms),
            },
          };
        },
      }),
      updatePhaseContext: assign({
        currentPhase: ({ context, event }) =>
          event.type === "GAME:PHASE_ENTERED"
            ? event.phase
            : context.currentPhase,
        currentPhaseRoomId: ({ context, event }) =>
          event.type === "GAME:PHASE_ENTERED"
            ? event.roomId
            : context.currentPhaseRoomId,
        phaseEnteredAt: ({ context, event }) =>
          event.type === "GAME:PHASE_ENTERED"
            ? (event.timestamp ?? context.getNow())
            : context.phaseEnteredAt,
        // introduction: ({ context, event }) => {
        //   if (event.type !== "GAME:PHASE_ENTERED") {
        //     return context.introduction;
        //   }
        //   const timestamp = event.timestamp ?? context.getNow();
        //   if (event.phase === Phase.INTRODUCTION) {
        //     return {
        //       ...context.introduction,
        //       required: !context.introduction.completedAt,
        //       roomId: event.roomId ?? context.introduction.roomId,
        //       promptedAt: context.introduction.promptedAt ?? timestamp,
        //     };
        //   }
        //   return {
        //     ...context.introduction,
        //     required: false,
        //   };
        // },
      }),
      recordDiaryPrompt: assign({
        diaryPrompts: ({ context, event }) => {
          if (event.type !== "GAME:DIARY_PROMPT") {
            return context.diaryPrompts;
          }
          const timestamp = event.timestamp ?? context.getNow();
          return {
            ...context.diaryPrompts,
            [event.roomId]: {
              roomId: event.roomId,
              promptAt: timestamp,
              promptMessageId: event.promptMessageId,
              respondedAt: undefined,
              phase: event.phase ?? context.currentPhase,
            },
          };
        },
      }),
    },
    guards: {
      isPromptForSelf: ({ context, event }) => {
        if (event.type !== "GAME:DIARY_PROMPT") return false;
        if (event.targetAgentId) {
          return event.targetAgentId === context.self.id;
        }
        const targetName = normaliseName(event.targetAgentName);
        const selfName = normaliseName(context.self.name);
        if (!targetName || !selfName) return false;
        return targetName === selfName;
      },
      isSelfActor: ({ context, event }) => {
        if (event.type === "PLAYER:DIARY_RESPONSE_SENT") {
          return event.playerId === context.self.id;
        }
        return false;
      },
      isOtherPlayerSeen: ({ context, event }) => {
        return (
          event.type === "PLAYER:SEEN" && event.playerId !== context.self.id
        );
      },
      // willRequireIntroduction: ({ context, event }) => {
      //   const result =
      //     event.type === "GAME:PHASE_ENTERED" &&
      //     event.phase === Phase.INTRODUCTION; //&&
      //   // !context.introduction.completedAt;
      //   return result;
      // },
      hasRecordedDiaryPrompt: ({ context, event }) => {
        if (event.type !== "PLAYER:DIARY_RESPONSE_SENT") return false;
        if (event.playerId !== context.self.id) return false;
        return !!context.diaryPrompts[event.roomId];
      },
    },
  }).createMachine({
    id: "influencer-player-phase",
    context: ({ input }) => {
      const getNow = input.getNow ?? (() => Date.now());
      const now = getNow();
      const knownPlayers: Record<UUID, KnownPlayer> = {};
      for (const player of input.initialKnownPlayers ?? []) {
        knownPlayers[player.id] = {
          ...player,
          roomsSeenIn: [...player.roomsSeenIn],
        };
      }
      return {
        self: input.self,
        currentPhase: input.initialPhase ?? Phase.INIT,
        phaseEnteredAt: now,
        currentPhaseRoomId: undefined,
        knownPlayers,
        // introduction: {
        //   required: (input.initialPhase ?? Phase.INIT) === Phase.INTRODUCTION,
        //   roomId: undefined,
        //   promptedAt:
        //     (input.initialPhase ?? Phase.INIT) === Phase.INTRODUCTION
        //       ? now
        //       : undefined,
        //   messageId: undefined,
        //   completedAt: undefined,
        // },
        diaryPrompts: {},
        getNow,
      } satisfies InternalPhaseContext;
    },
    initial: "observing",
    states: {
      observing: {
        on: {
          ["PLAYER:SEEN"]: [
            {
              guard: "isOtherPlayerSeen",
              actions: ["recordKnownPlayer", "notifyKnownPlayerSeen"],
            },
            {
              actions: ["recordKnownPlayer"],
            },
          ],
          ["GAME:PHASE_ENTERED"]: [
            {
              description: "Update phase and notify",
              actions: [
                "updatePhaseContext",
                emit(({ context }) => ({
                  type: "PLAYER:PHASE_UPDATED",
                  phase: context.currentPhase,
                  roomId: context.currentPhaseRoomId,
                  timestamp: context.phaseEnteredAt,
                })),
              ],
            },
          ],
          ["GAME:DIARY_PROMPT"]: {
            guard: "isPromptForSelf",
            actions: ["recordDiaryPrompt", "notifyDiaryPrompt"],
          },
          ["PLAYER:DIARY_RESPONSE_SENT"]: [
            {
              guard: "hasRecordedDiaryPrompt",
              actions: ["markDiaryResponse", "notifyDiaryCompleted"],
            },
            {
              guard: "isSelfActor",
              actions: ["markDiaryResponse"],
            },
          ],
        },
      },
    },
  });
}

export function createPlayerPhaseActor(input: PhaseInput) {
  const machine = createPlayerPhaseMachine();

  return createActor(machine, {
    input,
  });
}

export type PlayerPhaseSnapshot = SnapshotFrom<
  ReturnType<typeof createPlayerPhaseMachine>
>;
