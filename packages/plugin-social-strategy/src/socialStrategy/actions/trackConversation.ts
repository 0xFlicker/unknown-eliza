import {
  type Action,
  type IAgentRuntime,
  type Memory,
  State,
  type UUID,
  stringToUuid,
  elizaLogger,
} from "@elizaos/core";
import {
  SocialStrategyState,
  PlayerEntity,
  PlayerRelationship,
  PlayerStatement,
  RelationshipType,
} from "../types";
import { safeAddParticipant } from "../../safeUtils";

// Create a child logger specifically for this action with additional context.
// Logs throughout this file use expressive emoji prefixes (🚀, ✅, ⚠️, 🔍, 🔗, 👀, 🗣️) so that important
// milestones stand out clearly when scanning log output.
const logger = elizaLogger.child({
  plugin: "social-strategy",
  action: "trackConversation",
});

/**
 * Baseline trust score assigned to newly discovered players.
 */
const BASE_TRUST = 50;

/** Keyword lists for naive sentiment analysis */
const POSITIVE_KEYWORDS = [
  "trust",
  "like",
  "love",
  "ally",
  "friend",
  "support",
  "help",
  "agree",
];
const NEGATIVE_KEYWORDS = [
  "distrust",
  "hate",
  "dislike",
  "enemy",
  "rival",
  "betray",
  "oppose",
  "against",
];

/** Max absolute change applied to a trust score from one interaction */
const TRUST_DELTA = 10;

/**
 * Helper – clamp a number into an inclusive range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Extract @mentions from a string.
 */
function extractMentions(text: string): string[] {
  const regex = /@([a-zA-Z0-9_]+)/g;
  const out: string[] = [];
  let match: RegExpExecArray | null = null;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(text)) !== null) {
    out.push(match[1]);
  }
  return out;
}

/**
 * Infer the sentiment (positive / negative / neutral) of a message towards a target player
 * using a very simple keyword-based heuristic.
 */
function inferSentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
  if (POSITIVE_KEYWORDS.some((w) => lower.includes(w))) return "positive";
  if (NEGATIVE_KEYWORDS.some((w) => lower.includes(w))) return "negative";
  return "neutral";
}

/**
 * Maps a sentiment into our RelationshipType domain.
 */
function sentimentToRelationship(
  sentiment: "positive" | "negative" | "neutral"
): RelationshipType {
  if (sentiment === "positive") return "ally";
  if (sentiment === "negative") return "rival";
  return "neutral";
}

/**
 * Obtain (or create) a PlayerEntity for the given handle.
 */
async function getOrCreatePlayer(
  runtime: IAgentRuntime,
  state: SocialStrategyState,
  handle: string
): Promise<PlayerEntity> {
  const id = stringToUuid(`${runtime.agentId}:player:${handle.toLowerCase()}`);
  const entity = await runtime.getEntityById(id);
  if (entity) {
    return entity as PlayerEntity;
  }
  const now = Date.now();
  const existing = state.players[id];
  if (existing) {
    existing.metadata.lastInteraction = now;
    existing.metadata.interactionCount += 1;
    return existing;
  }
  const newPlayer: PlayerEntity = {
    id,
    agentId: runtime.agentId,
    names: [handle],
    metadata: {
      trustScore: BASE_TRUST,
      firstInteraction: now,
      lastInteraction: now,
      relationshipType: "neutral",
      interactionCount: 1,
    },
  };
  state.players[id] = newPlayer;
  await runtime.createEntity(newPlayer);
  return newPlayer;
}

/**
 * Update or create the relationship record from source → target with the provided type.
 * This is stored bidirectionally by calling this method twice with swapped arguments.
 */
async function upsertRelationship(
  runtime: IAgentRuntime,
  state: SocialStrategyState,
  sourceId: UUID,
  targetId: UUID,
  relType: RelationshipType,
  description: string
) {
  const now = Date.now();
  const existing = state.relationships.find(
    (r) => r.sourceEntityId === sourceId && r.targetEntityId === targetId
  );
  if (existing) {
    existing.metadata.relationshipType = relType;
    existing.metadata.lastUpdated = now;
    existing.metadata.strength = clamp(existing.metadata.strength + 1, 0, 100);
    existing.metadata.evidence.push({
      type: "direct_interaction",
      timestamp: now,
      description,
      source: sourceId,
    });
    return;
  }
  const newRel = {
    agentId: runtime.agentId,
    tags: [relType],
    sourceEntityId: sourceId,
    targetEntityId: targetId,
    metadata: {
      relationshipType: relType,
      strength: 1,
      lastUpdated: now,
      evidence: [
        {
          type: "direct_interaction" as const,
          timestamp: now,
          description,
          source: sourceId,
        },
      ],
    },
  };

  // Persist relationship in database for provider lookup
  let [existingRelationShipA, existingRelationShipB] = await Promise.all([
    runtime.getRelationship({
      sourceEntityId: sourceId,
      targetEntityId: targetId,
    }),
    runtime.getRelationship({
      sourceEntityId: targetId,
      targetEntityId: sourceId,
    }),
  ]);
  const [existingPlayerRelationShipA, existingPlayerRelationShipB] =
    await Promise.all([
      (existingRelationShipA
        ? runtime.updateRelationship(existingRelationShipA)
        : runtime.createRelationship({
            sourceEntityId: sourceId,
            targetEntityId: targetId,
            tags: [relType],
            metadata: newRel.metadata,
          })
      ).then(async () => {
        const relationship = await runtime.getRelationship({
          sourceEntityId: sourceId,
          targetEntityId: targetId,
        });
        return { ...relationship! } as PlayerRelationship;
      }),
      (existingRelationShipB
        ? runtime.updateRelationship(existingRelationShipB)
        : runtime.createRelationship({
            sourceEntityId: targetId,
            targetEntityId: sourceId,
            tags: [relType],
            metadata: newRel.metadata,
          })
      ).then(async () => {
        const relationship = await runtime.getRelationship({
          sourceEntityId: targetId,
          targetEntityId: sourceId,
        });
        return { ...relationship! } as PlayerRelationship;
      }),
    ]);
  await runtime.createRelationship({
    sourceEntityId: sourceId,
    targetEntityId: targetId,
    tags: [relType],
    metadata: newRel.metadata,
  });
  await runtime.createRelationship({
    sourceEntityId: targetId,
    targetEntityId: sourceId,
    tags: [relType],
    metadata: newRel.metadata,
  });
  state.relationships.push(existingPlayerRelationShipA);
  state.relationships.push(existingPlayerRelationShipB);
  return newRel;
}

/**
 * Create a new PlayerStatement and append to state.
 */
async function addStatement({
  runtime,
  state,
  message,
  speakerId,
  targetId,
  content,
  sentiment,
}: {
  runtime: IAgentRuntime;
  state: SocialStrategyState;
  message: Memory;
  speakerId: UUID;
  targetId: UUID;
  content: string;
  sentiment: "positive" | "negative" | "neutral";
}): Promise<void> {
  const now = Date.now();
  const statementId = stringToUuid(`statement:${speakerId}:${targetId}:${now}`);
  const statement: PlayerStatement = {
    id: statementId,
    agentId: runtime.agentId,
    createdAt: now,
    data: {
      content,
      speakerEntityId: speakerId,
      targetEntityId: targetId,
      timestamp: now,
      sentiment,
      confidence: 1,
    },
    type: "social-strategy-statement",
    entityId: speakerId,
    roomId: message.roomId,
    worldId: message.worldId ?? runtime.agentId,
    sourceEntityId: targetId,
  };
  logger.info(`Adding statement: ${JSON.stringify(statement, null, 2)}`);
  state.statements.push(statement);
  await runtime.createComponent(statement);
}

export const trackConversationHandler = async (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
) => {
  logger.info(`🚀 Starting conversation tracking | room: ${message.roomId}`);
  const socialState: SocialStrategyState = {
    players: {},
    relationships: [],
    statements: [],
    metadata: { lastAnalysis: 0, version: "1.0.0" },
    values: {},
    data: {},
    text: "",
  };

  const textContent = (message.content as { text: string }).text;
  logger.info(`📝 Message content: "${textContent}"`);

  // Identify speaking player handle. Prefer metadata.username, fall back to entityId string.
  const username =
    ((message.metadata ?? {}) as { username?: string }).username ??
    message.entityId;

  const speakingPlayer = await getOrCreatePlayer(
    runtime,
    socialState,
    username
  );
  logger.info(`🎤 Speaker identified: ${username} (${speakingPlayer.id})`);

  // Extract mentions and process each
  const mentionedHandles = extractMentions(textContent);
  if (mentionedHandles.length === 0) {
    speakingPlayer.metadata.lastInteraction = Date.now();
    socialState.metadata.lastAnalysis = Date.now();
    logger.info("✅ No player mentions found – nothing to update.");
    return { success: true, message: "No player mentions found." };
  }

  logger.info(
    `👀 Found ${mentionedHandles.length} mention(s): ${mentionedHandles.join(", ")}`
  );

  for (const targetHandle of mentionedHandles) {
    const targetPlayer = await getOrCreatePlayer(
      runtime,
      socialState,
      targetHandle
    );

    logger.info(`➡️  Processing mention '@${targetHandle}'`);

    // Ensure target player connection as well
    await safeAddParticipant({
      runtime,
      entityId: targetPlayer.id,
      roomId: message.roomId,
      worldId: message.worldId ?? runtime.agentId,
    });

    // Infer sentiment and relationship type
    const sentiment = inferSentiment(textContent);
    const relationshipType = sentimentToRelationship(sentiment);

    logger.info(
      `🔍 Sentiment toward @${targetHandle}: ${sentiment} → relationship '${relationshipType}'`
    );

    // Update trust score of the TARGET based on sentiment
    let trustChange = 0;
    if (relationshipType === "ally") {
      trustChange = TRUST_DELTA;
      targetPlayer.metadata.trustScore = clamp(
        targetPlayer.metadata.trustScore + TRUST_DELTA,
        0,
        100
      );
    } else if (relationshipType === "rival") {
      trustChange = -TRUST_DELTA;
      targetPlayer.metadata.trustScore = clamp(
        targetPlayer.metadata.trustScore - TRUST_DELTA,
        0,
        100
      );
    }

    if (trustChange !== 0) {
      const emoji = trustChange > 0 ? "✅" : "⚠️";
      logger.info(
        `${emoji} Trust score for @${targetHandle} ${trustChange > 0 ? "increased" : "decreased"} by ${Math.abs(
          trustChange
        )} → ${targetPlayer.metadata.trustScore}`
      );
    }

    // Upsert relationship in both directions
    const description = `Sentiment '${sentiment}' detected in message: "${textContent}"`;
    await upsertRelationship(
      runtime,
      socialState,
      speakingPlayer.id,
      targetPlayer.id,
      relationshipType,
      description
    );

    logger.info(
      `🔗 Relationship recorded: ${username} → ${targetHandle} (${relationshipType})`
    );

    // Add statement record
    await addStatement({
      runtime,
      state: socialState,
      message,
      speakerId: speakingPlayer.id,
      targetId: targetPlayer.id,
      content: textContent,
      sentiment,
    });

    logger.info(`🗣️  Statement logged for interaction with @${targetHandle}`);
  }

  logger.info("🏁 Conversation tracking completed.");
};

export const trackConversation: Action = {
  name: "trackConversation",
  description:
    "Analyze a message, identify player mentions, infer sentiment, and update the player graph. Called whenever a user mentions another player.",
  similes: ["UPDATE_SENTIMENT", "NOTICE_MENTION"],
  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "What do you think of @OtherPlayer?",
          actions: ["NOTICE_MENTION"],
        },
      },
      {
        name: "{{user}}",
        content: {
          text: "I think @OtherPlayer is {{sentiment}}.",
          actions: ["UPDATE_SENTIMENT"],
        },
      },
    ],
  ],
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    return (
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof (message.content as { text: unknown }).text === "string"
    );
  },
  handler: trackConversationHandler,
};
