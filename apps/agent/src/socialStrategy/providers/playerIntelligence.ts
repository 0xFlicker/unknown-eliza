import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  type UUID,
} from "@elizaos/core";
import { StrategyService } from "../service/addPlayer";
import { PlayerIntelligence, TrustLevel } from "../types";

const logger = elizaLogger;

interface PlayerIntelligenceContext {
  targetPlayerName?: string;
  allPlayers: PlayerIntelligenceReport[];
  topThreats: PlayerIntelligenceReport[];
  topAllies: PlayerIntelligenceReport[];
  unknownPlayers: PlayerIntelligenceReport[];
  lastUpdated: number;
}

interface PlayerIntelligenceReport {
  name: string;
  trustLevel: string;
  influence: number;
  threat: number;
  reliability: number;
  communicationStyle: string;
  decisionMaking: string;
  alliancePatterns: string;
  recentActivity: string[];
  keyInsights: string[];
  recommendation: string;
}

/**
 * Provides detailed intelligence reports on specific players or all players
 */
export const playerIntelligenceProvider: Provider = {
  name: "PLAYER_INTELLIGENCE",
  description:
    "Provides detailed intelligence reports on players including behavioral analysis, threat assessment, and strategic recommendations",

  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      const strategyService = runtime.getService(
        "social-strategy",
      ) as StrategyService;
      if (!strategyService) {
        logger.warn("[PlayerIntelligence] StrategyService not available");
        return {
          text: "Player intelligence unavailable - service not running",
          values: {},
        };
      }

      const strategyState = strategyService.getState();
      const entities = await runtime.getEntitiesForRoom(message.roomId);

      // Check if message requests specific player analysis
      const messageText = message.content?.text?.toLowerCase() || "";
      const targetPlayerName = extractPlayerNameFromMessage(
        messageText,
        entities,
      );

      const allReports: PlayerIntelligenceReport[] = [];
      const otherPlayers = entities.filter((e) => e.id !== runtime.agentId);

      // Generate intelligence reports for all players
      for (const player of otherPlayers) {
        const playerName = player.names[0] || player.id.slice(0, 8);
        const intelligence = await strategyService.generatePlayerIntelligence(
          player.id,
        );

        if (intelligence) {
          const report = generateIntelligenceReport(intelligence);
          allReports.push(report);
        } else {
          // Create basic report for unknown players
          allReports.push(createBasicReport(playerName));
        }
      }

      // Categorize players
      const topThreats = allReports
        .filter((report) => report.threat > 0.6)
        .sort((a, b) => b.threat - a.threat)
        .slice(0, 3);

      const topAllies = allReports
        .filter(
          (report) => report.trustLevel === "ally" || report.reliability > 0.7,
        )
        .sort((a, b) => b.reliability - a.reliability)
        .slice(0, 3);

      const unknownPlayers = allReports
        .filter(
          (report) =>
            report.trustLevel === "neutral" && report.keyInsights.length === 0,
        )
        .slice(0, 3);

      const context: PlayerIntelligenceContext = {
        targetPlayerName,
        allPlayers: allReports,
        topThreats,
        topAllies,
        unknownPlayers,
        lastUpdated: Date.now(),
      };

      // Format intelligence as text
      const intelligenceText = targetPlayerName
        ? formatSpecificPlayerIntelligence(targetPlayerName, allReports)
        : formatGeneralIntelligence(context);

      logger.debug("[PlayerIntelligence] Generated intelligence report", {
        totalPlayers: allReports.length,
        topThreats: topThreats.length,
        topAllies: topAllies.length,
        targetPlayer: targetPlayerName,
      });

      return {
        text: intelligenceText,
        values: context,
        data: {
          reports: allReports,
          relationships: Array.from(strategyState.relationships.values()),
          patterns: Array.from(strategyState.playerPatterns.values()),
        },
      };
    } catch (error) {
      logger.error(
        "[PlayerIntelligence] Error generating intelligence:",
        error,
      );
      return {
        text: "Player intelligence temporarily unavailable",
        values: { error: true },
      };
    }
  },
};

function extractPlayerNameFromMessage(
  messageText: string,
  entities: any[],
): string | undefined {
  // Look for patterns like "analyze Alice", "what about Bob", "tell me about Charlie"
  const patterns = [
    /(?:analyze|about|intel(?:ligence)?\s+(?:on|for))\s+(\w+)/i,
    /(?:what|tell\s+me)\s+about\s+(\w+)/i,
    /(?:report\s+on|info\s+on|profile\s+for)\s+(\w+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(messageText);
    if (match && match[1]) {
      const playerName = match[1];
      // Verify this is actually a player
      const player = entities.find((e) =>
        e.names.some(
          (name: string) => name.toLowerCase() === playerName.toLowerCase(),
        ),
      );
      if (player) {
        return player.names[0];
      }
    }
  }

  return undefined;
}

function generateIntelligenceReport(
  intelligence: PlayerIntelligence,
): PlayerIntelligenceReport {
  const keyInsights: string[] = [];

  // Behavioral insights
  if (intelligence.behavioralAnalysis.evidenceStrength > 0.5) {
    keyInsights.push(
      `Communication: ${intelligence.behavioralAnalysis.communicationStyle}`,
    );
    keyInsights.push(
      `Decision-making: ${intelligence.behavioralAnalysis.decisionMaking}`,
    );
    keyInsights.push(
      `Alliance pattern: ${intelligence.behavioralAnalysis.alliancePatterns}`,
    );
  }

  // Strategic insights
  if (intelligence.strategicAssessment.notes.length > 0) {
    keyInsights.push(...intelligence.strategicAssessment.notes.slice(-2));
  }

  // Trust and threat insights
  if (intelligence.trustworthiness < 0.3) {
    keyInsights.push("Low trustworthiness - exercise caution");
  } else if (intelligence.trustworthiness > 0.8) {
    keyInsights.push("High trustworthiness - reliable ally");
  }

  if (intelligence.dangerLevel > 0.7) {
    keyInsights.push("HIGH THREAT - immediate danger to survival");
  }

  // Alliance insights
  if (intelligence.alliances.length > 0) {
    keyInsights.push(`Allied with: ${intelligence.alliances.length} players`);
  }

  // Generate recommendation
  const recommendation = generateRecommendation(intelligence);

  return {
    name: intelligence.playerName,
    trustLevel: intelligence.strategicAssessment.trustLevel.toLowerCase(),
    influence: intelligence.strategicAssessment.influence,
    threat: intelligence.dangerLevel,
    reliability: intelligence.trustworthiness,
    communicationStyle: intelligence.behavioralAnalysis.communicationStyle,
    decisionMaking: intelligence.behavioralAnalysis.decisionMaking,
    alliancePatterns: intelligence.behavioralAnalysis.alliancePatterns,
    recentActivity: intelligence.recentActivity,
    keyInsights,
    recommendation,
  };
}

function createBasicReport(playerName: string): PlayerIntelligenceReport {
  return {
    name: playerName,
    trustLevel: "neutral",
    influence: 0.5,
    threat: 0.5,
    reliability: 0.5,
    communicationStyle: "unknown",
    decisionMaking: "unknown",
    alliancePatterns: "unknown",
    recentActivity: [],
    keyInsights: ["Insufficient data for analysis"],
    recommendation: "Observe and gather more information",
  };
}

function generateRecommendation(intelligence: PlayerIntelligence): string {
  const { trustworthiness, dangerLevel, strategicAssessment } = intelligence;

  if (dangerLevel > 0.8) {
    return "ELIMINATE - Immediate threat to survival";
  } else if (dangerLevel > 0.6) {
    return "NEUTRALIZE - Consider elimination or alliance to control";
  } else if (trustworthiness > 0.8 && strategicAssessment.influence > 0.6) {
    return "ALLY - Valuable strategic partner";
  } else if (trustworthiness > 0.7) {
    return "COOPERATE - Reliable for temporary alliances";
  } else if (strategicAssessment.influence > 0.7) {
    return "MONITOR - High influence, watch carefully";
  } else if (trustworthiness < 0.3) {
    return "AVOID - Untrustworthy, keep at distance";
  } else if (intelligence.alliances.length > 2) {
    return "ASSESS - Strong alliance network, evaluate threat";
  } else {
    return "EVALUATE - Gather more intelligence before decisions";
  }
}

function formatSpecificPlayerIntelligence(
  playerName: string,
  reports: PlayerIntelligenceReport[],
): string {
  const report = reports.find(
    (r) => r.name.toLowerCase() === playerName.toLowerCase(),
  );

  if (!report) {
    return `# PLAYER INTELLIGENCE: ${playerName}

No intelligence available for this player.`;
  }

  return `# PLAYER INTELLIGENCE: ${report.name}

## THREAT ASSESSMENT
Trust Level: ${report.trustLevel.toUpperCase()}
Threat Level: ${Math.round(report.threat * 100)}%
Reliability: ${Math.round(report.reliability * 100)}%
Influence: ${Math.round(report.influence * 100)}%

## BEHAVIORAL PROFILE
Communication: ${report.communicationStyle}
Decision-Making: ${report.decisionMaking}
Alliance Patterns: ${report.alliancePatterns}

## KEY INSIGHTS
${report.keyInsights.map((insight) => `• ${insight}`).join("\n")}

## RECENT ACTIVITY
${
  report.recentActivity.length > 0
    ? report.recentActivity
        .slice(0, 3)
        .map((activity) => `• ${activity.substring(0, 80)}...`)
        .join("\n")
    : "• No recent activity recorded"
}

## STRATEGIC RECOMMENDATION
${report.recommendation}`;
}

function formatGeneralIntelligence(context: PlayerIntelligenceContext): string {
  return `# PLAYER INTELLIGENCE OVERVIEW

## TOP THREATS (${context.topThreats.length})
${
  context.topThreats.length > 0
    ? context.topThreats
        .map(
          (threat) =>
            `• ${threat.name}: ${Math.round(threat.threat * 100)}% threat (${threat.recommendation})`,
        )
        .join("\n")
    : "• No significant threats identified"
}

## RELIABLE ALLIES (${context.topAllies.length})
${
  context.topAllies.length > 0
    ? context.topAllies
        .map(
          (ally) =>
            `• ${ally.name}: ${Math.round(ally.reliability * 100)}% reliable (${ally.trustLevel})`,
        )
        .join("\n")
    : "• No reliable allies identified"
}

## UNKNOWN PLAYERS (${context.unknownPlayers.length})
${
  context.unknownPlayers.length > 0
    ? context.unknownPlayers
        .map(
          (unknown) =>
            `• ${unknown.name}: Insufficient data - requires observation`,
        )
        .join("\n")
    : "• All players have been analyzed"
}

## INTELLIGENCE SUMMARY
Total Players Analyzed: ${context.allPlayers.length}
High-Threat Players: ${context.topThreats.length}
Trusted Allies: ${context.topAllies.length}
Unknown Factors: ${context.unknownPlayers.length}

## RECOMMENDED ACTIONS
${generateGeneralRecommendations(context)
  .map((rec, i) => `${i + 1}. ${rec}`)
  .join("\n")}`;
}

function generateGeneralRecommendations(
  context: PlayerIntelligenceContext,
): string[] {
  const recommendations: string[] = [];

  if (context.topThreats.length > 0) {
    recommendations.push(
      `Monitor ${context.topThreats[0].name} closely - highest threat`,
    );
  }

  if (context.topAllies.length === 0) {
    recommendations.push("URGENT: Form strategic alliances for survival");
  } else if (context.topAllies.length === 1) {
    recommendations.push("Expand alliance network beyond single ally");
  }

  if (context.unknownPlayers.length > 0) {
    recommendations.push(
      `Gather intelligence on ${context.unknownPlayers.map((p) => p.name).join(", ")}`,
    );
  }

  if (context.topThreats.length > context.topAllies.length) {
    recommendations.push("Consider defensive alliances to counter threats");
  }

  if (recommendations.length === 0) {
    recommendations.push("Maintain current strategic position");
  }

  return recommendations.slice(0, 4); // Limit to 4 recommendations
}
