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
import { TrustLevel, StrategyMode } from "../types";

const logger = elizaLogger;

interface StrategicObservation {
  playerId: UUID;
  playerName: string;
  trustSignal: "positive" | "negative" | "neutral";
  influenceIndicator: number; // 0-1 scale
  threatLevel: number; // 0-1 scale
  reliability: number; // 0-1 scale
  context: string;
  confidence: number; // 0-1 scale
  observationType: "direct" | "indirect" | "behavioral";
  gameRelevance: number; // 0-1 scale
}

interface AllianceSignal {
  players: UUID[];
  strength: number; // 0-1 scale
  evidence: string;
  type: "explicit" | "implicit" | "suspected";
  confidence: number;
}

const strategicAnalysisTemplate = `You are analyzing a conversation for strategic intelligence in the Influence game. Extract:

# Context
Current Game Phase: {{currentPhase}}
Strategic Mode: {{strategicMode}}
Round: {{round}}

# Recent Messages
{{recentMessages}}

# Known Players
{{knownPlayers}}

# Your Task
Analyze the conversation for:
1. Trust signals between players (positive/negative indicators)
2. Influence demonstrations (who seems to have power/sway)
3. Threat assessments (who poses danger)
4. Reliability indicators (who keeps promises, who is consistent)
5. Alliance formations or hints
6. Behavioral patterns that reveal strategy

Focus on game-relevant intelligence that affects survival and victory.

Respond with structured analysis of strategic relationships and alliances.`;

export const strategicRelationshipEvaluator: Evaluator = {
  name: "STRATEGIC_RELATIONSHIP_EXTRACTION",
  description:
    "Extracts strategic intelligence about player relationships, alliances, and threats in the Influence game",
  similes: [
    "STRATEGIC_ANALYZER",
    "RELATIONSHIP_TRACKER",
    "ALLIANCE_DETECTOR",
    "THREAT_ASSESSOR",
  ],
  examples: [
    {
      prompt: "Players discussing votes and alliances",
      messages: [
        {
          name: "Alice",
          content: { text: "I think we should work together this round" },
        },
        {
          name: "Bob",
          content: {
            text: "I agree Alice, but we need to watch out for Charlie",
          },
        },
        {
          name: "Charlie",
          content: { text: "I heard you two whispering earlier..." },
        },
      ],
      outcome:
        "Identifies Alice-Bob alliance formation and Charlie as potential threat",
    },
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    // Only validate basic requirements - let evaluator logic handle the rest
    const strategyService = runtime.getService("social-strategy");
    return !!(
      strategyService &&
      message.content?.text &&
      typeof message.content.text === "string" &&
      message.entityId !== runtime.agentId
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
        logger.warn(
          "[StrategicRelationshipExtractor] StrategyService not available",
        );
        return null;
      }

      const strategyState = strategyService.getState();

      // Get recent messages for context
      const recentMessages = await runtime.getMemories({
        roomId: message.roomId,
        tableName: "messages",
        count: 15,
        unique: false,
      });

      // Get all entities in the room to identify players
      const entities = await runtime.getEntitiesForRoom(message.roomId);
      const knownPlayers = entities
        .filter((e) => e.id !== runtime.agentId)
        .map((e) => ({
          id: e.id,
          name: e.names[0] || "Unknown",
          relationship: strategyState.relationships.get(e.id),
        }));

      const prompt = composePrompt({
        template: strategicAnalysisTemplate,
        state: {
          currentPhase: strategyState.currentPhase,
          strategicMode: strategyState.strategicMode,
          round: strategyState.round.toString(),
          recentMessages: recentMessages
            .reverse()
            .map(
              (m) =>
                `${getEntityName(entities, m.entityId)}: ${m.content?.text || ""}`,
            )
            .join("\n"),
          knownPlayers: knownPlayers
            .map(
              (p) => `${p.name} (${p.relationship?.trustLevel || "unknown"})`,
            )
            .join(", "),
        },
      });

      // Use AI to analyze strategic content
      const analysis = await runtime.useModel(ModelType.OBJECT_SMALL, {
        prompt,
      });

      if (!analysis) {
        return null;
      }

      // Extract strategic observations from the current message
      const observations = await extractStrategicObservations(
        message,
        entities,
        strategyState.strategicMode,
      );

      // Update strategic relationships based on observations (only for valid entities)
      for (const obs of observations) {
        // Verify the player ID exists in entities before updating relationship
        const playerEntity = entities.find(e => e.id === obs.playerId);
        if (playerEntity) {
          await strategyService.updateRelationship(obs.playerId, obs.playerName, {
            trustLevel: getTrustLevelFromSignal(obs.trustSignal),
            influence: Math.max(0, Math.min(1, obs.influenceIndicator)),
            threat: Math.max(0, Math.min(1, obs.threatLevel)),
            reliability: Math.max(0, Math.min(1, obs.reliability)),
            notes: [`${obs.context} (confidence: ${obs.confidence})`],
          });
        }
      }

      // Detect alliance signals
      const allianceSignals = detectAllianceSignals(message, entities);
      for (const alliance of allianceSignals) {
        if (alliance.players.length >= 2) {
          // Update relationships to reflect alliance (verify all players exist)
          for (let i = 0; i < alliance.players.length; i++) {
            for (let j = i + 1; j < alliance.players.length; j++) {
              const player1 = alliance.players[i];
              const player2 = alliance.players[j];

              // Verify both players exist in entities before creating alliance
              const player1Entity = entities.find(e => e.id === player1);
              const player2Entity = entities.find(e => e.id === player2);
              
              if (player1Entity && player2Entity) {
                const player1Name = player1Entity.names[0] || player1.slice(0, 8);
                const player2Name = player2Entity.names[0] || player2.slice(0, 8);

                await strategyService.updateRelationship(player1, player1Name, {
                  alliances: [player2],
                  notes: [`Alliance with ${player2Name}: ${alliance.evidence}`],
                });

                await strategyService.updateRelationship(player2, player2Name, {
                  alliances: [player1],
                  notes: [`Alliance with ${player1Name}: ${alliance.evidence}`],
                });
              }
            }
          }
        }
      }

      // Update behavioral patterns
      await updateBehavioralPatterns(
        runtime,
        message,
        entities,
        strategyService,
      );

      logger.info(
        "[StrategicRelationshipExtractor] Processed strategic intelligence",
        {
          messageId: message.id,
          observationsFound: observations.length,
          alliancesDetected: allianceSignals.length,
          phase: strategyState.currentPhase,
        },
      );

      return {
        values: {
          strategicObservations: observations.length,
          allianceSignals: allianceSignals.length,
          analysisConfidence: calculateOverallConfidence(observations),
        },
        data: {
          observations,
          allianceSignals,
          analysis: analysis || {},
        },
        text: `Extracted ${observations.length} strategic observations and ${allianceSignals.length} alliance signals`,
      };
    } catch (error) {
      logger.error(
        "[StrategicRelationshipExtractor] Error during extraction:",
        error,
      );
      return null;
    }
  },
};

function getEntityName(entities: any[], entityId: UUID): string {
  const entity = entities.find((e) => e.id === entityId);
  return entity?.names[0] || entityId.slice(0, 8);
}

function getTrustLevelFromSignal(
  signal: "positive" | "negative" | "neutral",
): TrustLevel {
  switch (signal) {
    case "positive":
      return TrustLevel.ALLY;
    case "negative":
      return TrustLevel.THREAT;
    default:
      return TrustLevel.NEUTRAL;
  }
}

async function extractStrategicObservations(
  message: Memory,
  entities: any[],
  strategicMode: StrategyMode,
): Promise<StrategicObservation[]> {
  const observations: StrategicObservation[] = [];
  const text = message.content?.text?.toLowerCase() || "";
  const speakerId = message.entityId;
  const speakerName = getEntityName(entities, speakerId);

  // Trust signal patterns
  const trustPatterns = [
    {
      pattern: /trust|reliable|honest|dependable/i,
      signal: "positive" as const,
      weight: 0.7,
    },
    {
      pattern: /betray|lie|deceive|untrustworthy/i,
      signal: "negative" as const,
      weight: 0.8,
    },
    {
      pattern: /suspicious|doubt|question/i,
      signal: "negative" as const,
      weight: 0.5,
    },
    {
      pattern: /support|back|help|assist/i,
      signal: "positive" as const,
      weight: 0.6,
    },
  ];

  // Influence indicators
  const influencePatterns = [
    { pattern: /leader|control|decide|command/i, influence: 0.8 },
    { pattern: /follow|listen|agree/i, influence: 0.3 },
    { pattern: /vote|choose|pick/i, influence: 0.6 },
  ];

  // Threat indicators
  const threatPatterns = [
    { pattern: /eliminate|target|danger|threat/i, threat: 0.9 },
    { pattern: /power|strong|dangerous/i, threat: 0.7 },
    { pattern: /weak|safe|harmless/i, threat: 0.2 },
  ];

  // Analyze trust signals
  for (const { pattern, signal, weight } of trustPatterns) {
    if (pattern.test(text)) {
      observations.push({
        playerId: speakerId,
        playerName: speakerName,
        trustSignal: signal,
        influenceIndicator: 0.5,
        threatLevel: signal === "negative" ? 0.7 : 0.3,
        reliability: signal === "positive" ? 0.8 : 0.3,
        context: `Trust signal: ${text.substring(0, 100)}`,
        confidence: weight,
        observationType: "direct",
        gameRelevance: strategicMode === StrategyMode.DECIDE ? 0.9 : 0.6,
      });
    }
  }

  // Analyze influence indicators
  for (const { pattern, influence } of influencePatterns) {
    if (pattern.test(text)) {
      observations.push({
        playerId: speakerId,
        playerName: speakerName,
        trustSignal: "neutral",
        influenceIndicator: influence,
        threatLevel: influence > 0.7 ? 0.8 : 0.4,
        reliability: 0.5,
        context: `Influence display: ${text.substring(0, 100)}`,
        confidence: 0.6,
        observationType: "behavioral",
        gameRelevance: 0.8,
      });
    }
  }

  // Analyze threat indicators
  for (const { pattern, threat } of threatPatterns) {
    if (pattern.test(text)) {
      observations.push({
        playerId: speakerId,
        playerName: speakerName,
        trustSignal: threat > 0.7 ? "negative" : "neutral",
        influenceIndicator: 0.5,
        threatLevel: threat,
        reliability: 0.5,
        context: `Threat assessment: ${text.substring(0, 100)}`,
        confidence: 0.7,
        observationType: "direct",
        gameRelevance: 0.9,
      });
    }
  }

  return observations;
}

function detectAllianceSignals(
  message: Memory,
  entities: any[],
): AllianceSignal[] {
  const signals: AllianceSignal[] = [];
  const text = message.content?.text || "";

  // Look for explicit alliance language
  const alliancePatterns = [
    /(?:team up|work together|alliance|partner) with (\w+)/i,
    /(?:you and me|we should|let's) (?:work|team|ally)/i,
    /(?:trust|support) (?:each other|one another)/i,
  ];

  for (const pattern of alliancePatterns) {
    const match = pattern.exec(text);
    if (match) {
      const speakerId = message.entityId;
      const targetName = match[1];
      
      // Only proceed if we have a valid target name
      if (targetName) {
        const targetEntity = entities.find((e) =>
          e.names.some(
            (name: string) => name.toLowerCase() === targetName.toLowerCase(),
          ),
        );

        // Only create alliance signal if we found a valid entity
        if (targetEntity && targetEntity.id !== speakerId) {
          signals.push({
            players: [speakerId, targetEntity.id],
            strength: 0.8,
            evidence: text.substring(0, 150),
            type: "explicit",
            confidence: 0.9,
          });
        }
      }
    }
  }

  // Look for implicit coordination
  const coordinationPatterns = [
    /(?:same|agree|together)/i,
    /(?:vote|choose) (?:together|same)/i,
  ];

  for (const pattern of coordinationPatterns) {
    if (pattern.test(text)) {
      signals.push({
        players: [message.entityId], // Single player showing coordination intent
        strength: 0.5,
        evidence: text.substring(0, 150),
        type: "implicit",
        confidence: 0.6,
      });
    }
  }

  return signals;
}

async function updateBehavioralPatterns(
  runtime: IAgentRuntime,
  message: Memory,
  entities: any[],
  strategyService: StrategyService,
): Promise<void> {
  const text = message.content?.text || "";
  const speakerId = message.entityId;

  // Analyze communication style
  let communicationStyle:
    | "aggressive"
    | "diplomatic"
    | "passive"
    | "manipulative" = "diplomatic";

  if (/threat|eliminate|destroy|crush/i.test(text)) {
    communicationStyle = "aggressive";
  } else if (/please|perhaps|maybe|suggest/i.test(text)) {
    communicationStyle = "diplomatic";
  } else if (
    /(?:^|\s)(?:ok|yes|fine)(?:\s|$)/i.test(text) &&
    text.length < 20
  ) {
    communicationStyle = "passive";
  } else if (/(?:convince|persuade|manipulate|trick)/i.test(text)) {
    communicationStyle = "manipulative";
  }

  // Analyze decision making style
  let decisionMaking: "impulsive" | "calculated" | "cautious" | "erratic" =
    "calculated";

  if (/(?:quickly|now|immediately|fast)/i.test(text)) {
    decisionMaking = "impulsive";
  } else if (/(?:wait|think|consider|analyze)/i.test(text)) {
    decisionMaking = "cautious";
  } else if (/(?:plan|strategy|calculate|logic)/i.test(text)) {
    decisionMaking = "calculated";
  }

  await strategyService.updatePlayerPattern(speakerId, {
    communicationStyle,
    decisionMaking,
    evidenceStrength: 0.1, // Single message provides limited evidence
  });
}

function calculateOverallConfidence(
  observations: StrategicObservation[],
): number {
  if (observations.length === 0) return 0;

  const totalConfidence = observations.reduce(
    (sum, obs) => sum + obs.confidence,
    0,
  );
  return totalConfidence / observations.length;
}
