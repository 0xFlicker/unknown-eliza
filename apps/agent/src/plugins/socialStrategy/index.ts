import {
  type Plugin,
  type IAgentRuntime,
  elizaLogger,
  EventType,
  type MessagePayload,
} from "@elizaos/core";
import { strategicContextProvider } from "./providers/strategicContext";
import { StrategyService } from "./service/strategy";
import { type StrategyPrompts, DEFAULT_STRATEGY_PROMPTS } from "./types";
import { interrogationReplyAction } from "./actions/interrogationReply";
import { strategicReflectionEvaluator } from "./evaluators/strategicReflection";

export const socialStrategyPlugin: Plugin = {
  init: async (config?: Partial<StrategyPrompts>, runtime?: IAgentRuntime) => {
    if (runtime) {
      elizaLogger.info(
        "Initializing Social Strategy Plugin with advanced AI strategy capabilities",
      );
      await StrategyService.start(runtime, config);
      elizaLogger.info("StrategyService started successfully");
    }
  },

  name: "social-strategy",
  description:
    "Advanced AI strategy system for the Influence game with relationship tracking, behavioral analysis, strategic planning, and diary room capabilities.",

  providers: [strategicContextProvider],

  priority: 100,

  evaluators: [strategicReflectionEvaluator],

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
            "STRATEGIC_CONTEXT",
            "PLAYER_INTELLIGENCE",
          ]),
        );
      },
    ],
  },

  services: [StrategyService],

  actions: [interrogationReplyAction],
};

export { StrategyService, DEFAULT_STRATEGY_PROMPTS };
export type { StrategyPrompts };
