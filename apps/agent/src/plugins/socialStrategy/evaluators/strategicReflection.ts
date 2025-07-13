import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  ModelType,
  composePrompt,
  type UUID,
} from "@elizaos/core";
import { StrategyService } from "../service/strategy";
import { TrustLevel } from "../types";

const logger = elizaLogger.child({ component: "StrategicReflectionEvaluator" });

// Combined interface from strategicReflection and strategyReview
interface StrategicReviewOutput {
  overallAssessment: string;
  emotionalState:
    | "confident"
    | "nervous"
    | "suspicious"
    | "optimistic"
    | "defeated";
  threatLevel: "low" | "medium" | "high" | "critical";
  recommendedActions: string[];
  allianceChanges: {
    strengthen: string[];
    abandon: string[];
    pursue: string[];
  };
  priorityTargets: string[];
  confidenceLevel: number; // 0-1
  strategyShift?: string;
}

// Using the more comprehensive template from the old strategyReview action
const strategicReviewTemplate = `You are {{agentName}}, conducting a comprehensive strategic review for the Influence game. Analyze your current position and adapt your strategy.

# Current Game State
{{gameState}}

# Relationship Analysis
{{relationships}}

# Recent Intelligence
{{recentIntelligence}}

# Your Task
Conduct a thorough strategic review considering:
1.  Overall threat assessment and survival probability.
2.  Your emotional state and confidence.
3.  Alliance evaluation - who to strengthen, abandon, or pursue.
4.  Priority targets for elimination or protection.
5.  Strategic shifts required based on new information.
6.  Immediate tactical actions to implement.

Be ruthlessly strategic. This is about survival and victory.

Respond with your strategic analysis in this JSON format:
{
  "overallAssessment": "Comprehensive analysis of current strategic position.",
  "emotionalState": "confident|nervous|suspicious|optimistic|defeated",
  "threatLevel": "low|medium|high|critical",
  "recommendedActions": ["Immediate tactical action 1", "Next move 2"],
  "allianceChanges": {
    "strengthen": ["ally name 1"],
    "abandon": ["unreliable ally name"],
    "pursue": ["potential new ally name"]
  },
  "priorityTargets": ["elimination target 1", "protection priority 1"],
  "confidenceLevel": 0.75,
  "strategicShift": "Optional description of major strategy changes needed."
}`;

export const strategicReflectionEvaluator: Evaluator = {
  name: "STRATEGIC_REFLECTION",
  description:
    "Periodically generates private strategic reviews and diary entries for game analysis.",
  similes: ["STRATEGIC_REVIEW", "INTERNAL_MONOLOGUE", "GAME_ANALYSIS"],

  examples: [],

  // This should trigger based on game events or after a certain number of messages, not on a specific text match.
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    const strategyService = runtime.getService(
      "social-strategy",
    ) as StrategyService;
    if (!strategyService) return false;

    // Example trigger: run reflection every 10 messages in a room, or on phase change.
    // This logic would be more robust with a proper event system.
    const strategyState = strategyService.getState();
    const now = Date.now();
    // run reflection if last one was more than 5 minutes ago
    if (now - strategyState.lastStrategyReview > 1000 * 60 * 5) {
      return true;
    }

    return false;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<void> => {
    try {
      const strategyService = runtime.getService(
        "social-strategy",
      ) as StrategyService;
      if (!strategyService) {
        logger.warn("[StrategicReflection] StrategyService not available");
        return;
      }

      const strategyState = strategyService.getState();
      const agentEntity = await runtime.getEntityById(runtime.agentId);
      const agentName = agentEntity?.names[0] || "Agent";

      const entities = await runtime.getEntitiesForRoom(message.roomId);
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: "messages",
        count: 20,
      });

      // Build context for the review prompt
      const gameState = `Phase: ${strategyState.currentPhase}, Round: ${strategyState.round}`;
      const relationships = Array.from(strategyState.relationships.values())
        .map((r) => `${r.playerName}: ${r.trustLevel}`)
        .join(", ");
      const recentIntelligence = recentMessages
        .map((m) => m.content.text)
        .join("\n");

      const prompt = composePrompt({
        template: strategicReviewTemplate,
        state: {
          agentName,
          gameState,
          relationships,
          recentIntelligence,
        },
      });

      // Generate strategic review
      const review = (await runtime.useModel(ModelType.OBJECT_LARGE, {
        prompt,
      })) as StrategicReviewOutput;

      if (!review || !review.overallAssessment) {
        logger.warn("[StrategicReflection] Failed to generate strategy review");
        return;
      }

      // Update strategic relationships based on review
      await updateRelationshipsFromReview(review, strategyService, entities);

      // Update strategic analysis in the service
      strategyService.updateAnalysis({
        confidenceLevel: review.confidenceLevel,
        nextMoves: review.recommendedActions,
        threats: (await getPlayerIds(
          review.priorityTargets,
          entities,
        )) as UUID[],
        allies: (await getPlayerIds(
          review.allianceChanges.strengthen,
          entities,
        )) as UUID[],
      });

      // Create diary entry from review
      await strategyService.addDiaryEntry({
        round: strategyState.round,
        phase: strategyState.currentPhase,
        thoughts: review.overallAssessment,
        observations: review.recommendedActions,
        strategyShift: review.strategyShift,
        emotionalState: review.emotionalState,
        concerns: review.priorityTargets,
        opportunities: review.allianceChanges.pursue,
      });

      strategyService.getState().lastStrategyReview = Date.now();

      logger.info("[StrategicReflection] Completed strategic review.", {
        threatLevel: review.threatLevel,
        confidence: review.confidenceLevel,
      });
    } catch (error) {
      logger.error("[StrategicReflection] Error conducting review:", error);
    }
  },
};

// --- Helper functions from the old strategyReview action ---

async function getPlayerIds(
  playerNames: string[],
  entities: any[],
): Promise<UUID[]> {
  return playerNames
    .map(
      (name) =>
        entities.find((e) =>
          e.names.some(
            (entityName: string) =>
              entityName.toLowerCase() === name.toLowerCase(),
          ),
        )?.id,
    )
    .filter((id): id is UUID => id !== undefined);
}

async function updateRelationshipsFromReview(
  review: StrategicReviewOutput,
  strategyService: StrategyService,
  entities: any[],
): Promise<void> {
  const findEntity = (name: string) =>
    entities.find((e) =>
      e.names.some(
        (entityName: string) => entityName.toLowerCase() === name.toLowerCase(),
      ),
    );

  for (const allyName of review.allianceChanges.strengthen) {
    const entity = findEntity(allyName);
    if (entity) {
      await strategyService.updateRelationship(entity.id, allyName, {
        trustLevel: TrustLevel.ALLY,
        notes: ["Relationship strengthened in review."],
      });
    }
  }

  for (const unreliableName of review.allianceChanges.abandon) {
    const entity = findEntity(unreliableName);
    if (entity) {
      await strategyService.updateRelationship(entity.id, unreliableName, {
        trustLevel: TrustLevel.NEUTRAL,
        notes: ["Alliance marked for abandonment in review."],
      });
    }
  }

  for (const targetName of review.priorityTargets) {
    const entity = findEntity(targetName);
    if (entity) {
      await strategyService.updateRelationship(entity.id, targetName, {
        trustLevel: TrustLevel.THREAT,
        threat: 0.8,
        notes: ["Identified as priority target in review."],
      });
    }
  }
}
