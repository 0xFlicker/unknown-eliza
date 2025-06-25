import { IAgentRuntime, Memory, stringToUuid, UUID } from "@elizaos/core";
import {
  PlayerEntity,
  PlayerRelationship,
  PlayerStatement,
  RelationshipType,
  SocialStrategyState,
} from "../types";
import { v4 as uuidv4 } from "uuid";
import { MemoryType } from "@elizaos/core";

const BASE_TRUST = 50;

/**
 * Obtain (or create) a PlayerEntity for the given handle.
 */
export async function getOrCreatePlayer({
  runtime,
  handle,
  metadata,
}: {
  runtime: IAgentRuntime;
  handle: string;
  metadata?: Partial<PlayerEntity["metadata"]>;
}): Promise<PlayerEntity> {
  const id = stringToUuid(`${runtime.agentId}:player:${handle.toLowerCase()}`);
  const entity = await runtime.getEntityById(id);
  if (entity) {
    return entity as PlayerEntity;
  }
  const now = Date.now();
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
      ...metadata,
    },
  };
  await runtime.createEntity(newPlayer);
  return newPlayer;
}

/**
 * Update or create the relationship record from source → target with the provided type.
 * This is stored bidirectionally by calling this method twice with swapped arguments.
 */
export async function upsertRelationship(
  runtime: IAgentRuntime,
  state: SocialStrategyState,
  sourceId: UUID,
  targetId: UUID,
  relType: RelationshipType,
  description: string
) {
  const now = Date.now();
  const existing = state.values.relationships.find(
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
  return newRel;
}

/**
 * Create a new PlayerStatement and append to state.
 */
export async function addStatement({
  runtime,
  state,
  message,
  speakerId,
  targetId,
  content,
  sentiment,
  trustScore,
  confidence,
}: {
  runtime: IAgentRuntime;
  state: SocialStrategyState;
  message: Memory;
  speakerId: UUID;
  targetId: UUID;
  content: string;
  sentiment: "positive" | "negative" | "neutral";
  trustScore: number;
  confidence: number;
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
      confidence,
      trustScore,
    },
    type: "social-strategy-statement",
    entityId: speakerId,
    roomId: message.roomId,
    worldId: message.worldId ?? runtime.agentId,
    sourceEntityId: targetId,
  };
  await runtime.createComponent(statement);

  // Also attach the component to the speaker entity so that runtime.getEntityById
  // returns the statement in its `components` array – several test helpers rely
  // on this convenience property.
  // const speakerEntity = await runtime.getEntityById(speakerId);
  // if (speakerEntity) {
  //   type EntityWithComponents = typeof speakerEntity & {
  //     components?: unknown[];
  //   };
  //   const entityWithComponents = speakerEntity as EntityWithComponents;
  //   const existingComponents = entityWithComponents.components ?? [];
  //   entityWithComponents.components = [...existingComponents, statement];
  //   await runtime.updateEntity(entityWithComponents);
  // }
}

export async function addFact({
  runtime,
  statement,
  message,
}: {
  runtime: IAgentRuntime;
  statement: PlayerStatement;
  message: Memory;
}): Promise<void> {
  const now = Date.now();
  // Build a simple fact claim from the statement content
  const claim = statement.data.content;
  const factMem: Memory = {
    id: stringToUuid(uuidv4()),
    entityId: runtime.agentId!,
    agentId: runtime.agentId!,
    roomId: message.roomId,
    content: { text: claim },
    createdAt: now,
    metadata: {
      type: MemoryType.CUSTOM,
      scope: "room",
      timestamp: now,
      tags: [],
    },
  };
  // Embed and persist the fact
  const embedded = await runtime.addEmbeddingToMemory(factMem);
  await runtime.createMemory(embedded, "facts", true);
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}
