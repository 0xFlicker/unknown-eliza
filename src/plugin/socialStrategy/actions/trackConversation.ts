import {
  MemoryType,
  type Action,
  type IAgentRuntime,
  type Content,
  type Memory,
} from "@elizaos/core";
import {
  type SocialStrategyState,
  type PlayerEntity,
  type PlayerRelationship,
  type PlayerStatement,
} from "../types";

const DEFAULT_TRUST_SCORE = 50;
const TRUST_ADJUSTMENT = 5;

interface GetPlayerInfoParams {
  playerId: string;
}

function isGetPlayerInfoParams(
  message: Memory
): message is Memory & { content: { playerId: string } } {
  return (
    typeof message.content === "object" &&
    message.content !== null &&
    "playerId" in message.content &&
    typeof (message.content as any).playerId === "string"
  );
}

export const trackConversation: Action = {
  name: "trackConversation",
  description: "Track a new conversation or update an existing one",
  similes: ["TRACK_CHAT", "MONITOR_CONVERSATION", "LOG_INTERACTION"],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Hello @player1 and @player2!",
        },
      },
      {
        name: "agent",
        content: {
          text: "Tracking conversation between @player1 and @player2",
          actions: ["trackConversation"],
        },
      },
    ],
    [
      {
        name: "user",
        content: {
          text: "@player1 is a great teammate!",
        },
      },
      {
        name: "agent",
        content: {
          text: "Noted positive statement about @player1",
          actions: ["trackConversation"],
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, message, state) => {
    const { content } = message;
    const query = typeof content === "string" ? content : content.text;
    if (!query?.trim()) {
      return false;
    }
    return true;
  },

  handler: async (runtime: IAgentRuntime, message, state) => {
    const { content } = message;
    const text = typeof content.text === "string" ? content.text.trim() : null;
    if (text === null) {
      throw new Error("content is required");
    }

    const socialState = state as SocialStrategyState;
    const now = Date.now();

    // Extract player mentions from the text
    const playerMentions = extractPlayerMentions(text);

    // Update or create player entities
    for (const handle of playerMentions) {
      const existingPlayer = Object.values(socialState.players).find(
        (p) => p.handle.toLowerCase() === handle.toLowerCase()
      );

      if (!existingPlayer) {
        // Create new player entity
        const newPlayer: PlayerEntity = {
          id: `${runtime.agentId}:player:${handle}`,
          handle,
          trustScore: DEFAULT_TRUST_SCORE,
          firstInteraction: now,
          lastInteraction: now,
          metadata: {
            interactionCount: 1,
            relationshipType: "neutral",
          },
        };
        socialState.players[newPlayer.id] = newPlayer;
      } else {
        // Update existing player
        existingPlayer.lastInteraction = now;
        existingPlayer.metadata.interactionCount++;
      }
    }

    // Update relationships based on interaction context
    if (playerMentions.length >= 2) {
      for (let i = 0; i < playerMentions.length; i++) {
        for (let j = i + 1; j < playerMentions.length; j++) {
          const player1 = Object.values(socialState.players).find(
            (p) => p.handle.toLowerCase() === playerMentions[i].toLowerCase()
          );
          const player2 = Object.values(socialState.players).find(
            (p) => p.handle.toLowerCase() === playerMentions[j].toLowerCase()
          );

          if (player1 && player2) {
            updateRelationship(socialState, player1.id, player2.id, text, now);
          }
        }
      }
    }

    // Create statements for all mentioned players
    if (playerMentions.length > 0) {
      const mentionedPlayerIds = new Set(
        Object.values(socialState.players)
          .filter((p) => playerMentions.includes(p.handle.toLowerCase()))
          .map((p) => p.id)
      );

      for (const targetId of mentionedPlayerIds) {
        const statement: PlayerStatement = {
          speakerId: message.entityId,
          targetId,
          content: text,
          timestamp: now,
          sentiment: analyzeSentiment(text),
          confidence: 70, // Default confidence
          context: "direct_mention",
        };
        socialState.statements.push(statement);
      }
    }

    // Update the social strategy memory
    const memoryContent: Content = {
      text: JSON.stringify(socialState),
    };

    await runtime.createMemory(
      {
        id: `${runtime.agentId}:social-strategy`,
        entityId: runtime.agentId,
        roomId: message.roomId,
        content: memoryContent,
        metadata: {
          type: MemoryType.CUSTOM,
        },
      },
      "social-strategy"
    );

    return true;
  },
};

// Helper function to extract player mentions from text
function extractPlayerMentions(text: string): string[] {
  // This is a simple implementation - you might want to use a more sophisticated
  // approach based on your specific needs
  const mentions = text.match(/@(\w+)/g) || [];
  return mentions.map((mention) => mention.slice(1));
}

// Helper function to analyze sentiment
function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  // This is a simple implementation - you might want to use a more sophisticated
  // approach based on your specific needs
  const positiveWords = ["good", "great", "awesome", "help", "thanks", "thank"];
  const negativeWords = ["bad", "terrible", "awful", "hate", "stupid", "wrong"];

  const words = text.toLowerCase().split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (positiveWords.includes(word)) positiveCount++;
    if (negativeWords.includes(word)) negativeCount++;
  }

  if (positiveCount > negativeCount) return "positive";
  if (negativeCount > positiveCount) return "negative";
  return "neutral";
}

// Helper function to update relationship between two players
function updateRelationship(
  state: SocialStrategyState,
  player1Id: string,
  player2Id: string,
  context: string,
  timestamp: number
) {
  const existingRelationship = state.relationships.find(
    (rel) =>
      (rel.sourcePlayerId === player1Id && rel.targetPlayerId === player2Id) ||
      (rel.sourcePlayerId === player2Id && rel.targetPlayerId === player1Id)
  );

  const sentiment = analyzeSentiment(context);
  const strengthChange =
    sentiment === "positive"
      ? TRUST_ADJUSTMENT
      : sentiment === "negative"
        ? -TRUST_ADJUSTMENT
        : 0;

  if (existingRelationship) {
    existingRelationship.strength = Math.max(
      0,
      Math.min(100, existingRelationship.strength + strengthChange)
    );
    existingRelationship.lastUpdated = timestamp;
    existingRelationship.evidence.push({
      type: "observed_interaction",
      timestamp,
      description: context,
      source: "conversation",
    });
  } else {
    const newRelationship: PlayerRelationship = {
      sourcePlayerId: player1Id,
      targetPlayerId: player2Id,
      relationshipType:
        sentiment === "positive"
          ? "ally"
          : sentiment === "negative"
            ? "enemy"
            : "neutral",
      strength: 50 + strengthChange,
      lastUpdated: timestamp,
      evidence: [
        {
          type: "observed_interaction",
          timestamp,
          description: context,
          source: "conversation",
        },
      ],
    };
    state.relationships.push(newRelationship);
  }
}
