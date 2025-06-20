import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type State,
  validateUuid,
  asUUID,
  ModelType,
  logger,
  normalizeJsonString,
} from "@elizaos/core";
import type {
  PlayerEntity,
  PlayerRelationship,
  PlayerStatement,
  RelationshipType,
} from "../types";
import {
  formatHandles,
  SocialStrategyPromptBuilder,
  type ModelWorkload,
  buildAnalysisPrompt,
  AnalysisResult,
} from "../promptManager";
import { getParticipantsForRoom } from "../../safeUtils";

// Sentiment ↔ Relationship helpers
function sentimentToRelationship(
  sentiment: "positive" | "negative" | "neutral"
): RelationshipType {
  if (sentiment === "positive") return "ally";
  if (sentiment === "negative") return "rival";
  return "neutral";
}

function extractMentions(text: string): string[] {
  // Allow any non-whitespace character after an @ sign
  const regex = /@(\S+)/g;
  const out: string[] = [];
  let match: RegExpExecArray | null = null;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(text)) !== null) {
    out.push(match[1]);
  }
  return out;
}

// Start of Selection
/**
 * Parses a JSON object from a given text. The function looks for a JSON block wrapped in triple backticks
 * with `json` language identifier, and if not found, it searches for an object pattern within the text.
 * It then attempts to parse the JSON string into a JavaScript object. If parsing is successful and the result
 * is an object (but not an array), it returns the object; otherwise, it tries to parse an array if the result
 * is an array, or returns null if parsing is unsuccessful or the result is neither an object nor an array.
 *
 * @param text - The input text from which to extract and parse the JSON object.
 * @returns An object parsed from the JSON string if successful; otherwise, null or the result of parsing an array.
 */
export function parseJSONObjectFromText(
  text: string
): Record<string, any> | null {
  let jsonData = null;
  let jsonString = text.trim();

  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.slice(7).trim();
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.slice(0, -3).trim();
  }

  try {
    jsonData = JSON.parse(jsonString);
  } catch (_e) {
    logger.info(`🔍 Error parsing JSON string: ${_e}`);
    return null; // Keep null return on error
  }

  return jsonData;
}

export const socialContextProvider: Provider = {
  name: "social-context",
  description:
    "Provides formatted social context (players, trust scores, relationships, recent statements) and performs per-message sentiment analysis.",
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const now = Date.now();
    logger.info(`🔍 Building social context for room ${message.roomId}`);

    const { roomId } = message;
    // -----------------------------------------
    // 1. Pull participants & build initial map
    // -----------------------------------------
    const participantIds = await getParticipantsForRoom(runtime, roomId);
    const playerMap: Record<string, PlayerEntity> = {};
    for (const id of participantIds) {
      if (!id) continue;
      const entity = await runtime.getEntityById(id);
      if (entity) playerMap[id] = entity as PlayerEntity;
    }
    logger.info(
      `🗺️ Player map initialized with ${Object.keys(playerMap).length} players: ${Object.keys(playerMap).join(", ")}`
    );

    // -----------------------------------------
    // 2. Runtime relationships and statements
    // -----------------------------------------
    const relSet = new Set<string>();
    const runtimeRelationships: PlayerRelationship[] = [];
    for (const id of Object.keys(playerMap)) {
      if (!validateUuid(id)) continue;
      const rels = await runtime.getRelationships({ entityId: asUUID(id) });
      for (const r of rels) {
        const key = `${r.sourceEntityId}-${r.targetEntityId}`;
        if (relSet.has(key)) continue;
        relSet.add(key);
        runtimeRelationships.push(r as PlayerRelationship);
      }
    }
    logger.info(
      `🔗 Loaded ${runtimeRelationships.length} relationships from runtime`
    );

    const runtimeStatements: PlayerStatement[] = [];
    for (const id of Object.keys(playerMap)) {
      if (!validateUuid(id)) continue;
      const comps = await runtime.getComponents(asUUID(id));
      for (const c of comps) {
        if (c.type === "social-strategy-statement")
          runtimeStatements.push(c as PlayerStatement);
      }
    }
    logger.info(
      `💬 Loaded ${runtimeStatements.length} statements from runtime`
    );

    // ------------------------------------------------------
    // 3. Per-message sentiment / relationship pre-processing
    // ------------------------------------------------------
    let newSentiments: Array<{
      speaker: PlayerEntity;
      target: PlayerEntity;
      sentiment: "positive" | "negative" | "neutral";
      trustScore: number;
      confidence: number;
    }> = [];

    /*
     * Use LLM-powered analysis for every message containing @mentions.  We
     * rely on `buildAnalysisPrompt` (shared with the action) to obtain a JSON
     * payload describing trust score, relationship label, and sentiment.
     */
    const text = message.content.text as string;
    const mentions = extractMentions(text);
    if (mentions.length) {
      const speakerHandle =
        (message.metadata as any)?.entityName ??
        (message.metadata as any)?.username ??
        message.entityId;
      const prompt = buildAnalysisPrompt(text, speakerHandle, mentions);

      try {
        const raw = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt,
          temperature: 0.3,
          maxTokens: 512,
        });
        const parsed = parseJSONObjectFromText(
          raw ?? "[]"
        ) as AnalysisResult | null;

        for (const p of parsed ?? []) {
          const sentiment = (p.sentiment ?? "neutral") as
            | "positive"
            | "negative"
            | "neutral";
          const confidence = p.confidence ?? 0.1;
          const trustScore = p.trustScore ?? 50;

          const speaker =
            playerMap[speakerHandle] ??
            Object.values(playerMap).find((p) =>
              p.names?.some(
                (n) => n.toLowerCase() === speakerHandle.toLowerCase()
              )
            );

          const targetHandle = p.handle;
          const target = Object.values(playerMap).find((p) =>
            p.names?.some((n) => n.toLowerCase() === targetHandle.toLowerCase())
          );
          if (speaker && target) {
            newSentiments.push({
              speaker,
              target,
              sentiment,
              trustScore,
              confidence,
            });
            logger.info(
              `🆕 Sentiment detected: ${speaker.names?.[0] ?? speaker.id} → ${target.names?.[0] ?? target.id} (${sentiment}, ${trustScore}, ${confidence})`
            );
          } else {
            logger.warn(
              `🔍 No speaker or target found for handle: ${speakerHandle} → ${targetHandle}`
            );
          }
        }
      } catch (err) {
        logger.warn("AI analysis failed", err);
      }
    }

    // -------------------------------------------------------------------
    // 4. Merge sentiments into state so actions can persist them later
    // -------------------------------------------------------------------
    if (state) {
      const s = state as Record<string, any>;
      s.__socialStrategy = s.__socialStrategy ?? {};
      s.__socialStrategy.recentSentiments = newSentiments;
      logger.info(`📥 Stored ${newSentiments.length} new sentiments in state`);
    }

    // ----------------------------------------------------
    // 6. Build provider output values
    // ----------------------------------------------------
    const players = Object.values(playerMap);
    const relationships = [...runtimeRelationships];
    const recentStatements = runtimeStatements.slice(-5);
    const duration = Date.now() - now;
    logger.info(
      `✅ Context ready: players=${players.length}, relationships=${relationships.length}, statements=${recentStatements.length}, sentiments=${newSentiments.length}, duration=${duration}ms`
    );

    return {
      text: "", // provider primarily returns structured values; prompt injection not required here
      values: {
        players,
        relationships,
        statements: recentStatements,
      },
      data: {
        newSentiments,
      },
    };
  },
};
