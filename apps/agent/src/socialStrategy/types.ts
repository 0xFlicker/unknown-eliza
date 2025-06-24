import {
  Component,
  Entity,
  Metadata,
  Relationship,
  type State,
  type UUID,
} from "@elizaos/core";

export type RelationshipType = "ally" | "neutral" | "rival";
export type Sentiment = "positive" | "negative" | "neutral";
export type EvidenceType =
  | "direct_interaction"
  | "observed_interaction"
  | "reported_interaction";

export interface PlayerEntity extends Entity {
  id: UUID;
  metadata: {
    relationshipType: RelationshipType;
    interactionCount: number;
    trustScore: number; // 0-100 scale
    firstInteraction: number; // timestamp
    lastInteraction: number; // timestamp
    new?: boolean;
  };
}

export interface PlayerRelationshipMetadata extends Metadata {
  relationshipType: RelationshipType;
  strength: number; // 0-100 scale
  lastUpdated: number; // timestamp
  evidence: Array<{
    type: EvidenceType;
    timestamp: number;
    description: string;
    source: UUID;
  }>;
}

export interface PlayerRelationship extends Relationship {
  metadata: PlayerRelationshipMetadata;
}

export interface PlayerStatement extends Component {
  type: "social-strategy-statement";
  data: {
    speakerEntityId: UUID;
    targetEntityId: UUID;
    content: string;
    timestamp: number;
    sentiment: "positive" | "negative" | "neutral";
    trustScore: number;
    confidence: number;
  };
}

// export interface SocialStrategyState extends State {
//   players: Record<UUID, PlayerEntity>;
//   relationships: PlayerRelationship[];
//   statements: PlayerStatement[];
//   metadata: {
//     lastAnalysis: number;
//     version: string;
//   };
//   values: Record<string, string | number | boolean>;
//   data: Record<string, string | number | boolean>;
//   text: string;
// }

export interface SocialStrategyState extends State {
  values: {
    players: Record<UUID, PlayerEntity>;
    relationships: PlayerRelationship[];
    statements: PlayerStatement[];
  };
}
