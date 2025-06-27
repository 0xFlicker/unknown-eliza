import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type Plugin,
  type Provider,
  State,
  type UUID,
  asUUID,
  validateUuid,
  elizaLogger,
  EventType,
  MessagePayload,
} from "@elizaos/core";
import { trackConversation } from "./actions/trackConversation";
import type {
  PlayerEntity,
  PlayerRelationship,
  PlayerStatement,
  SocialStrategyState,
} from "./types";
import { conversationTrackingEvaluator } from "./evaluators/conversationTracker";
import { socialContextProvider } from "./providers/socialContext";
import { AddPlayerService } from "./service/addPlayer";

// export const getPlayerInfoHandler = async (
//   runtime: IAgentRuntime,
//   message: Memory,
//   state?: State
// ) => {
//   const socialState = state as SocialStrategyState;

//   const player = socialState.values.players[playerId];
//   if (!player) {
//     return {
//       success: false,
//       message: "Player not found",
//     };
//   }

//   // Get relationships involving this player
//   const relationships = socialState.values.relationships.filter((rel) => {
//     const sourceId = rel.sourceEntityId;
//     const targetId = rel.targetEntityId;
//     return sourceId === playerId || targetId === playerId;
//   });

//   // Get statements about this player
//   const statements = socialState.values.statements.filter((stmt) => {
//     const targetId = stmt.data.targetEntityId;
//     return targetId === playerId;
//   });

//   return {
//     success: true,
//     data: {
//       player,
//       relationships,
//       statements,
//     },
//   };
// };

export type SocialStrategyContext = {
  values: {
    players: PlayerEntity[];
    relationships: PlayerRelationship[];
    statements: PlayerStatement[];
  };
  text: string;
};

export const socialStrategyPlugin: Plugin = {
  // Ensure connections default to conversation when type is undefined
  init: async (_config, runtime) => {
    // const service = runtime.getService(
    //   AddPlayerService.serviceType
    // ) as AddPlayerService;
    // if (!service) {
    //   throw new Error("AddPlayerService not found");
    // }
    // await service.getOrCreatePlayer({ handle: "TestPlayer" });
  },
  name: "social-strategy",
  description:
    "Tracks and manages player relationships and trust scores for social strategy analysis.",
  providers: [socialContextProvider],
  // Update memory with new statements and relationships before replying
  priority: 100,
  // Evaluators that passively listen to the conversation and keep the
  // social graph up-to-date.
  evaluators: [conversationTrackingEvaluator],
  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async ({
        runtime,
        message,
        callback,
        onComplete,
      }: MessagePayload & { onComplete?: () => void }) => {
        message.content.providers = Array.from(
          new Set([
            ...(message.content.providers || []),
            "FACTS",
            "RELATIONSHIPS",
          ]),
        );
      },
    ],
  },
  services: [AddPlayerService],
  // routes: [
  //   {
  //     name: "addPlayer",
  //     path: "/addPlayer",
  //     type: "POST",
  //     public: true,
  //     handler: async (req, res, runtime) => {
  //       const { handle } = req.body;
  //       const service = runtime.getService(
  //         AddPlayerService.serviceType
  //       ) as AddPlayerService;
  //       if (!service) {
  //         throw new Error("AddPlayerService not found");
  //       }
  //       const player = await service.getOrCreatePlayer({ handle });
  //       res.json(player);
  //     },
  //   },
  // ],
  actions: [
    trackConversation,
    // {
    //   name: "getPlayerInfo",
    //   description: "Retrieve information about a specific player",
    //   similes: ["PLAYER_INFO", "LOOKUP_PLAYER", "PLAYER_PROFILE"],
    //   examples: [
    //     [
    //       {
    //         name: "user",
    //         content: { playerId: "player1", text: "Get info for player1" },
    //       },
    //       {
    //         name: "agent",
    //         content: {
    //           text: "Player info for player1: trust 50, neutral relationship.",
    //           actions: ["getPlayerInfo"],
    //         },
    //       },
    //     ],
    //   ],
    //   validate: async (runtime: IAgentRuntime, message: Memory) => {
    //     return (
    //       typeof message.content === "object" &&
    //       message.content !== null &&
    //       "playerId" in message.content &&
    //       typeof message.content.playerId === "string"
    //     );
    //   },
    //   handler: getPlayerInfoHandler,
    // },
  ],
};

export { trackConversation } from "./actions/trackConversation";
export { conversationTrackingEvaluator } from "./evaluators/conversationTracker";
export { socialContextProvider } from "./providers/socialContext";
export * from "./types";

/* promptManager utilities no longer required in this module */
