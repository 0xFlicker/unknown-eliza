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
  private metadata: Record<string, any>;

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
  withMetadata(key: string, value: any): this {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Build the final prompt with all tags and metadata
   */
  build(): GenerateTextParams {
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
export function extractPromptMetadata(prompt: string): Record<string, any> {
  const metadata: Record<string, any> = {};
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
