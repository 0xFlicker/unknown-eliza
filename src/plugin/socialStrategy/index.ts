import {
  type Plugin,
  type Action,
  type IAgentRuntime,
  type Memory,
  type Content,
  MemoryType,
  ModelType,
  type GenerateTextParams,
} from "@elizaos/core";
import { z } from "zod";
import { trackConversation } from "./actions/trackConversation";
import { type SocialStrategyState } from "./types";
import {
  MODEL_TAGS,
  type ModelWorkload,
  analyzePrompt,
  SocialStrategyPromptBuilder,
} from "./promptManager";

// Model configurations for different workloads
export const MODEL_CONFIGS: Record<
  ModelWorkload,
  {
    temperature: number;
    frequencyPenalty: number;
    presencePenalty: number;
    maxTokens: number;
  }
> = {
  // Quick sentiment analysis and basic relationship updates
  QUICK_ANALYSIS: {
    temperature: 0.3,
    frequencyPenalty: 0.3,
    presencePenalty: 0.3,
    maxTokens: 256,
  },
  // Detailed relationship analysis and trust scoring
  RELATIONSHIP_ANALYSIS: {
    temperature: 0.5,
    frequencyPenalty: 0.5,
    presencePenalty: 0.5,
    maxTokens: 512,
  },
  // Complex social strategy planning and prediction
  STRATEGY_PLANNING: {
    temperature: 0.7,
    frequencyPenalty: 0.7,
    presencePenalty: 0.7,
    maxTokens: 1024,
  },
  // Creative social manipulation and deception detection
  CREATIVE_ANALYSIS: {
    temperature: 0.9,
    frequencyPenalty: 0.9,
    presencePenalty: 0.9,
    maxTokens: 2048,
  },
};

export const socialStrategyPlugin: Plugin = {
  name: "social-strategy",
  description:
    "Tracks and manages player relationships and trust scores for social strategy analysis",

  models: {
    [ModelType.TEXT_SMALL]: async (
      runtime: IAgentRuntime,
      params: GenerateTextParams
    ) => {
      // Use quick analysis config for small text tasks
      const config = MODEL_CONFIGS.QUICK_ANALYSIS;
      return runtime.useModel(ModelType.TEXT_SMALL, {
        ...params,
        ...config,
      });
    },
    [ModelType.TEXT_LARGE]: async (
      runtime: IAgentRuntime,
      params: GenerateTextParams
    ) => {
      // Analyze the prompt to determine the workload
      const analysis = analyzePrompt(params.prompt);

      // Get the appropriate config for the workload
      // If QUICK_ANALYSIS tag is present, use QUICK_ANALYSIS config regardless of other tags
      const config =
        analysis.workload === "QUICK_ANALYSIS"
          ? MODEL_CONFIGS.QUICK_ANALYSIS
          : MODEL_CONFIGS[analysis.workload];

      // Create a new prompt with the sanitized content
      const newParams = {
        ...params,
        prompt: analysis.sanitizedPrompt,
        ...config,
      };

      return runtime.useModel(ModelType.TEXT_LARGE, newParams);
    },
  },

  providers: [
    {
      name: "social-strategy-state",
      description: "Provides the current social strategy state",
      get: async (runtime, message, state) => {
        // Get the social strategy memory
        const memories = await runtime.getMemoriesByIds([
          `${runtime.agentId}:social-strategy`,
        ]);

        const socialStrategyMemory = memories.find(
          (memory) => memory.metadata?.type === MemoryType.CUSTOM
        );

        if (!socialStrategyMemory) {
          return { text: "" };
        }

        // Parse the state from the memory content
        const socialState = JSON.parse(
          socialStrategyMemory.content.text
        ) as SocialStrategyState;

        return {
          text: "", // No text needed for this provider
          data: { socialStrategyState: socialState }, // Make state available to actions
        };
      },
    },
  ],

  actions: [
    trackConversation,
    {
      name: "getPlayerInfo",
      description: "Retrieve information about a specific player",
      similes: ["PLAYER_INFO", "LOOKUP_PLAYER", "PLAYER_PROFILE"],
      examples: [
        [
          {
            name: "user",
            content: { playerId: "player1", text: "Get info for player1" },
          },
          {
            name: "agent",
            content: {
              text: "Player info for player1: trust 50, neutral relationship.",
              actions: ["getPlayerInfo"],
            },
          },
        ],
      ],
      validate: async (runtime: IAgentRuntime, message: Memory) => {
        return (
          typeof message.content === "object" &&
          message.content !== null &&
          "playerId" in message.content &&
          typeof message.content.playerId === "string"
        );
      },
      handler: async (runtime: IAgentRuntime, message: Memory, state) => {
        const socialState = state as SocialStrategyState;
        const { playerId } = message.content as { playerId: string };

        const player = socialState.players[playerId];
        if (!player) {
          return {
            success: false,
            message: "Player not found",
          };
        }

        // Get relationships involving this player
        const relationships = socialState.relationships.filter(
          (rel) =>
            rel.sourcePlayerId === playerId || rel.targetPlayerId === playerId
        );

        // Get statements about this player
        const statements = socialState.statements.filter(
          (stmt) => stmt.targetId === playerId
        );

        return {
          success: true,
          data: {
            player,
            relationships,
            statements,
          },
        };
      },
    },
  ],

  routes: [
    {
      path: "/social-strategy",
      type: "GET",
      handler: async (req, res, runtime) => {
        // Get the social strategy memory
        const memories = await runtime.getMemoriesByIds([
          `${runtime.agentId}:social-strategy`,
        ]);

        const socialStrategyMemory = memories.find(
          (memory) => memory.metadata?.type === MemoryType.CUSTOM
        );

        if (!socialStrategyMemory) {
          return res.json({
            players: {},
            relationships: [],
            statements: [],
          });
        }

        // Parse the state from the memory content
        const socialState = JSON.parse(
          socialStrategyMemory.content.text
        ) as SocialStrategyState;

        return res.json(socialState);
      },
    },
  ],
};
