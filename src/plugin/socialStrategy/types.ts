import { type State, type UUID } from "@elizaos/core";

export type RelationshipType = "ally" | "neutral" | "rival";

export interface PlayerEntity {
  id: UUID;
  handle: string;
  trustScore: number; // 0-100 scale
  firstInteraction: number; // timestamp
  lastInteraction: number; // timestamp
  metadata: {
    relationshipType: RelationshipType;
    interactionCount: number;
  };
}

export interface PlayerRelationship {
  sourcePlayerId: UUID;
  targetPlayerId: UUID;
  relationshipType: RelationshipType;
  strength: number; // 0-100 scale
  lastUpdated: number; // timestamp
  evidence: Array<{
    type:
      | "direct_interaction"
      | "observed_interaction"
      | "reported_interaction";
    timestamp: number;
    description: string;
    source: UUID;
  }>;
}

export interface PlayerStatement {
  id: UUID;
  speakerId: UUID;
  targetId: UUID;
  content: string;
  timestamp: number;
  metadata: {
    sentiment?: string;
    confidence?: number;
    [key: string]: any;
  };
}

export interface SocialStrategyState extends State {
  players: Record<UUID, PlayerEntity>;
  relationships: PlayerRelationship[];
  statements: PlayerStatement[];
  metadata: {
    lastAnalysis: number;
    version: string;
  };
  values: Record<string, any>;
  data: Record<string, any>;
  text: string;
}
