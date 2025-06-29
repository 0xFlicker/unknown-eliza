import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  ModelType,
  composePrompt,
} from "@elizaos/core";
import { StrategyService } from "../service/addPlayer";
import { Phase } from "../../house/types";
import { TrustLevel } from "../types";

const logger = elizaLogger;

interface StrategyReviewRequest {
  trigger:
    | "phase_change"
    | "threat_detected"
    | "alliance_opportunity"
    | "manual";
  phase?: Phase;
  urgency: "low" | "medium" | "high" | "critical";
  focus?: string;
}

interface StrategyReviewResponse {
  overallAssessment: string;
  threatLevel: "low" | "medium" | "high" | "critical";
  recommendedActions: string[];
  allianceChanges: {
    strengthen: string[];
    abandon: string[];
    pursue: string[];
  };
  priorityTargets: string[];
  defensiveActions: string[];
  confidenceLevel: number;
  strategicShift: string;
}

const strategyReviewTemplate = `You are conducting a comprehensive strategic review for the Influence game. Analyze your current position and adapt your strategy.

# Current Game State
{{gameState}}

# Relationship Analysis
{{relationships}}

# Recent Intelligence
{{recentIntelligence}}

# Trigger Context
Review Trigger: {{trigger}}
{{triggerDetails}}

# Strategic Assessment Task
Conduct a thorough strategic review considering:
1. Overall threat assessment and survival probability
2. Alliance evaluation - who to strengthen, abandon, or pursue
3. Priority targets for elimination or protection
4. Defensive actions needed for survival
5. Strategic shifts required based on new information
6. Immediate tactical actions to implement

Be ruthlessly strategic - this is about survival and victory.

Respond with your strategic analysis:
{
  "overallAssessment": "Comprehensive analysis of current strategic position",
  "threatLevel": "low|medium|high|critical",
  "recommendedActions": ["immediate action 1", "tactical move 2"],
  "allianceChanges": {
    "strengthen": ["ally name 1"],
    "abandon": ["unreliable ally"],
    "pursue": ["potential new ally"]
  },
  "priorityTargets": ["elimination target 1", "protection priority 1"],
  "defensiveActions": ["defensive measure 1", "survival tactic 2"],
  "confidenceLevel": 0.75,
  "strategicShift": "Description of major strategy changes needed"
}`;

export const strategyReviewAction: Action = {
  name: "STRATEGY_REVIEW",
  description:
    "Conducts comprehensive strategic reviews and updates tactical approach based on game developments",
  similes: [
    "STRATEGIC_ASSESSMENT",
    "TACTICAL_ANALYSIS",
    "STRATEGY_UPDATE",
    "POSITION_REVIEW",
    "THREAT_ASSESSMENT",
    "ALLIANCE_REVIEW",
  ],

  examples: [
    [
      {
        name: "user",
        content: {
          text: "The phase has changed to VOTE - review strategy",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Conducting strategic review for the new voting phase to optimize survival chances.",
          action: "STRATEGY_REVIEW",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "Alice just betrayed Bob - reassess threats",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Analyzing the betrayal's impact on alliance dynamics and threat landscape.",
          action: "STRATEGY_REVIEW",
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "We need to update our strategy immediately",
        },
      },
      {
        name: "assistant",
        content: {
          text: "Initiating urgent strategic review to adapt to current developments.",
          action: "STRATEGY_REVIEW",
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    // Only validate that we have a strategy service and a text message
    const strategyService = runtime.getService("social-strategy");
    return !!(
      strategyService &&
      message.content?.text &&
      typeof message.content.text === "string"
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    try {
      const strategyService = runtime.getService(
        "social-strategy",
      ) as StrategyService;
      if (!strategyService) {
        logger.warn("[StrategyReview] StrategyService not available");
        return false;
      }

      const text = message.content?.text || "";
      const request = parseReviewRequest(text);

      const strategyState = strategyService.getState();
      const config = strategyService.getConfiguration();

      // Get current game context
      const entities = await runtime.getEntitiesForRoom(message.roomId);
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: "messages",
        count: 15,
        unique: false,
      });

      // Build review context
      const gameState = formatGameState(strategyState, entities);
      const relationships = formatRelationships(strategyState, entities);
      const recentIntelligence = formatRecentIntelligence(
        recentMessages,
        entities,
        runtime.agentId,
      );
      const triggerDetails = formatTriggerDetails(request, text);

      const prompt = composePrompt({
        template: config.phaseTransition || strategyReviewTemplate,
        state: {
          gameState,
          relationships,
          recentIntelligence,
          trigger: request.trigger,
          triggerDetails,
        },
      });

      // Generate strategic review
      const review = (await runtime.useModel(ModelType.OBJECT_SMALL, {
        prompt,
      })) as StrategyReviewResponse;

      if (!review || !review.overallAssessment) {
        logger.warn("[StrategyReview] Failed to generate strategy review");
        return false;
      }

      // Update strategic relationships based on review
      await updateRelationshipsFromReview(review, strategyService, entities);

      // Update strategic analysis
      const updatedAnalysis = {
        ...strategyState.analysis,
        confidenceLevel:
          review.confidenceLevel || strategyState.analysis.confidenceLevel,
        nextMoves: review.recommendedActions,
        threats: await getPlayerIds(review.priorityTargets, entities),
        allies: await getPlayerIds(review.allianceChanges.strengthen, entities),
      };

      // Create diary entry from review
      await strategyService.addDiaryEntry({
        round: strategyState.round,
        phase: strategyState.currentPhase,
        thoughts: review.overallAssessment,
        observations: review.recommendedActions,
        strategyShift: review.strategicShift,
        emotionalState: getEmotionalStateFromThreat(review.threatLevel),
        concerns: review.priorityTargets,
        opportunities: review.allianceChanges.pursue,
      });

      logger.info("[StrategyReview] Completed strategic review", {
        trigger: request.trigger,
        urgency: request.urgency,
        threatLevel: review.threatLevel,
        actionsRecommended: review.recommendedActions.length,
        allianceChanges: Object.keys(review.allianceChanges).length,
        confidenceLevel: review.confidenceLevel,
      });

      // Strategic review is private - no public announcements
      // Analysis happens silently in the background

      return true;
    } catch (error) {
      logger.error("[StrategyReview] Error conducting strategy review:", error);
      return false;
    }
  },
};

function parseReviewRequest(text: string): StrategyReviewRequest {
  const lowerText = text.toLowerCase();

  let trigger: StrategyReviewRequest["trigger"] = "manual";
  if (lowerText.includes("phase")) {
    trigger = "phase_change";
  } else if (lowerText.includes("threat") || lowerText.includes("betray")) {
    trigger = "threat_detected";
  } else if (lowerText.includes("alliance") || lowerText.includes("ally")) {
    trigger = "alliance_opportunity";
  }

  let urgency: StrategyReviewRequest["urgency"] = "medium";
  if (lowerText.includes("critical") || lowerText.includes("emergency")) {
    urgency = "critical";
  } else if (lowerText.includes("urgent") || lowerText.includes("immediate")) {
    urgency = "high";
  } else if (lowerText.includes("casual") || lowerText.includes("routine")) {
    urgency = "low";
  }

  // Extract focus area
  let focus: string | undefined;
  if (lowerText.includes("threat")) focus = "threat_assessment";
  else if (lowerText.includes("alliance")) focus = "alliance_management";
  else if (lowerText.includes("survival")) focus = "defensive_strategy";

  return { trigger, urgency, focus };
}

function formatGameState(strategyState: any, entities: any[]): string {
  const alivePlayers = entities.filter(
    (e) => e.id !== strategyState.agentId,
  ).length;

  return `Phase: ${strategyState.currentPhase} (Round ${strategyState.round})
Strategic Mode: ${strategyState.strategicMode}
Players Remaining: ${alivePlayers}
My Confidence: ${Math.round(strategyState.analysis.confidenceLevel * 100)}%
Power Position: ${strategyState.analysis.powerPosition}
Protection Needed: ${strategyState.analysis.protectionNeeded ? "YES" : "NO"}`;
}

function formatRelationships(strategyState: any, entities: any[]): string {
  const relationships = Array.from(strategyState.relationships.values());
  const allies = relationships.filter(
    (rel: any) => rel.trustLevel === TrustLevel.ALLY,
  );
  const threats = relationships.filter(
    (rel: any) =>
      rel.trustLevel === TrustLevel.THREAT ||
      rel.trustLevel === TrustLevel.ENEMY,
  );
  const neutrals = relationships.filter(
    (rel: any) => rel.trustLevel === TrustLevel.NEUTRAL,
  );

  const formatGroup = (group: any[], label: string) => {
    if (group.length === 0) return `${label}: None`;
    return `${label}: ${group.map((rel) => `${rel.playerName} (${Math.round(rel.reliability * 100)}%)`).join(", ")}`;
  };

  return [
    formatGroup(allies, "ALLIES"),
    formatGroup(threats, "THREATS"),
    formatGroup(neutrals, "NEUTRALS"),
  ].join("\n");
}

function formatRecentIntelligence(
  messages: Memory[],
  entities: any[],
  agentId: string,
): string {
  const intelligence = messages
    .reverse()
    .slice(-8)
    .filter((msg) => msg.entityId !== agentId)
    .map((msg) => {
      const senderName = getEntityName(entities, msg.entityId);
      const text = msg.content?.text || "";
      return `${senderName}: ${text.substring(0, 120)}${text.length > 120 ? "..." : ""}`;
    })
    .join("\n");

  return intelligence || "No recent intelligence gathered";
}

function formatTriggerDetails(
  request: StrategyReviewRequest,
  text: string,
): string {
  const details = [`Urgency: ${request.urgency.toUpperCase()}`];

  if (request.focus) {
    details.push(`Focus: ${request.focus}`);
  }

  if (request.trigger === "phase_change") {
    details.push("Adapting strategy for new game phase");
  } else if (request.trigger === "threat_detected") {
    details.push("Responding to new threat or betrayal");
  } else if (request.trigger === "alliance_opportunity") {
    details.push("Evaluating alliance opportunities");
  }

  if (text.length > 0) {
    details.push(`Context: ${text.substring(0, 100)}`);
  }

  return details.join("\n");
}

async function updateRelationshipsFromReview(
  review: StrategyReviewResponse,
  strategyService: StrategyService,
  entities: any[],
): Promise<void> {
  // Strengthen alliances
  for (const allyName of review.allianceChanges.strengthen) {
    const entity = findEntityByName(entities, allyName);
    if (entity) {
      await strategyService.updateRelationship(entity.id, allyName, {
        trustLevel: TrustLevel.ALLY,
        reliability: Math.min(1, 0.8),
        notes: ["Relationship strengthened in strategic review"],
      });
    }
  }

  // Mark alliances to abandon
  for (const unreliableName of review.allianceChanges.abandon) {
    const entity = findEntityByName(entities, unreliableName);
    if (entity) {
      await strategyService.updateRelationship(entity.id, unreliableName, {
        trustLevel: TrustLevel.NEUTRAL,
        reliability: Math.max(0, 0.3),
        notes: ["Alliance marked for abandonment"],
      });
    }
  }

  // Mark targets as threats
  for (const targetName of review.priorityTargets) {
    const entity = findEntityByName(entities, targetName);
    if (entity) {
      await strategyService.updateRelationship(entity.id, targetName, {
        trustLevel: TrustLevel.THREAT,
        threat: Math.min(1, 0.8),
        notes: ["Identified as priority target"],
      });
    }
  }
}

async function getPlayerIds(
  playerNames: string[],
  entities: any[],
): Promise<string[]> {
  return playerNames
    .map((name) => findEntityByName(entities, name)?.id)
    .filter((id) => id !== undefined);
}

function findEntityByName(entities: any[], name: string): any {
  return entities.find((e) =>
    e.names.some(
      (entityName: string) => entityName.toLowerCase() === name.toLowerCase(),
    ),
  );
}

function getEntityName(entities: any[], entityId: string): string {
  const entity = entities.find((e) => e.id === entityId);
  return entity?.names[0] || entityId.slice(0, 8);
}

function getEmotionalStateFromThreat(
  threatLevel: string,
): "confident" | "nervous" | "suspicious" | "optimistic" | "defeated" {
  switch (threatLevel) {
    case "critical":
      return "defeated";
    case "high":
      return "nervous";
    case "medium":
      return "suspicious";
    case "low":
      return "confident";
    default:
      return "optimistic";
  }
}
