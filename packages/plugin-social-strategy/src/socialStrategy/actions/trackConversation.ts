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
function getOrCreatePlayer(
  state: SocialStrategyState,
  agentId: string,
  handle: string
): PlayerEntity {
  const id = stringToUuid(`${agentId}:player:${handle.toLowerCase()}`);
  const now = Date.now();
  const existing = state.players[id];
  if (existing) {
    existing.lastInteraction = now;
    existing.metadata.interactionCount += 1;
    return existing;
  }
  const newPlayer: PlayerEntity = {
    id,
    handle,
    trustScore: BASE_TRUST,
    firstInteraction: now,
    lastInteraction: now,
    metadata: {
      relationshipType: "neutral",
      interactionCount: 1,
    },
  };
  state.players[id] = newPlayer;
  return newPlayer;
}

/**
 * Update or create the relationship record from source → target with the provided type.
 * This is stored bidirectionally by calling this method twice with swapped arguments.
 */
function upsertRelationship(
  state: SocialStrategyState,
  sourceId: UUID,
  targetId: UUID,
  relType: RelationshipType,
  description: string
): void {
  const now = Date.now();
  const existing = state.relationships.find(
    (r) => r.sourcePlayerId === sourceId && r.targetPlayerId === targetId
  );
  if (existing) {
    existing.relationshipType = relType;
    existing.lastUpdated = now;
    existing.strength = clamp(existing.strength + 1, 0, 100);
    existing.evidence.push({
      type: "direct_interaction",
      timestamp: now,
      description,
      source: sourceId,
    });
    return;
  }
  const newRel: PlayerRelationship = {
    sourcePlayerId: sourceId,
    targetPlayerId: targetId,
    relationshipType: relType,
    strength: 1,
    lastUpdated: now,
    evidence: [
      {
        type: "direct_interaction",
        timestamp: now,
        description,
        source: sourceId,
      },
    ],
  };
  state.relationships.push(newRel);
}

/**
 * Create a new PlayerStatement and append to state.
 */
function addStatement(
  state: SocialStrategyState,
  speakerId: UUID,
  targetId: UUID,
  content: string,
  sentiment: "positive" | "negative" | "neutral"
): void {
  const now = Date.now();
  const statementId = stringToUuid(`statement:${speakerId}:${targetId}:${now}`);
  const statement: PlayerStatement = {
    id: statementId,
    speakerId,
    targetId,
    content,
    timestamp: now,
    metadata: { sentiment, confidence: 1 },
  };
  state.statements.push(statement);
}

export const trackConversationHandler = async (
  runtime: IAgentRuntime,
  message: Memory,
  state?: State
) => {
  // Ensure we have a SocialStrategyState container on the shared state object.
  const container = state as Record<string, unknown>;
  if (!("socialStrategyState" in container)) {
    container.socialStrategyState = {
      players: {},
      relationships: [],
      statements: [],
      metadata: { lastAnalysis: 0, version: "1.0.0" },
      values: {},
      data: {},
      text: "",
    } satisfies SocialStrategyState;
  }
  const socialState = container.socialStrategyState as SocialStrategyState;

  const textContent = (message.content as { text: string }).text;

  // Identify speaking player handle. Prefer metadata.username, fall back to entityId string.
  const username =
    ((message.metadata ?? {}) as { username?: string }).username ??
    message.entityId;

  const speakingPlayer = getOrCreatePlayer(
    socialState,
    runtime.agentId,
    username
  );

  // Extract mentions and process each
  const mentionedHandles = extractMentions(textContent);
  if (mentionedHandles.length === 0) {
    speakingPlayer.lastInteraction = Date.now();
    socialState.metadata.lastAnalysis = Date.now();
    return { success: true, message: "No player mentions found." };
  }

  logger.info(`${mentionedHandles.length} mentioned handles`);

  for (const targetHandle of mentionedHandles) {
    const targetPlayer = getOrCreatePlayer(
      socialState,
      runtime.agentId,
      targetHandle
    );

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

    // Update trust score of the TARGET based on sentiment
    if (relationshipType === "ally") {
      targetPlayer.trustScore = clamp(
        targetPlayer.trustScore + TRUST_DELTA,
        0,
        100
      );
    } else if (relationshipType === "rival") {
      targetPlayer.trustScore = clamp(
        targetPlayer.trustScore - TRUST_DELTA,
        0,
        100
      );
    }

    // Upsert relationship in both directions
    const description = `Sentiment '${sentiment}' detected in message: "${textContent}"`;
    upsertRelationship(
      socialState,
      speakingPlayer.id,
      targetPlayer.id,
      relationshipType,
      description
    );
    upsertRelationship(
      socialState,
      targetPlayer.id,
      speakingPlayer.id,
      relationshipType,
      description
    );

    // Persist relationship in database for provider lookup
    try {
      await runtime.createRelationship({
        sourceEntityId: speakingPlayer.id,
        targetEntityId: targetPlayer.id,
        tags: [relationshipType],
        metadata: { strength: 1 },
      });
      await runtime.createRelationship({
        sourceEntityId: targetPlayer.id,
        targetEntityId: speakingPlayer.id,
        tags: [relationshipType],
        metadata: { strength: 1 },
      });
    } catch {
      /* ignore adapter limitations */
    }

    // Add statement record
    addStatement(
      socialState,
      speakingPlayer.id,
      targetPlayer.id,
      textContent,
      sentiment
    );
  }

  socialState.metadata.lastAnalysis = Date.now();

  return {
    success: true,
    message: "Conversation tracked",
    data: socialState,
  };
};

export const trackConversation: Action = {
  name: "trackConversation",
  description:
    "Analyze a message, identify player mentions, infer sentiment, and update the player graph.",
  similes: ["SSA_TRACK"],
  examples: [],
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
