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

// Import new strategic components
import { StrategyService } from "./service/addPlayer";

// Import evaluators
import { conversationTrackingEvaluator } from "./evaluators/conversationTracker";
import { strategicRelationshipEvaluator } from "./evaluators/strategicRelationshipExtractor";
import { strategicReflectionEvaluator } from "./evaluators/strategicReflection";

// Import providers
import { strategicContextProvider } from "./providers/strategicContext";
import { playerIntelligenceProvider } from "./providers/playerIntelligence";

// Import actions
import { diaryRoomAction } from "./actions/diaryRoom";
import { strategyReviewAction } from "./actions/strategyReview";

// Import types
import type { StrategyPrompts, DEFAULT_STRATEGY_PROMPTS } from "./types";

export const socialStrategyPlugin: Plugin = {
  init: async (config?: Partial<StrategyPrompts>, runtime?: IAgentRuntime) => {
    if (runtime) {
      elizaLogger.info(
        "Initializing Social Strategy Plugin with advanced AI strategy capabilities",
      );

      // Start the strategy service with custom configuration
      const strategyService = await StrategyService.start(runtime, config);
      elizaLogger.info("StrategyService started successfully");
    }
  },

  name: "social-strategy",
  description:
    "Advanced AI strategy system for the Influence game with relationship tracking, behavioral analysis, strategic planning, and diary room capabilities.",

  providers: [
    strategicContextProvider, // Strategic context
    playerIntelligenceProvider, // Player intelligence reports
  ],

  priority: 100,

  evaluators: [
    conversationTrackingEvaluator, // Enhanced conversation tracking
    strategicRelationshipEvaluator, // Strategic relationship extraction
    strategicReflectionEvaluator, // Diary room reflections
  ],

  events: {
    [EventType.MESSAGE_RECEIVED]: [
      async ({
        runtime,
        message,
        callback,
        onComplete,
      }: MessagePayload & { onComplete?: () => void }) => {
        // Ensure strategic providers are available
        message.content.providers = Array.from(
          new Set([
            ...(message.content.providers || []),
            "STRATEGIC_CONTEXT",
            "PLAYER_INTELLIGENCE",
            "FACTS",
            "RELATIONSHIPS",
          ]),
        );
      },
    ],
  },

  services: [StrategyService],

  actions: [
    diaryRoomAction, // Private strategic reflection
    strategyReviewAction, // Strategic analysis and planning
  ],

  routes: [
    {
      name: "strategy-dashboard",
      path: "/strategy",
      type: "GET",
      public: true,
      handler: async (req, res, runtime) => {
        try {
          const strategyService = runtime.getService(
            "social-strategy",
          ) as StrategyService;
          if (!strategyService) {
            res.status(503).json({ error: "Strategy service not available" });
            return;
          }

          const state = strategyService.getState();
          const dashboard = {
            phase: state.currentPhase,
            round: state.round,
            strategicMode: state.strategicMode,
            relationships: Object.fromEntries(state.relationships),
            analysis: state.analysis,
            diaryEntries: state.diaryEntries.slice(-10), // Last 10 entries
            playerPatterns: Object.fromEntries(state.playerPatterns),
          };

          res.json(dashboard);
        } catch (error) {
          elizaLogger.error("Error serving strategy dashboard:", error);
          res.status(500).json({ error: "Internal server error" });
        }
      },
    },
    {
      name: "strategy-config",
      path: "/strategy/config",
      type: "POST",
      public: true,
      handler: async (req, res, runtime) => {
        try {
          const strategyService = runtime.getService(
            "social-strategy",
          ) as StrategyService;
          if (!strategyService) {
            res.status(503).json({ error: "Strategy service not available" });
            return;
          }

          const config = req.body as Partial<StrategyPrompts>;
          await strategyService.updateConfiguration(config);

          res.json({
            success: true,
            message: "Strategy configuration updated",
          });
        } catch (error) {
          elizaLogger.error("Error updating strategy config:", error);
          res.status(500).json({ error: "Failed to update configuration" });
        }
      },
    },
  ],
};

// Export all components for external use
export { StrategyService };
export { diaryRoomAction } from "./actions/diaryRoom";
export { strategyReviewAction } from "./actions/strategyReview";
export { conversationTrackingEvaluator } from "./evaluators/conversationTracker";
export { strategicRelationshipEvaluator } from "./evaluators/strategicRelationshipExtractor";
export { strategicReflectionEvaluator } from "./evaluators/strategicReflection";
export { strategicContextProvider } from "./providers/strategicContext";
export { playerIntelligenceProvider } from "./providers/playerIntelligence";
export * from "./types";

// Legacy compatibility exports
export const AddPlayerService = StrategyService;
