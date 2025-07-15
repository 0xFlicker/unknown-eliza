import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  type UUID,
} from "@elizaos/core";
import { StrategyService } from "../service/strategy";
import { Phase } from "@/plugins/coordinator";
import { StrategyMode, TrustLevel } from "../types";

const logger = elizaLogger;

interface StrategicContextData {
  currentPhase: Phase;
  round: number;
  strategicMode: StrategyMode;
  alivePlayers: number;
  myPosition: string;
  threats: string[];
  allies: string[];
  neutrals: string[];
  recentInsights: string[];
  confidenceLevel: number;
  nextMoves: string[];
  relationshipSummary: string;
  threatAssessment: string;
  strategicPriorities: string[];
}

/**
 * Provides comprehensive strategic context for the agent's decision making
 */
export const strategicContextProvider: Provider = {
  name: "STRATEGIC_CONTEXT",
  description:
    "Provides current strategic situation, relationships, threats, and tactical priorities for game decisions",

  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      const strategyService = runtime.getService(
        "social-strategy",
      ) as StrategyService;
      if (!strategyService) {
        logger.warn("[StrategicContext] StrategyService not available");
        return {
          text: "Strategic analysis unavailable - service not running",
          values: {},
        };
      }

      const strategyState = strategyService.getState();
      const entities = await runtime.getEntitiesForRoom(message.roomId);

      // Get current players (exclude agent)
      const otherPlayers = entities.filter((e) => e.id !== runtime.agentId);
      const alivePlayers = otherPlayers.length;

      // Categorize relationships
      const allies: string[] = [];
      const threats: string[] = [];
      const neutrals: string[] = [];

      for (const player of otherPlayers) {
        const relationship = strategyState.relationships.get(player.id);
        const playerName = player.names[0] || player.id.slice(0, 8);

        if (relationship) {
          switch (relationship.trustLevel) {
            case TrustLevel.ALLY:
              allies.push(playerName);
              break;
            case TrustLevel.THREAT:
            case TrustLevel.ENEMY:
              threats.push(playerName);
              break;
            default:
              neutrals.push(playerName);
          }
        } else {
          neutrals.push(playerName);
        }
      }

      // Get recent diary insights
      const recentDiary = strategyState.diaryEntries.slice(-3);
      const recentInsights = recentDiary.flatMap((entry) => entry.observations);

      // Assess current position
      const myPosition = assessPosition(
        allies.length,
        threats.length,
        alivePlayers,
        strategyState.analysis.confidenceLevel,
      );

      // Generate relationship summary
      const relationshipSummary = generateRelationshipSummary(
        allies,
        threats,
        neutrals,
        strategyState.relationships,
      );

      // Generate threat assessment
      const threatAssessment = generateThreatAssessment(
        threats,
        strategyState.relationships,
        entities,
      );

      // Determine strategic priorities based on phase and situation
      const strategicPriorities = determineStrategicPriorities(
        strategyState.currentPhase,
        allies.length,
        threats.length,
        alivePlayers,
      );

      const contextData: StrategicContextData = {
        currentPhase: strategyState.currentPhase,
        round: strategyState.round,
        strategicMode: strategyState.strategicMode,
        alivePlayers,
        myPosition,
        threats,
        allies,
        neutrals,
        recentInsights: recentInsights.slice(-5), // Last 5 insights
        confidenceLevel: strategyState.analysis.confidenceLevel,
        nextMoves: strategyState.analysis.nextMoves,
        relationshipSummary,
        threatAssessment,
        strategicPriorities,
      };

      // Format context as text for prompt injection
      const contextText = formatStrategicContext(contextData);

      logger.debug("[StrategicContext] Generated strategic context", {
        phase: strategyState.currentPhase,
        alivePlayers,
        allies: allies.length,
        threats: threats.length,
        neutrals: neutrals.length,
        confidence: strategyState.analysis.confidenceLevel,
      });

      return {
        text: contextText,
        values: contextData,
        data: {
          relationships: Array.from(strategyState.relationships.values()),
          playerPatterns: Array.from(strategyState.playerPatterns.values()),
          analysis: strategyState.analysis,
        },
      };
    } catch (error) {
      logger.error("[StrategicContext] Error generating context:", error);
      return {
        text: "Strategic context temporarily unavailable",
        values: { error: true },
      };
    }
  },
};

function assessPosition(
  allies: number,
  threats: number,
  total: number,
  confidence: number,
): string {
  if (allies > total / 2) {
    return "DOMINANT - Strong alliance network";
  } else if (threats > allies && threats > total / 3) {
    return "VULNERABLE - Under significant threat";
  } else if (allies >= 2 && threats <= 1) {
    return "STABLE - Good alliance position";
  } else if (threats === 0 && allies > 0) {
    return "SECURE - No immediate threats";
  } else if (confidence < 0.3) {
    return "UNCERTAIN - Unclear strategic position";
  } else {
    return "CONTESTED - Competitive position";
  }
}

function generateRelationshipSummary(
  allies: string[],
  threats: string[],
  neutrals: string[],
  relationships: Map<UUID, any>,
): string {
  const parts: string[] = [];

  if (allies.length > 0) {
    parts.push(`ALLIES: ${allies.join(", ")}`);
  }

  if (threats.length > 0) {
    parts.push(`THREATS: ${threats.join(", ")}`);
  }

  if (neutrals.length > 0) {
    parts.push(
      `NEUTRAL: ${neutrals.slice(0, 3).join(", ")}${neutrals.length > 3 ? "..." : ""}`,
    );
  }

  // Add influence assessment
  const highInfluencePlayers = Array.from(relationships.values())
    .filter((rel) => rel.influence > 0.7)
    .map((rel) => rel.playerName);

  if (highInfluencePlayers.length > 0) {
    parts.push(`HIGH INFLUENCE: ${highInfluencePlayers.join(", ")}`);
  }

  return parts.join(" | ") || "No established relationships";
}

function generateThreatAssessment(
  threats: string[],
  relationships: Map<UUID, any>,
  entities: any[],
): string {
  if (threats.length === 0) {
    return "No immediate threats identified";
  }

  const assessments: string[] = [];

  for (const threatName of threats) {
    const entity = entities.find((e) => e.names.includes(threatName));
    if (entity) {
      const relationship = relationships.get(entity.id);
      if (relationship) {
        const threatLevel = Math.round(relationship.threat * 100);
        const influence = Math.round(relationship.influence * 100);
        assessments.push(
          `${threatName} (${threatLevel}% threat, ${influence}% influence)`,
        );
      } else {
        assessments.push(`${threatName} (unknown threat level)`);
      }
    }
  }

  return assessments.join(", ");
}

function determineStrategicPriorities(
  phase: Phase,
  allies: number,
  threats: number,
  total: number,
): string[] {
  const priorities: string[] = [];

  switch (phase) {
    case Phase.INIT:
    case Phase.LOBBY:
      priorities.push("Observe player behavior patterns");
      priorities.push("Identify potential allies");
      priorities.push("Avoid early conflicts");
      break;

    case Phase.WHISPER:
      if (allies < 2) {
        priorities.push("Form strategic alliances");
      }
      priorities.push("Gather intelligence on other players");
      if (threats > 0) {
        priorities.push("Coordinate response to threats");
      }
      priorities.push("Share selective information");
      break;

    case Phase.RUMOR:
      priorities.push("Shape public opinion");
      if (threats > allies) {
        priorities.push("Deflect suspicion from self");
      }
      priorities.push("Reinforce alliance messaging");
      priorities.push("Identify voting intentions");
      break;

    case Phase.VOTE:
      if (threats > 0) {
        priorities.push("Vote to eliminate biggest threat");
      }
      priorities.push("Coordinate with allies");
      priorities.push("Protect valuable allies");
      if (allies < total / 3) {
        priorities.push("Seek protection through alliances");
      }
      break;

    case Phase.POWER:
      priorities.push("Make strategic elimination choice");
      priorities.push("Consider long-term consequences");
      priorities.push("Protect key allies if empowered");
      break;

    case Phase.REVEAL:
      priorities.push("Analyze round outcomes");
      priorities.push("Reassess threat landscape");
      priorities.push("Plan for next round");
      break;
  }

  // Add general priorities based on position
  if (threats > allies) {
    priorities.unshift("URGENT: Neutralize threats");
  }

  if (allies === 0 && total > 4) {
    priorities.unshift("CRITICAL: Form alliances");
  }

  if (total <= 4) {
    priorities.push("Consider endgame positioning");
  }

  return priorities.slice(0, 5); // Limit to top 5 priorities
}

function formatStrategicContext(context: StrategicContextData): string {
  return `
# STRATEGIC SITUATION
Phase: ${context.currentPhase} (Round ${context.round})
Mode: ${context.strategicMode}
Players Alive: ${context.alivePlayers}
My Position: ${context.myPosition}
Confidence: ${Math.round(context.confidenceLevel * 100)}%

# RELATIONSHIPS
${context.relationshipSummary}

# THREAT ASSESSMENT
${context.threatAssessment}

# RECENT INTELLIGENCE
${context.recentInsights.length > 0 ? context.recentInsights.map((insight) => `• ${insight}`).join("\n") : "• No recent insights"}

# STRATEGIC PRIORITIES
${context.strategicPriorities.map((priority, i) => `${i + 1}. ${priority}`).join("\n")}

# PLANNED ACTIONS
${context.nextMoves.length > 0 ? context.nextMoves.map((move) => `• ${move}`).join("\n") : "• No specific actions planned"}
`.trim();
}
