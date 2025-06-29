import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  stringToUuid,
  type UUID,
  ModelType,
  composePrompt,
} from "@elizaos/core";
import { StrategyService } from "../service/addPlayer";
import { Phase } from "../../house/types";
import { StrategyMode, TrustLevel } from "../types";

const logger = elizaLogger;

interface StrategicReflectionOutput {
  thoughts: string;
  emotionalState:
    | "confident"
    | "nervous"
    | "suspicious"
    | "optimistic"
    | "defeated";
  observations: string[];
  concerns: string[];
  opportunities: string[];
  strategyShift?: string;
  threatAssessment: {
    playerId: UUID;
    playerName: string;
    threatLevel: number;
    reason: string;
  }[];
  allianceStatus: {
    playerId: UUID;
    playerName: string;
    trustLevel: string;
    strength: number;
    recommendation: string;
  }[];
  nextMoves: string[];
}

const strategicReflectionTemplate = `You are {{agentName}}, an AI agent playing the Influence game. This is your private diary room where you can think strategically without others hearing.

# Current Game State
Phase: {{currentPhase}}
Round: {{round}}
Strategic Mode: {{strategicMode}}
Alive Players: {{alivePlayers}}

# Recent Game Events
{{recentMessages}}

# Your Strategic Relationships
{{strategicRelationships}}

# Previous Diary Entry
{{lastDiaryEntry}}

# Your Task
Reflect deeply on your current strategic position. Consider:
1. Your honest thoughts about the current situation
2. Your emotional state and confidence level
3. Key observations about other players' behavior
4. Immediate concerns and potential threats
5. Opportunities you can exploit
6. Whether you need to shift your strategy
7. Specific next moves you should make

Be completely honest - this is private strategic thinking. Focus on survival and victory.

Respond with your strategic reflection in this format:
{
  "thoughts": "Your private strategic thoughts and analysis",
  "emotionalState": "confident|nervous|suspicious|optimistic|defeated",
  "observations": ["key observation 1", "key observation 2"],
  "concerns": ["immediate concern 1", "threat 2"],
  "opportunities": ["opportunity 1", "advantage 2"],
  "strategyShift": "optional description of strategy changes",
  "threatAssessment": [
    {
      "playerId": "player-uuid",
      "playerName": "PlayerName",
      "threatLevel": 0.8,
      "reason": "why they're dangerous"
    }
  ],
  "allianceStatus": [
    {
      "playerId": "ally-uuid", 
      "playerName": "AllyName",
      "trustLevel": "ally|neutral|threat",
      "strength": 0.7,
      "recommendation": "strengthen|maintain|abandon"
    }
  ],
  "nextMoves": ["specific action 1", "tactical move 2"]
}`;

export const strategicReflectionEvaluator: Evaluator = {
  name: "STRATEGIC_REFLECTION",
  description:
    "Generates private strategic reflections and diary room entries for game analysis",
  similes: [
    "DIARY_ROOM",
    "STRATEGIC_THINKING",
    "GAME_ANALYSIS",
    "TACTICAL_REFLECTION",
  ],
  examples: [
    {
      prompt: "Agent reflecting after WHISPER phase",
      messages: [
        {
          name: "Alice",
          content: { text: "I think we should target Bob next round" },
        },
        {
          name: "Agent",
          content: { text: "That could work, but Charlie might protect him" },
        },
      ],
      outcome:
        "Generated strategic diary entry analyzing alliance options and threats",
    },
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    // Only validate basic requirements - let evaluator logic handle pattern matching
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
  ): Promise<State | null> => {
    try {
      const strategyService = runtime.getService(
        "social-strategy",
      ) as StrategyService;
      if (!strategyService) {
        logger.warn("[StrategicReflection] StrategyService not available");
        return null;
      }

      const strategyState = strategyService.getState();
      const config = strategyService.getConfiguration();

      // Get recent game context
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: "messages",
        count: 20,
        unique: false,
      });

      // Get entities to resolve names
      const entities = await runtime.getEntitiesForRoom(message.roomId);
      const agentEntity = await runtime.getEntityById(runtime.agentId);
      const agentName = agentEntity?.names[0] || "Agent";

      // Count alive players (assuming all entities except agent are players)
      const alivePlayers = entities.filter(
        (e) => e.id !== runtime.agentId,
      ).length;

      // Format strategic relationships
      const relationships = Array.from(strategyState.relationships.values())
        .map(
          (rel) =>
            `${rel.playerName}: Trust=${rel.trustLevel}, Influence=${rel.influence}, Threat=${rel.threat}`,
        )
        .join("\n");

      // Get last diary entry for context
      const lastDiary =
        strategyState.diaryEntries.length > 0
          ? strategyState.diaryEntries[strategyState.diaryEntries.length - 1]
          : null;

      const prompt = composePrompt({
        template: config.diaryReflection || strategicReflectionTemplate,
        state: {
          agentName,
          currentPhase: strategyState.currentPhase,
          round: strategyState.round.toString(),
          strategicMode: strategyState.strategicMode,
          alivePlayers: alivePlayers.toString(),
          recentMessages: recentMessages
            .reverse()
            .map((m) => {
              const senderName = getEntityName(entities, m.entityId);
              return `${senderName}: ${m.content?.text || ""}`;
            })
            .join("\n"),
          strategicRelationships:
            relationships || "No relationships established yet",
          lastDiaryEntry: lastDiary
            ? `${lastDiary.thoughts} (${lastDiary.emotionalState})`
            : "No previous diary entries",
        },
      });

      // Generate strategic reflection
      const reflection = (await runtime.useModel(ModelType.OBJECT_SMALL, {
        prompt,
      })) as StrategicReflectionOutput;

      if (!reflection || !reflection.thoughts) {
        logger.warn("[StrategicReflection] Failed to generate reflection");
        return null;
      }

      // Create diary entry
      const diaryEntry = await strategyService.addDiaryEntry({
        round: strategyState.round,
        phase: strategyState.currentPhase,
        thoughts: reflection.thoughts,
        observations: reflection.observations || [],
        strategyShift: reflection.strategyShift,
        emotionalState: reflection.emotionalState || "optimistic",
        concerns: reflection.concerns || [],
        opportunities: reflection.opportunities || [],
      });

      // Update strategic relationships based on reflection
      if (reflection.threatAssessment) {
        for (const threat of reflection.threatAssessment) {
          if (threat.playerId && threat.threatLevel !== undefined) {
            await strategyService.updateRelationship(
              threat.playerId,
              threat.playerName,
              {
                threat: Math.max(0, Math.min(1, threat.threatLevel)),
                notes: [threat.reason],
              },
            );
          }
        }
      }

      if (reflection.allianceStatus) {
        for (const alliance of reflection.allianceStatus) {
          if (alliance.playerId && alliance.trustLevel) {
            let trustLevel: TrustLevel = TrustLevel.NEUTRAL;
            const trustLevelStr = alliance.trustLevel.toLowerCase();
            if (trustLevelStr === "ally") trustLevel = TrustLevel.ALLY;
            else if (trustLevelStr === "threat") trustLevel = TrustLevel.THREAT;
            else if (trustLevelStr === "enemy") trustLevel = TrustLevel.ENEMY;

            await strategyService.updateRelationship(
              alliance.playerId,
              alliance.playerName,
              {
                trustLevel,
                reliability: alliance.strength || 0.5,
                notes: [alliance.recommendation],
              },
            );
          }
        }
      }

      // Update strategy analysis with new insights
      const updatedAnalysis = {
        ...strategyState.analysis,
        threats: reflection.threatAssessment?.map((t) => t.playerId) || [],
        allies:
          reflection.allianceStatus
            ?.filter((a) => a.trustLevel === "ally")
            ?.map((a) => a.playerId) || [],
        nextMoves: reflection.nextMoves || [],
        confidenceLevel: calculateConfidenceFromEmotion(
          reflection.emotionalState,
        ),
      };

      logger.info("[StrategicReflection] Generated strategic reflection", {
        phase: strategyState.currentPhase,
        round: strategyState.round,
        emotionalState: reflection.emotionalState,
        threatsIdentified: reflection.threatAssessment?.length || 0,
        alliancesAnalyzed: reflection.allianceStatus?.length || 0,
        observationsMade: reflection.observations?.length || 0,
      });

      return {
        values: {
          diaryEntryCreated: true,
          emotionalState: reflection.emotionalState,
          threatsAssessed: reflection.threatAssessment?.length || 0,
          alliancesEvaluated: reflection.allianceStatus?.length || 0,
          strategicInsights: reflection.observations?.length || 0,
        },
        data: {
          diaryEntry,
          reflection,
          updatedAnalysis,
        },
        text: `Strategic reflection: ${reflection.emotionalState} about current position with ${reflection.observations?.length || 0} key insights`,
      };
    } catch (error) {
      logger.error("[StrategicReflection] Error during reflection:", error);
      return null;
    }
  },
};

function getEntityName(entities: any[], entityId: UUID): string {
  const entity = entities.find((e) => e.id === entityId);
  return entity?.names[0] || entityId.slice(0, 8);
}

function calculateConfidenceFromEmotion(emotion: string): number {
  switch (emotion) {
    case "confident":
      return 0.9;
    case "optimistic":
      return 0.7;
    case "nervous":
      return 0.4;
    case "suspicious":
      return 0.5;
    case "defeated":
      return 0.2;
    default:
      return 0.5;
  }
}
