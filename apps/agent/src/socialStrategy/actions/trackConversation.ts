// @ts-nocheck
import {
  MemoryType,
  type Action,
  type IAgentRuntime,
  type Content,
  type Memory,
  type UUID,
  stringToUuid,
} from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import {
  type SocialStrategyState,
  type PlayerEntity,
  type PlayerRelationship,
  type PlayerStatement,
  type RelationshipType,
} from "../types";
import { addStatement, upsertRelationship } from "../runtime/memory";
import { addFact } from "../runtime/memory";

const DEFAULT_TRUST_SCORE = 50;
const TRUST_ADJUSTMENT = 10;

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

interface MessageMetadata {
  type?: string;
  entityName?: string;
  username?: string;
  source?: string;
  discriminator?: string;
  // anon chat
  raw?: {
    senderName?: string;
  };
}

export interface ModelAnalysis {
  trustScore: number;
  relationship: string;
  statement: string;
  metadata?: {
    sentiment?: string;
    confidence?: number;
    [key: string]: string | number | boolean | undefined;
  };
}

// Helper function to generate deterministic player ID (per agent per handle)
function generatePlayerId(agentId: string, handle: string): UUID {
  return stringToUuid(`${agentId}:player:${handle.toLowerCase()}`);
}

// Helper function to generate deterministic statement ID
function generateStatementId(
  speakerId: string,
  targetId: string,
  timestamp: number
): UUID {
  return stringToUuid(`statement:${speakerId}:${targetId}:${timestamp}`);
}

// Helper function to find player by handle or ID
function findPlayerByHandle(
  state: SocialStrategyState,
  agentId: string,
  handle: string,
  knownId?: UUID
): string | undefined {
  // If we have a known ID and it exists in state, use it
  if (knownId && state.players[knownId]) {
    return knownId;
  }
  // Try to find by deterministic ID
  const deterministicId = generatePlayerId(agentId, handle);
  if (state.players[deterministicId]) {
    return deterministicId;
  }
  // Search by handle (for test cases with pre-defined UUIDs)
  // Only return valid UUIDs to prevent string-based IDs from being used
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [id, player] of Object.entries(state.players)) {
    if (
      player.handle.toLowerCase() === handle.toLowerCase() &&
      uuidRegex.test(id)
    ) {
      return id;
    }
  }
  return undefined;
}

// Helper function to create a new player
function createPlayer(
  agentId: string,
  handle: string,
  existingId?: UUID
): PlayerEntity {
  return {
    id: existingId || generatePlayerId(agentId, handle),
    handle,
    trustScore: DEFAULT_TRUST_SCORE,
    firstInteraction: Date.now(),
    lastInteraction: Date.now(),
    metadata: {
      relationshipType: "neutral",
      interactionCount: 0,
    },
  };
}

// Helper function to create a new statement
function createStatement(
  speakerId: string,
  targetId: string,
  content: string,
  metadata: ModelAnalysis["metadata"] = {}
): PlayerStatement {
  const timestamp = Date.now();
  return {
    id: generateStatementId(speakerId, targetId, timestamp),
    speakerId,
    targetId,
    content,
    timestamp,
    metadata,
  };
}

// Helper function to update relationship
function updateRelationship(
  state: SocialStrategyState,
  sourceId: UUID,
  targetId: UUID,
  type: RelationshipType,
  description: string
): void {
  const existingRelationship = state.relationships.find(
    (r) => r.sourcePlayerId === sourceId && r.targetPlayerId === targetId
  );

  if (existingRelationship) {
    existingRelationship.relationshipType = type;
    existingRelationship.lastUpdated = Date.now();
    existingRelationship.evidence.push({
      type: "direct_interaction",
      timestamp: Date.now(),
      description,
      source: sourceId,
    });
  } else {
    state.relationships.push({
      sourcePlayerId: sourceId,
      targetPlayerId: targetId,
      relationshipType: type,
      strength: 50, // Default strength
      lastUpdated: Date.now(),
      evidence: [
        {
          type: "direct_interaction",
          timestamp: Date.now(),
          description,
          source: sourceId,
        },
      ],
    });
  }
}

// Helper function to extract mentioned players from text
function extractMentionedPlayers(text: string): string[] {
  console.log("🔍 [extractMentionedPlayers] input text:", text);

  const mentionRegex = /@(\w+)/g;
  const matches = text.match(mentionRegex);

  if (!matches) {
    console.log("🔍 [extractMentionedPlayers] no mentions found");
    return [];
  }

  // Extract the username part (remove @)
  const players = matches.map((match) => match.substring(1));
  console.log("🔍 [extractMentionedPlayers] found players:", players);

  return players;
}

export const trackConversation: Action = {
  name: "TRACK_CONVERSATION",

  description: [
    "Track and analyze conversations to update player relationships and trust scores. Should be called after a message with @mentions is sent.",
    "FACTS, RELATIONSHIPS and SOCIAL_CONTEXT are **required** providers when calling this action.",
  ].join(""),
  similes: ["SAVE_RELATIONSHIP", "SAVE_STATEMENT"],
  examples: [
    [
      /*  “Quick heads-up: I’m buying an extra die for tomorrow’s HoH—5 HC well spent if it keeps me off the block.”

“@PlayerC, I’ll transfer you 8 HC if you promise to vote to save me on Day 3. React with ✅ if we have a deal.”

“Strategy check: the pot is thinning fast. Anyone else think hoarding HC is smarter than rolling three dice this early?”

“@PlayerF kept their word last cycle, so I’m rating them 9/10 for trustworthiness and aligning my vote with theirs.”

“Public note: I’m skipping stakes this HoH. I’d rather stay liquid for the eviction vote—high stakes feel like a trap.”

“I’m nominating @PlayerH and @PlayerJ. Nothing personal—just balancing the board after last round’s dice spree.”

“If you’re feeling safe, lend me 4 HC for a last-minute die. I’ll repay 6 HC next faucet—DM me.”

“Observations: @PlayerD has 65 HC left but zero extra dice. Big wallet, small threat in comps—worth keeping around.”

“Reminder to self: never underestimate a single-die player in HoH; those puzzles swing the scores more than dice.”

“Going to rate @PlayerA a solid 7/10. They voted to keep me, but that bribe from @PlayerE clearly influenced them.”

“Just burned 15 HC on three votes to save @PlayerK. Hope it pays off or I’m broke next cycle.”

“End-of-round recap: bought one die, staked 25 HC, finished 2nd in HoH, and still have 12 HC—calling that a win.”
*/
      {
        name: "{user}",
        content: {
          text: "I've been working with @PlayerB the past few rounds and we've been working really well together.  I'm going to give them a 10/10 for this round.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Quick heads-up: I’m buying an extra die for tomorrow’s HoH—5 HC well spent if it keeps me off the block.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "PlayerC, I’ll transfer you 8 HC if you promise to vote to save me on Day 3. React with ✅ if we have a deal.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Strategy check: the pot is thinning fast. Anyone else think hoarding HC is smarter than rolling three dice this early?",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "PlayerF kept their word last cycle, so I’m rating them 9/10 for trustworthiness and aligning my vote with theirs.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Public note: I’m skipping stakes this HoH. I’d rather stay liquid for the eviction vote—high stakes feel like a trap.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "I’m nominating @PlayerH and @PlayerJ. Nothing personal—just balancing the board after last round’s dice spree.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "If you’re feeling safe, lend me 4 HC for a last-minute die. I’ll repay 6 HC next faucet—DM me.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Observations: @PlayerD has 65 HC left but zero extra dice. Big wallet, small threat in comps—worth keeping around.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Reminder to self: never underestimate a single-die player in HoH; those puzzles swing the scores more than dice.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Going to rate @PlayerA a solid 7/10. They voted to keep me, but that bribe from @PlayerE clearly influenced them.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS"],
        },
      },
      {
        name: "{user}",
        content: {
          text: "Public note: I’m skipping stakes this HoH. I’d rather stay liquid for the eviction vote—high stakes feel like a trap.",
          actions: ["TRACK_CONVERSATION"],
          providers: ["SOCIAL_CONTEXT", "FACTS", "RELATIONSHIPS"],
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const isValid =
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof message.content.text === "string";
    return isValid;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state) => {
    const relationships: PlayerRelationship[] = state.values.relationships;
    const players: PlayerEntity[] = state.values.players;
    const statements: PlayerStatement[] = state.values.statements;

    console.log("🚀 [trackConversation] handler started");
    for (const player of Object.values(players)) {
      if (player.metadata?.new) {
        delete player.metadata.new;
        await runtime.createEntity(player);
      } else if (player.metadata?.needsSave) {
        delete player.metadata.needsSave;
        await runtime.updateEntity(player);
      }
    }

    for (const statement of statements) {
      if (statement.data.new) {
        delete statement.data.new;
        await runtime.createComponent(statement);
        await addFact({ runtime, statement, message });
      } else if (statement.metadata?.needsSave) {
        delete statement.metadata.needsSave;
        await runtime.updateComponent(statement);
      }
    }

    for (const relationship of relationships) {
      if (relationship.metadata?.new) {
        delete relationship.metadata.new;
        await runtime.createRelationship(relationship);
      } else if (relationship.metadata?.needsSave) {
        delete relationship.metadata.needsSave;
        await runtime.updateRelationship(relationship);
      }
    }
  },
};
