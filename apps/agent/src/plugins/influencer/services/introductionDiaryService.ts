import {
  IAgentRuntime,
  ModelType,
  Service,
  UUID,
  composePrompt,
} from "@elizaos/core";

export class IntroductionDiaryService extends Service {
  static serviceType = "influencer-intro-diary";
  capabilityDescription =
    "Generates introduction and diary short-form responses via LLM";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(
    runtime: IAgentRuntime,
  ): Promise<IntroductionDiaryService> {
    return new IntroductionDiaryService(runtime);
  }

  async stop(): Promise<void> {
    // no-op
  }

  async generateIntroduction(roomId: UUID): Promise<string> {
    const character = this.runtime.character;
    const adjectives = Array.isArray(character.adjectives)
      ? character.adjectives.join(", ")
      : String(character.adjectives || "");
    const bio = Array.isArray(character.bio)
      ? character.bio.join(" ")
      : String(character.bio || "");

    const template = `# Task: Write a first-person introduction for {{name}}.

Constraints:
- 120–250 words
- Plausible, fictional personal background
- Reflect these adjectives if present: {{adjectives}}
- Keep it natural and cohesive (no lists, no headers)
- No hashtags, no emojis, no markdown formatting
- Exactly one paragraph of text

Context (bio hints):
{{bio}}

Output: plain text only.`;

    const prompt = composePrompt({
      state: {
        name: character.name,
        adjectives,
        bio,
      },
      template,
    });

    const text = await this.runtime.useModel<string>(ModelType.TEXT_LARGE, {
      prompt,
      stopSequences: [],
    });
    return typeof text === "string" ? text.trim() : String(text ?? "").trim();
  }

  async generateDiaryResponse(
    roomId: UUID,
    housePrompt: string,
  ): Promise<string> {
    const character = this.runtime.character;
    const template = `# Task: Diary room response for {{name}}.

Constraints:
- 90–180 words
- Evaluate each other player mentioned below: trustworthiness, alignment, strategic risk
- Justify opinions by referencing their introduction substance (no quotes required)
- No hashtags, no emojis, no markdown formatting
- Exactly one paragraph of text

Other players and their introductions (from House prompt):
{{housePrompt}}

Output: plain text only.`;

    const prompt = composePrompt({
      state: {
        name: character.name,
        housePrompt,
      },
      template,
    });

    const text = await this.runtime.useModel<string>(ModelType.TEXT_LARGE, {
      prompt,
      stopSequences: [],
    });
    return typeof text === "string" ? text.trim() : String(text ?? "").trim();
  }
}
