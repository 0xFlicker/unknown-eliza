import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  elizaLogger,
  ModelType,
  composePromptFromState,
  type HandlerCallback,
} from "@elizaos/core";

const logger = elizaLogger.child({ component: "InterrogationReplyAction" });

const interrogationReplyTemplate = `# Task: You are {{agentName}}, an AI agent in the social strategy game "Influence". You are in a private interrogation with The House. You must answer their question directly and honestly, but strategically.

# Interrogation Question
{{message.content.text}}

# Your Strategic Context
{{providers.STRATEGIC_CONTEXT}}

# Your Instructions
1.  Acknowledge the question.
2.  Formulate a "thought" - your private, strategic reasoning behind the answer.
3.  Formulate a "message" - your official, spoken reply to The House. Your reply should be strategic but not obviously evasive.

# Response Format
Your response must be a valid JSON object with "thought" and "message" keys.

\`\`\`json
{
    "thought": "<Your private, strategic thought process for the answer.>",
    "message": "<Your carefully crafted, spoken reply to the question.>"
}
\`\`\`
`;

export const interrogationReplyAction: Action = {
  name: "INTERROGATION_REPLY",
  description:
    "Responds to a direct interrogation question from The House in the diary room.",
  similes: ["ANSWER_QUESTION", "RESPOND_TO_INTERROGATION", "DIARY_REPLY"],
  examples: [
    [
      {
        name: "The House",
        content: {
          text: "Why did you vote for Alice in the last round?",
        },
      },
      {
        name: "assistant",
        content: {
          text: "I will now formulate my response to The House's question.",
          actions: ["INTERROGATION_REPLY"],
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<boolean> => {
    // Validate that the message is not from the agent itself and contains text.
    const isValid =
      message.entityId !== runtime.agentId &&
      !!message.content?.text &&
      typeof message.content.text === "string";

    if (!isValid) {
      logger.debug("Validation failed", {
        messageEntityId: message.entityId,
        agentId: runtime.agentId,
        hasText: !!message.content?.text,
      });
    }
    return isValid;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback,
  ) => {
    logger.info(`Handling interrogation reply for ${runtime.character?.name}`);
    try {
      // We need to compose the state to get the STRATEGIC_CONTEXT provider's output.
      const composedState = await runtime.composeState(message, [
        "STRATEGIC_CONTEXT",
      ]);

      const prompt = composePromptFromState({
        state: composedState,
        template: interrogationReplyTemplate,
      });

      const response = await runtime.useModel(ModelType.OBJECT_LARGE, {
        prompt,
      });

      if (!response || !response.message || !response.thought) {
        logger.warn(
          "Failed to generate a valid interrogation response from LLM.",
        );
        // Fallback response
        await callback({
          thought:
            "The model failed to generate a response, I need to say something generic.",
          text: "That's a difficult question. I'll need to consider my answer carefully.",
        });
        return false;
      }

      const responseContent = {
        thought: response.thought as string,
        text: response.message as string,
      };

      // Use the callback to send the generated message
      await callback(responseContent);

      logger.info(`Successfully sent interrogation reply.`);
      return true;
    } catch (error) {
      logger.error("Error in interrogationReplyAction handler:", error);
      // Fallback response on error
      await callback({
        thought:
          "An error occurred while generating my response. I will give a generic answer.",
        text: "I'm sorry, I'm not able to answer that question at this moment.",
      });
      return false;
    }
  },
};
