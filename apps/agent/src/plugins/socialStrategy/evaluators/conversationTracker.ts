import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  stringToUuid,
  type UUID,
} from "@elizaos/core";
import { StrategyService } from "../service/addPlayer";
import { TrustLevel } from "../types";

const logger = elizaLogger;

/**
 * Regex utility to detect @mentions in a text message.
 */
function hasMentions(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /@[^\s]+/.test(text);
}

/**
 * Extract mentioned players from text
 */
function extractMentions(text: string): string[] {
  const mentions = text.match(/@([^\s]+)/g);
  return mentions ? mentions.map((m) => m.slice(1)) : [];
}

/**
 * Enhanced conversation tracking evaluator that integrates with the strategy system
 * to track player interactions, mentions, and relationship signals.
 */
export const conversationTrackingEvaluator: Evaluator = {
  name: "SOCIAL_CONVERSATION_TRACKER",
  description:
    "Tracks conversations for strategic intelligence, player mentions, and relationship signals in the Influence game.",
  similes: [
    "SOCIAL_TRACKER",
    "RELATIONSHIP_BUILDER",
    "OBSERVE_MENTIONS",
    "INTELLIGENCE_GATHERER",
  ],

  /**
   * Run for any meaningful text message, with priority for mentions
   */
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    // Only validate basic message structure
    const content = message.content as { text?: unknown } | undefined;
    return !!(content?.text && typeof content.text === "string");
  },

  /**
   * Enhanced conversation tracking with strategic intelligence
   */
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<State | void> => {
    try {
      const strategyService = runtime.getService(
        "social-strategy",
      ) as StrategyService;
      if (!strategyService) {
        // Fall back to basic tracking if strategy service not available
        return {
          values: { tracked: true },
          data: { messageId: message.id },
          text: "Basic conversation tracking (no strategy service)",
        };
      }

      const text = message.content?.text as string;
      const speakerId = message.entityId;

      // Get entities to resolve names
      const entities = await runtime.getEntitiesForRoom(message.roomId);
      const speaker = entities.find((e) => e.id === speakerId);
      const speakerName = speaker?.names[0] || speakerId.slice(0, 8);

      let mentionsProcessed = 0;
      let relationshipsUpdated = 0;

      // Process @mentions for relationship signals
      if (hasMentions(text)) {
        const mentions = extractMentions(text);

        for (const mentionedName of mentions) {
          // Find the mentioned entity
          const mentionedEntity = entities.find((e) =>
            e.names.some(
              (name) => name.toLowerCase() === mentionedName.toLowerCase(),
            ),
          );

          if (mentionedEntity && mentionedEntity.id !== speakerId) {
            // Analyze sentiment of the mention
            const sentiment = analyzeMentionSentiment(text, mentionedName);
            const trustSignal = getTrustSignalFromSentiment(sentiment);

            // Update strategic relationship
            await strategyService.updateRelationship(
              mentionedEntity.id,
              mentionedEntity.names[0] || mentionedName,
              {
                trustLevel: trustSignal,
                notes: [`Mentioned in: "${text.substring(0, 100)}"`],
              },
            );

            // Also update the relationship from the mentioned player's perspective
            await strategyService.updateRelationship(speakerId, speakerName, {
              notes: [
                `Was mentioned by ${speakerName}: "${text.substring(0, 100)}"`,
              ],
            });

            mentionsProcessed++;
            relationshipsUpdated++;
          }
        }
      }

      // Analyze behavioral patterns from the message
      await analyzeBehavioralPatterns(
        runtime,
        message,
        entities,
        strategyService,
      );

      // Look for alliance or threat signals in the conversation
      const allianceSignals = detectAllianceSignals(text, entities, speakerId);
      const threatSignals = detectThreatSignals(text, entities, speakerId);

      // Update relationships based on detected signals
      for (const signal of allianceSignals) {
        const targetEntity = entities.find((e) => e.id === signal.targetId);
        if (targetEntity) {
          await strategyService.updateRelationship(
            signal.targetId,
            targetEntity.names[0],
            {
              trustLevel: TrustLevel.ALLY,
              alliances: [speakerId],
              notes: [`Alliance signal: ${signal.evidence}`],
            },
          );
          relationshipsUpdated++;
        }
      }

      for (const signal of threatSignals) {
        const targetEntity = entities.find((e) => e.id === signal.targetId);
        if (targetEntity) {
          await strategyService.updateRelationship(
            signal.targetId,
            targetEntity.names[0],
            {
              trustLevel: TrustLevel.THREAT,
              threat: Math.min(1, signal.threatLevel || 0.7),
              notes: [`Threat signal: ${signal.evidence}`],
            },
          );
          relationshipsUpdated++;
        }
      }

      logger.debug("[ConversationTracker] Processed conversation", {
        messageId: message.id,
        speakerName,
        mentionsProcessed,
        relationshipsUpdated,
        allianceSignals: allianceSignals.length,
        threatSignals: threatSignals.length,
      });

      return {
        values: {
          tracked: true,
          mentionsProcessed,
          relationshipsUpdated,
          allianceSignalsDetected: allianceSignals.length,
          threatSignalsDetected: threatSignals.length,
        },
        data: {
          messageId: message.id,
          speakerId,
          speakerName,
          allianceSignals,
          threatSignals,
        },
        text: `Tracked conversation: ${mentionsProcessed} mentions, ${relationshipsUpdated} relationships updated`,
      };
    } catch (error) {
      logger.error("[ConversationTracker] Error during tracking:", error);
      return {
        values: { tracked: false, error: true },
        data: { messageId: message.id, error: error.message },
        text: "Error tracking conversation",
      };
    }
  },

  examples: [
    {
      prompt: "@Alice you really saved my game last round!",
      messages: [
        {
          name: "Bob",
          content: {
            text: "@Alice you really saved my game last round!",
          },
        },
      ],
      outcome:
        "Updates strategic relationship: Bob trusts Alice more, potential alliance signal detected",
    },
    {
      prompt:
        "I can't believe @Charlie betrayed us… never trusting them again.",
      messages: [
        {
          name: "Dana",
          content: {
            text: "I can't believe @Charlie betrayed us… never trusting them again.",
          },
        },
      ],
      outcome:
        "Updates strategic relationship: Dana marks Charlie as threat, trust level decreased",
    },
    {
      prompt: "We need to work together @Bob and @Carol if we want to survive",
      messages: [
        {
          name: "Alex",
          content: {
            text: "We need to work together @Bob and @Carol if we want to survive",
          },
        },
      ],
      outcome: "Detects alliance formation signal between Alex, Bob, and Carol",
    },
  ],
};

function analyzeMentionSentiment(
  text: string,
  mentionedName: string,
): "positive" | "negative" | "neutral" {
  const lowerText = text.toLowerCase();
  const mentionIndex = lowerText.indexOf(`@${mentionedName.toLowerCase()}`);

  // Look at context around the mention
  const contextStart = Math.max(0, mentionIndex - 50);
  const contextEnd = Math.min(
    text.length,
    mentionIndex + mentionedName.length + 50,
  );
  const context = lowerText.slice(contextStart, contextEnd);

  const positiveWords = [
    "trust",
    "ally",
    "friend",
    "help",
    "support",
    "save",
    "protect",
    "good",
    "great",
    "awesome",
    "reliable",
    "loyal",
    "thanks",
  ];
  const negativeWords = [
    "betray",
    "enemy",
    "threat",
    "eliminate",
    "target",
    "hate",
    "bad",
    "terrible",
    "untrustworthy",
    "suspicious",
    "dangerous",
    "deceive",
  ];

  let positiveScore = 0;
  let negativeScore = 0;

  for (const word of positiveWords) {
    if (context.includes(word)) positiveScore++;
  }

  for (const word of negativeWords) {
    if (context.includes(word)) negativeScore++;
  }

  if (positiveScore > negativeScore) return "positive";
  if (negativeScore > positiveScore) return "negative";
  return "neutral";
}

function getTrustSignalFromSentiment(
  sentiment: "positive" | "negative" | "neutral",
): TrustLevel {
  switch (sentiment) {
    case "positive":
      return TrustLevel.ALLY;
    case "negative":
      return TrustLevel.THREAT;
    default:
      return TrustLevel.NEUTRAL;
  }
}

async function analyzeBehavioralPatterns(
  runtime: IAgentRuntime,
  message: Memory,
  entities: any[],
  strategyService: StrategyService,
): Promise<void> {
  const text = message.content?.text as string;
  const speakerId = message.entityId;

  // Analyze information sharing patterns
  let informationSharing: "open" | "selective" | "secretive" | "deceptive" =
    "selective";

  if (/everyone|all|public/i.test(text)) {
    informationSharing = "open";
  } else if (/secret|private|don't tell|between us/i.test(text)) {
    informationSharing = "secretive";
  } else if (/lie|deceive|trick|fool/i.test(text)) {
    informationSharing = "deceptive";
  }

  // Analyze alliance patterns
  let alliancePatterns: "loyal" | "opportunistic" | "betrayer" | "loner" =
    "loyal";

  if (/betray|abandon|leave/i.test(text)) {
    alliancePatterns = "betrayer";
  } else if (/opportunity|advantage|benefit/i.test(text)) {
    alliancePatterns = "opportunistic";
  } else if (/alone|solo|myself/i.test(text)) {
    alliancePatterns = "loner";
  }

  await strategyService.updatePlayerPattern(speakerId, {
    informationSharing,
    alliancePatterns,
  });
}

interface AllianceSignal {
  targetId: UUID;
  evidence: string;
  confidence: number;
}

interface ThreatSignal {
  targetId: UUID;
  evidence: string;
  threatLevel: number;
  confidence: number;
}

function detectAllianceSignals(
  text: string,
  entities: any[],
  speakerId: UUID,
): AllianceSignal[] {
  const signals: AllianceSignal[] = [];
  const lowerText = text.toLowerCase();

  // Alliance keywords
  const alliancePatterns = [
    /(?:team up|work together|alliance|partner) with (\w+)/i,
    /(?:you and me|we should|let's) (?:work|team|ally)/i,
    /(?:trust|support) (\w+)/i,
  ];

  for (const pattern of alliancePatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const targetName = match[1];
      // Only proceed if we have a valid target name
      if (targetName && targetName.length > 1) {
        const targetEntity = entities.find((e) =>
          e.names.some(
            (name: string) => name.toLowerCase() === targetName.toLowerCase(),
          ),
        );

        // Only create alliance signal if we found a valid entity
        if (targetEntity && targetEntity.id !== speakerId) {
          signals.push({
            targetId: targetEntity.id,
            evidence: text.substring(0, 100),
            confidence: 0.8,
          });
        }
      }
    }
  }

  return signals;
}

function detectThreatSignals(
  text: string,
  entities: any[],
  speakerId: UUID,
): ThreatSignal[] {
  const signals: ThreatSignal[] = [];
  const lowerText = text.toLowerCase();

  // Threat keywords and patterns
  const threatPatterns = [
    { pattern: /(?:eliminate|target|vote out) (\w+)/i, threatLevel: 0.9 },
    { pattern: /(\w+) (?:is|are) (?:dangerous|threat)/i, threatLevel: 0.8 },
    { pattern: /(?:don't trust|suspicious of) (\w+)/i, threatLevel: 0.6 },
    { pattern: /(\w+) (?:betrayed|deceived|lied)/i, threatLevel: 0.7 },
  ];

  for (const { pattern, threatLevel } of threatPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const targetName = match[1];
      // Only proceed if we have a valid target name
      if (targetName && targetName.length > 1) {
        const targetEntity = entities.find((e) =>
          e.names.some(
            (name: string) => name.toLowerCase() === targetName.toLowerCase(),
          ),
        );

        // Only create threat signal if we found a valid entity
        if (targetEntity && targetEntity.id !== speakerId) {
          signals.push({
            targetId: targetEntity.id,
            evidence: text.substring(0, 100),
            threatLevel,
            confidence: 0.8,
          });
        }
      }
    }
  }

  return signals;
}
