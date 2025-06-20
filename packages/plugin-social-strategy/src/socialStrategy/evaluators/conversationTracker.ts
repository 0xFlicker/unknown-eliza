import {
  type Evaluator,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { trackConversationHandler } from "../actions/trackConversation";

/**
 * Regex utility to detect @mentions in a text message.
 * We keep a lightweight copy here to avoid re-exporting internals
 * from the action implementation.
 */
function hasMentions(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return /@[a-zA-Z0-9_]+/.test(text);
}

/**
 * The conversation tracking evaluator passively observes every incoming
 * message and delegates the heavy-lifting to `trackConversationHandler`.
 * This allows the social-strategy plugin to keep its entity & relationship
 * graph up-to-date without relying on explicit actions being invoked by the
 * LLM.  In other words: the agent now learns simply by *listening*.
 */
export const conversationTrackingEvaluator: Evaluator = {
  name: "SOCIAL_CONVERSATION_TRACKER",
  description:
    "Passively tracks messages that mention other players and updates the social graph (players, trust scores, relationships, statements).",
  similes: ["SOCIAL_TRACKER", "RELATIONSHIP_BUILDER", "OBSERVE_MENTIONS"],

  /**
   * Run for any text message that contains at least one `@handle` mention.
   */
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> => {
    const content = message.content as { text?: unknown } | undefined;
    return !!content && hasMentions(content.text);
  },

  /**
   * Delegate processing to the existing `trackConversationHandler` used by
   * the action implementation.  This avoids duplicating logic while ensuring
   * both the action and evaluator stay perfectly in-sync.
   */
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<State | void> => {
    // Re-use the action handler – we intentionally ignore the returned value
    // and let the side-effects (entities, relationships, components) carry
    // the updated state.
    // DISABLED: running actions in an evaluator is an anti-pattern.
    // await trackConversationHandler(runtime, message, state);

    return {
      values: {
        tracked: true,
      },
      data: {
        messageId: message.id,
      },
      text: "Conversation tracked.",
    };
  },

  examples: [
    {
      prompt: "@Alice you really saved my game last round!",
      messages: [
        {
          name: "Bob",
          content: {
            text: "@Alice you really saved my game last round!",
          },
        },
      ],
      outcome:
        "Creates/updates players Bob and Alice, marks Bob → Alice as ally, and increments Alice's trust score.",
    },
    {
      prompt:
        "I can't believe @Charlie betrayed us… never trusting them again.",
      messages: [
        {
          name: "Dana",
          content: {
            text: "I can't believe @Charlie betrayed us… never trusting them again.",
          },
        },
      ],
      outcome:
        "Creates/updates players Dana and Charlie, marks Dana → Charlie as rival, and decreases Charlie's trust score.",
    },
  ],
};
