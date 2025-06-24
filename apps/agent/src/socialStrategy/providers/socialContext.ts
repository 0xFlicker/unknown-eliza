import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type State,
  validateUuid,
  asUUID,
  ModelType,
  normalizeJsonString,
  stringToUuid,
  UUID,
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
import { getOrCreatePlayer } from "../runtime/memory";

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
    console.log(`🔍 Error parsing JSON string: ${_e}`);
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
    console.log(`🔍 Building social context for room ${message.roomId}`);

    const { roomId } = message;

    // -----------------------------------------
    // 1. Pull participants & build initial map
    // -----------------------------------------
    const participantIds = await getParticipantsForRoom(runtime, roomId);
    const playerMap: Record<string, PlayerEntity> = {};
    for (const id of participantIds) {
      if (!id) continue;
      const entity = await runtime.getEntityById(id);
      if (entity) {
        for (const name of entity.names) {
          playerMap[name] = {
            ...entity,
            id: entity.id!,
            metadata: {
              ...entity.metadata,
              ...("metadata" in entity
                ? entity.metadata
                : {
                    new: true,
                    relationshipType: "neutral",
                    interactionCount: 0,
                    trustScore: 50,
                    firstInteraction: now,
                    lastInteraction: now,
                  }),
            } as PlayerEntity["metadata"],
          };
        }
      }
    }
    if (Object.keys(playerMap).length > 0) {
      console.log(
        `🗺️ Player map initialized with ${Object.keys(playerMap).length} players}`
      );
    }

    // -----------------------------------------
    // 2. Runtime relationships and statements
    // -----------------------------------------
    const relSet = new Set<string>();
    const runtimeRelationships: PlayerRelationship[] = [];
    const newRelationships: Omit<PlayerRelationship, "id" | "agentId">[] = [];
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
    if (runtimeRelationships.length > 0) {
      console.log(
        `🔗 Loaded ${runtimeRelationships.length} relationships from runtime`
      );
    }

    const runtimeStatements: PlayerStatement[] = [];
    for (const id of Object.keys(playerMap)) {
      if (!validateUuid(id)) continue;
      const comps = await runtime.getComponents(asUUID(id));
      for (const c of comps) {
        if (c.type === "social-strategy-statement")
          runtimeStatements.push(c as PlayerStatement);
      }
    }
    if (runtimeStatements.length > 0) {
      console.log(
        `💬 Loaded ${runtimeStatements.length} statements from runtime`
      );
    }
    const currentHandles = [
      ...new Set(
        Object.values(playerMap)
          .map((p) => p.names)
          .flat()
      ),
    ];
    // Now add the TestPlayer
    if (!currentHandles.includes("TestPlayer")) {
      const testPlayer = await getOrCreatePlayer({
        runtime,
        handle: "TestPlayer",
        metadata: {
          new: true,
        },
      });

      playerMap["TestPlayer"] = testPlayer;
      currentHandles.push("TestPlayer");
    }

    // ------------------------------------------------------
    // 3. Per-message sentiment / relationship pre-processing
    // ------------------------------------------------------
    /*
     * Use LLM-powered analysis for every message containing @mentions.  We
     * rely on `buildAnalysisPrompt` (shared with the action) to obtain a JSON
     * payload describing trust score, relationship label, and sentiment.
     */
    const text = message.content?.text ?? "";
    const mentions = extractMentions(text);

    // Now map handles to entityIds and see if we need to make a new player
    const newHandles = mentions.filter((m) => !currentHandles.includes(m));
    for (const handle of newHandles) {
      console.log(`🔍 New handle: ${handle}`);
      const newPlayer: PlayerEntity = {
        id: stringToUuid(`${runtime.agentId}:player:${handle}`),
        agentId: runtime.agentId,
        names: [handle],
        metadata: {
          trustScore: 50,
          firstInteraction: now,
          lastInteraction: now,
          relationshipType: "neutral",
          interactionCount: 1,
        },
      };
      playerMap[handle] = newPlayer;
    }
    const allHandles = [...currentHandles, ...newHandles];

    if (mentions.length) {
      // log with emoji
      console.log(`🔍 Handles mentioned: ${mentions.join(", ")}`);
      const speakerHandle: string =
        (message.metadata as any)?.entityName ??
        (message.metadata as any)?.username ??
        (message.metadata as any)?.raw?.senderName ??
        message.entityId ??
        "UNKNOWN";
      playerMap[speakerHandle] = playerMap[speakerHandle] ?? {
        id: stringToUuid(`${runtime.agentId}:player:${speakerHandle}`),
        agentId: runtime.agentId,
        names: [speakerHandle],
        metadata: {
          trustScore: 50,
          firstInteraction: now,
          lastInteraction: now,
          relationshipType: "neutral",
          interactionCount: 1,
          new: true,
        },
      };
      const prompt = buildAnalysisPrompt(text, speakerHandle, mentions);

      try {
        const raw = await runtime.useModel(ModelType.TEXT_SMALL, {
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

          const targetHandle = p.handle;
          const target = Object.values(playerMap).find((p) =>
            p.names?.some((n) => n.toLowerCase() === targetHandle.toLowerCase())
          );
          const speaker = playerMap[speakerHandle];
          if (speaker && target) {
            const now = Date.now();
            const statementId = stringToUuid(
              `statement:${speaker.id}:${target.id}:${now}`
            );
            const statement: PlayerStatement = {
              id: statementId,
              agentId: runtime.agentId,
              createdAt: now,
              data: {
                content: p.statement,
                speakerEntityId: speaker.id,
                targetEntityId: target.id,
                timestamp: now,
                sentiment,
                confidence,
                trustScore,
              },
              type: "social-strategy-statement",
              entityId: speaker.id,
              roomId: message.roomId,
              worldId: message.worldId ?? runtime.agentId,
              sourceEntityId: target.id,
            };
            runtimeStatements.push(statement);
            // --- Relationship update logic (inline, inspired by upsertRelationship) ---
            const relType = sentimentToRelationship(sentiment);
            const description = `Sentiment '${sentiment}' detected in message: \"${text}\"`;
            // Check if relationship exists in runtimeRelationships
            let rel = runtimeRelationships.find(
              (r) =>
                r.sourceEntityId === speaker.id &&
                r.targetEntityId === target.id
            );
            if (rel) {
              // Update existing relationship
              rel.metadata.relationshipType = relType;
              rel.metadata.lastUpdated = now;
              rel.metadata.strength = Math.min(
                (rel.metadata.strength ?? 0) + 1,
                100
              );
              rel.metadata.evidence.push({
                type: "direct_interaction",
                timestamp: now,
                description,
                source: speaker.id,
              });
              rel.metadata.needsSave = true;
            } else {
              const newRel: Omit<PlayerRelationship, "id" | "agentId"> = {
                tags: [relType],
                sourceEntityId: speaker.id,
                targetEntityId: target.id,
                metadata: {
                  new: true,
                  relationshipType: relType,
                  strength: 1,
                  lastUpdated: now,
                  evidence: [
                    {
                      type: "direct_interaction",
                      timestamp: now,
                      description,
                      source: speaker.id,
                    },
                  ],
                },
              };
              newRelationships.push(newRel);
            }

            console.log(
              `🆕 New sentiment detected: ${speaker.names && speaker.names[0] ? speaker.names[0] : speaker.id} → ${target.names && target.names[0] ? target.names[0] : target.id} (${sentiment}, ${trustScore}, ${confidence})`
            );
          } else {
            console.log(
              `🔍 No speaker or target found for handle: ${speakerHandle} → ${targetHandle}`
            );
          }
        }
      } catch (err) {
        console.warn("AI analysis failed", err);
      }
    }

    // ----------------------------------------------------
    // 6. Build provider output values
    // ----------------------------------------------------
    const players = [...new Set(Object.values(playerMap))];
    const relationships = [...runtimeRelationships, ...newRelationships];
    const duration = Date.now() - now;
    console.log(
      `✅ Context ready: players=${players.length}, relationships=${relationships.length}, statements=${runtimeStatements.length}, duration=${duration}ms`
    );

    return {
      text: "", // provider primarily returns structured values; prompt injection not required here
      values: {
        players,
        relationships,
        statements: runtimeStatements,
      },
    };
  },
};
