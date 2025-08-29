import {
  EventHandler,
  EventPayload,
  EventPayloadMap,
  EventType,
  Plugin,
  PluginEvents,
  UUID,
  elizaLogger,
} from "@elizaos/core";
import { ChannelType } from "@elizaos/core";
import { phaseContextProvider, gameContextProvider } from "./providers";
import {
  ignoreHouseAction,
  joinLobbyAction,
  requestStartAction,
  createPrivateRoomAction,
  publicStatementAction,
  empowerVoteAction,
  exposeVoteAction,
  eliminateAction,
  protectAction,
} from "./actions";
import { GameEventHandlers } from "../coordinator/types";
import { CoordinationService } from "../coordinator";
import { Phase } from "@/game/types";
import { recentMessagesProvider } from "./providers/recentMessages";
import { shouldRespondProvider } from "./providers/shouldRespond";
import { replyAction } from "./actions/reply";
import choiceAction from "./actions/choice";
import { actionsProvider } from "./providers/actions";
import choiceProvider from "./providers/choice";
import { entitiesProvider } from "./providers/entities";
import { evaluatorsProvider } from "./providers/evaluators";
import { providersProvider } from "./providers/providers";
import { characterProvider } from "./providers/character";
import {
  channelClearedHandler,
  handleServerSync,
  messageDeletedHandler,
  messageReceivedHandler,
  postGeneratedHandler,
  reactionReceivedHandler,
  syncSingleUser,
} from "./handlers";
import { PlayerStateService } from "./playerStateService";
import { IntroductionDiaryService } from "./services/introductionDiaryService";

const logger = elizaLogger.child({ component: "InfluencerPlugin" });

/**
 * The influencer plugin adds player-side logic for the Influence game.
 * It provides strategic context and guides player behavior through all game phases.
 */
export const influencerPlugin: Plugin = {
  name: "influence-player",
  description: "Player plugin for the Influence social strategy game",
  actions: [
    choiceAction,
    ignoreHouseAction,
    joinLobbyAction,
    requestStartAction,
    createPrivateRoomAction,
    publicStatementAction,
    empowerVoteAction,
    exposeVoteAction,
    eliminateAction,
    protectAction,
    replyAction,
  ],
  providers: [
    actionsProvider,
    choiceProvider,
    characterProvider,
    entitiesProvider,
    evaluatorsProvider,
    providersProvider,
    shouldRespondProvider,
    phaseContextProvider,
    gameContextProvider,
    recentMessagesProvider,
  ],
  services: [PlayerStateService, IntroductionDiaryService],
  init: async (_config, _runtime) => {
    console.log("🎭 Influencer plugin initialized - ready to play the game");
  },
  events: {
    // Coordination handled via internal bus; no MESSAGE_RECEIVED hook needed.
    ["GAME:ARE_YOU_READY"]: [
      async ({ runtime, gameId, roomId, action }) => {
        console.log(
          `🎭 Influencer(${runtime.character?.name}) received GAME:ARE_YOU_READY for game ${gameId} room ${roomId}`,
        );
        const coordinationService = runtime.getService(
          CoordinationService.serviceType,
        ) as CoordinationService;
        if (!coordinationService) {
          logger.warn(
            "CoordinationService not available for ARE_YOU_READY response",
          );
          return;
        }
        console.log(
          `🎭 Influencer(${runtime.character?.name}) sending PLAYER_READY`,
        );
        await coordinationService.sendGameEvent(
          {
            gameId,
            roomId,
            action: { type: "PLAYER_READY", playerId: runtime.agentId },
            timestamp: Date.now(),
            runtime,
            source: "influencer-plugin",
          },
          "others",
        );
      },
    ],
    ["GAME:PHASE_STARTED"]: [
      async ({ runtime, roomId, action }) => {
        const svc = runtime.getService<PlayerStateService>(
          PlayerStateService.serviceType,
        );
        if (!svc) return;
        if (action.phase === Phase.INTRODUCTION) {
          await svc.markIntroductionRequired(roomId);
        }
      },
      async ({ runtime, gameId, roomId, action }) => {
        if (action.phase === Phase.INIT) {
          const coordinationService = runtime.getService(
            CoordinationService.serviceType,
          ) as CoordinationService;
          if (!coordinationService) {
            logger.warn(
              "CoordinationService not available for introduction response",
            );
            return;
          }
          await coordinationService.sendGameEvent(
            {
              gameId,
              roomId,
              action: { type: "PLAYER_READY", playerId: runtime.agentId },
              timestamp: Date.now(),
              runtime,
              source: "influencer-plugin",
            },
            "others",
          );
        }
      },
    ],
    ["GAME:DIARY_PROMPT"]: [
      async ({ runtime, roomId, action }) => {
        const svc = runtime.getService<PlayerStateService>(
          PlayerStateService.serviceType,
        );
        if (!svc) return;
        if (runtime.character?.name === action.targetAgentName) {
          await svc.setDiaryPending(roomId);
        }
      },
    ],
    [EventType.MESSAGE_RECEIVED]: [
      async (payload) => {
        if (!payload.callback) {
          logger.error("No callback provided for message");
          return;
        }
        // If House authored a group message, ensure introduction is required for this round
        try {
          const sender = payload.message.entityId
            ? await payload.runtime.getEntityById(payload.message.entityId)
            : undefined;
          const room = await payload.runtime.getRoom(payload.message.roomId);
          if (sender?.names?.[0] === "House" && room) {
            const svc = payload.runtime.getService<PlayerStateService>(
              PlayerStateService.serviceType,
            );
            if (svc) {
              const flags = svc.getFlags(payload.message.roomId);
              if (!flags.introduced && room.type === ChannelType.GROUP) {
                await svc.markIntroductionRequired(payload.message.roomId);
              }
              // If this House message targets this agent for diary, set diaryPending immediately
              const text = payload.message.content?.text || "";
              const selfMention = `@${payload.runtime.character?.name}`;
              const isDiaryPrompt =
                text.includes(selfMention) || /Diary Question for/i.test(text);
              if (
                (isDiaryPrompt || room.type === ChannelType.DM) &&
                !flags.diaryResponded
              ) {
                await svc.setDiaryPending(payload.message.roomId);
              }
              // Short-circuit introduction via LLM prompt (bypass action chain)
              if (
                flags.mustIntroduce &&
                !flags.introduced &&
                room.type === ChannelType.GROUP
              ) {
                const introSvc =
                  payload.runtime.getService<IntroductionDiaryService>(
                    IntroductionDiaryService.serviceType,
                  );
                const introText = await introSvc?.generateIntroduction(
                  payload.message.roomId,
                );
                await payload.callback({
                  text: (introText || "").toString(),
                  actions: ["REPLY"],
                  source: payload.message.content.source,
                });
                await svc.markIntroduced(payload.message.roomId);
                return;
              }
              // Short-circuit diary via LLM prompt (bypass action chain)
              if (flags.diaryPending && !flags.diaryResponded) {
                const introSvc =
                  payload.runtime.getService<IntroductionDiaryService>(
                    IntroductionDiaryService.serviceType,
                  );
                const diaryText = await introSvc?.generateDiaryResponse(
                  payload.message.roomId,
                  payload.message.content?.text || "",
                );
                await payload.callback({
                  text: (diaryText || "").toString(),
                  actions: ["REPLY"],
                  source: payload.message.content.source,
                });
                await svc.markDiaryResponded(payload.message.roomId);
                return;
              }
            }
          }
        } catch {}
        await messageReceivedHandler({
          runtime: payload.runtime,
          message: payload.message,
          callback: payload.callback,
          onComplete: payload.onComplete,
        });
      },
    ],

    [EventType.VOICE_MESSAGE_RECEIVED]: [
      async (payload) => {
        if (!payload.callback) {
          logger.error("No callback provided for voice message");
          return;
        }
        await messageReceivedHandler({
          runtime: payload.runtime,
          message: payload.message,
          callback: payload.callback,
          onComplete: payload.onComplete,
        });
      },
    ],

    [EventType.REACTION_RECEIVED]: [
      async (payload) => {
        await reactionReceivedHandler({
          runtime: payload.runtime,
          message: payload.message,
        });
      },
    ],

    [EventType.POST_GENERATED]: [
      async (payload) => {
        await postGeneratedHandler(payload);
      },
    ],

    [EventType.MESSAGE_SENT]: [
      async (payload) => {
        // When this runtime sends a message, update introduction/diary flags
        const runtime = payload.runtime;
        const message = payload.message;
        const svc = runtime.getService<PlayerStateService>(
          PlayerStateService.serviceType,
        );
        if (svc && message.entityId === runtime.agentId) {
          await svc.handleOwnMessageSent(message.roomId);
        }
      },
    ],

    [EventType.MESSAGE_DELETED]: [
      async (payload) => {
        await messageDeletedHandler({
          runtime: payload.runtime,
          message: payload.message,
        });
      },
    ],

    [EventType.CHANNEL_CLEARED]: [
      async (
        payload: EventPayload & {
          roomId: UUID;
          channelId: string;
          memoryCount: number;
        },
      ) => {
        await channelClearedHandler({
          runtime: payload.runtime,
          roomId: payload.roomId,
          channelId: payload.channelId,
          memoryCount: payload.memoryCount,
        });
      },
    ],

    [EventType.WORLD_JOINED]: [
      async (payload) => {
        await handleServerSync(payload);
      },
    ],

    [EventType.WORLD_CONNECTED]: [
      async (payload) => {
        await handleServerSync(payload);
      },
    ],

    [EventType.ENTITY_JOINED]: [
      async (payload) => {
        logger.debug(
          `[Bootstrap] ENTITY_JOINED event received for entity ${payload.entityId}`,
        );

        if (!payload.worldId) {
          logger.error("[Bootstrap] No worldId provided for entity joined");
          return;
        }
        if (!payload.roomId) {
          logger.error("[Bootstrap] No roomId provided for entity joined");
          return;
        }
        if (!payload.metadata?.type) {
          logger.error("[Bootstrap] No type provided for entity joined");
          return;
        }

        await syncSingleUser(
          payload.entityId,
          payload.runtime,
          payload.worldId,
          payload.roomId,
          payload.metadata,
          payload.source,
        );
      },
    ],

    [EventType.ENTITY_LEFT]: [
      async (payload) => {
        try {
          // Update entity to inactive
          const entity = await payload.runtime.getEntityById(payload.entityId);
          if (entity) {
            entity.metadata = {
              ...entity.metadata,
              status: "INACTIVE",
              leftAt: Date.now(),
            };
            await payload.runtime.updateEntity(entity);
          }
          logger.info(
            `[Bootstrap] User ${payload.entityId} left world ${payload.worldId}`,
          );
        } catch (error: any) {
          logger.error(
            `[Bootstrap] Error handling user left: ${error.message}`,
          );
        }
      },
    ],
  } as GameEventHandlers,
};
