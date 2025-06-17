import { type State } from "@elizaos/core";

export interface PlayerEntity {
  id: string;
  handle: string;
  trustScore: number; // 0-100 scale
  firstInteraction: number; // timestamp
  lastInteraction: number; // timestamp
  metadata: {
    relationshipType?: "ally" | "enemy" | "neutral";
    interactionCount: number;
    notes?: string[];
  };
}

export interface PlayerRelationship {
  sourcePlayerId: string;
  targetPlayerId: string;
  relationshipType: "ally" | "enemy" | "neutral";
  strength: number; // 0-100 scale
  lastUpdated: number; // timestamp
  evidence: Array<{
    type:
      | "direct_interaction"
      | "observed_interaction"
      | "reported_interaction";
    timestamp: number;
    description: string;
    source: string;
  }>;
}

export interface PlayerStatement {
  speakerId: string;
  targetId: string;
  content: string;
  timestamp: number;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number; // 0-100 scale
  context?: string;
}

export interface SocialStrategyState extends State {
  players: Record<string, PlayerEntity>;
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
