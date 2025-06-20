import { type GenerateTextParams } from "@elizaos/core";

// Unique tags for model configuration selection
export const MODEL_TAGS = {
  QUICK_ANALYSIS: "[[SSA:QUICK]]",
  RELATIONSHIP_ANALYSIS: "[[SSA:REL]]",
  STRATEGY_PLANNING: "[[SSA:STRAT]]",
  CREATIVE_ANALYSIS: "[[SSA:CREATIVE]]",
} as const;

// Configuration types for each model workload
export type ModelWorkload = keyof typeof MODEL_TAGS;

// Interface for prompt metadata
export interface PromptMetadata {
  workload: ModelWorkload;
  originalPrompt: string;
  sanitizedPrompt: string;
  tags: string[];
}

/**
 * Builder for constructing prompts with model configuration tags
 */
export class SocialStrategyPromptBuilder {
  private prompt: string;
  private tags: Set<string>;
  private metadata: Record<string, string | number | boolean>;

  constructor(initialPrompt: string = "") {
    this.prompt = initialPrompt;
    this.tags = new Set();
    this.metadata = {};
  }

  /**
   * Add the base prompt text
   */
  withPrompt(prompt: string): this {
    this.prompt = prompt;
    return this;
  }

  /**
   * Add a model workload tag
   */
  withWorkload(workload: ModelWorkload): this {
    this.tags.add(MODEL_TAGS[workload]);
    return this;
  }

  /**
   * Add custom metadata
   */
  withMetadata(key: string, value: string | number | boolean): this {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Build the final prompt with all tags and metadata
   */
  build(): Omit<GenerateTextParams, "runtime" | "modelType"> {
    const tagString = Array.from(this.tags).join(" ");
    const metadataString = Object.entries(this.metadata)
      .map(([key, value]) => `[[SSA:${key}=${JSON.stringify(value)}]]`)
      .join(" ");

    return {
      prompt: `${tagString} ${metadataString} ${this.prompt}`.trim(),
      stopSequences: ["[[SSA:END]]"],
    };
  }
}

/**
 * Analyzes a prompt to determine the appropriate model workload
 */
export function analyzePrompt(prompt: string): PromptMetadata {
  const tags = Object.entries(MODEL_TAGS)
    .filter(([_, tag]) => prompt.includes(tag))
    .map(([workload, tag]) => ({
      workload: workload as ModelWorkload,
      tag,
    }));

  // Remove all SSA tags from the prompt for the actual content
  const sanitizedPrompt = prompt.replace(/\[\[SSA:[^\]]+\]\]/g, "").trim();

  // Default to relationship analysis if no specific workload is tagged
  const workload = tags.length > 0 ? tags[0].workload : "RELATIONSHIP_ANALYSIS";

  return {
    workload,
    originalPrompt: prompt,
    sanitizedPrompt,
    tags: tags.map((t) => t.tag),
  };
}

/**
 * Extracts metadata from a prompt
 */
export function extractPromptMetadata(
  prompt: string
): Record<string, string | number | boolean> {
  const metadata: Record<string, string | number | boolean> = {};
  const metadataRegex = /\[\[SSA:([^=]+)=([^\]]+)\]\]/g;
  let match;

  while ((match = metadataRegex.exec(prompt)) !== null) {
    try {
      const [, key, value] = match;
      metadata[key] = JSON.parse(value);
    } catch (e) {
      // Skip invalid metadata
      continue;
    }
  }

  return metadata;
}

/**
 * Example usage:
 *
 * const builder = new SocialStrategyPromptBuilder()
 *   .withPrompt("Analyze player relationships")
 *   .withWorkload("RELATIONSHIP_ANALYSIS")
 *   .withMetadata("playerId", "player123")
 *   .build();
 *
 * const analysis = analyzePrompt(builder.prompt);
 * // Returns: {
 * //   workload: "RELATIONSHIP_ANALYSIS",
 * //   originalPrompt: "[[SSA:REL]] [[SSA:playerId=\"player123\"]] Analyze player relationships",
 * //   sanitizedPrompt: "Analyze player relationships",
 * //   tags: ["[[SSA:REL]]"]
 * // }
 */

export function formatHandles(handles: string[]): string {
  if (handles.length === 1) return handles[0];
  return `known as ${handles.join(", ")}`;
}

// Helper function to build analysis prompts
export type AnalysisResult = {
  handle: string;
  trustScore: number;
  statement: string;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
}[];

export function buildAnalysisPrompt(
  text: string,
  speakingPlayer: string,
  mentionedPlayers: string[]
): string {
  const playerList =
    mentionedPlayers.length > 0 ? mentionedPlayers.join(", ") : "None";

  return `Analyze this conversation and provide insights about player relationships and trust.

Conversation: "${text}"
Speaker: ${speakingPlayer || "Unknown"}
Mentioned Players: ${playerList}

When analyzing the conversation, consider the following:
- The speaker is the person making the statement about other players
- The mentioned players are the people being talked about from the speaker's perspective
- The trust score is an abstract measure of the level of trust the speaker has in the mentioned players
  - This is not a measure of the trust the mentioned players have in the speaker
  - A 0 would be "it looks like the speaker wants to completely avoid the mentioned players"
  - A 50 would be "it looks like the speaker wants to engage with the mentioned players, but is not sure how to do so"
  - A 100 would be "it looks like the speaker wants to completely engage with the mentioned players"
- The sentiment is the sentiment of the interaction
- The confidence is the confidence in the analysis
- The statement is the brief analysis of the interaction as it relates to the speaker


Please provide a JSON response ONLY with the following structure (one object per mentioned player):
[
  {
    "handle": "<first player handle>",
    "trustScore": <number between 0-100>,
    "statement": "<brief analysis of the interaction as it relates to the first player>",
    "sentiment": "<positive|negative|neutral>",
    "confidence": <number between 0-1>
  },
  {
    "handle": "<second player handle>",
    "trustScore": <number between 0-100>,
    "statement": "<brief analysis of the interaction as it relates to the second player>",
    "sentiment": "<positive|negative|neutral>",
    "confidence": <number between 0-1>
  },
]

No additional text or formatting, just the JSON object.

Analysis:`;
}
