import {
  type Action,
  type IAgentRuntime,
  type Memory,
  logger,
  parseKeyValueXml,
  composePromptFromState,
  stringToUuid,
  asUUID,
  type HandlerCallback,
  ModelType,
  findEntityByName,
  State,
} from "@elizaos/core";
import { RolodexService } from "../services/RolodexService";

const addContactTemplate = `# Add Contact to Rolodex

Current message: {{message}}
Sender: {{senderName}} (ID: {{senderId}})

## Instructions
Extract the contact information from the message and determine:
1. Who should be added as a contact (name or entity reference)
2. What category they belong to (friend, family, colleague, acquaintance, vip, business)
3. Any preferences or notes mentioned

Respond with the extracted information in XML format.

## Response Format
<response>
<contactName>Name of the contact to add</contactName>
<entityId>ID if known, otherwise leave empty</entityId>
<categories>comma-separated categories</categories>
<notes>Any additional notes or preferences</notes>
<timezone>Timezone if mentioned</timezone>
<language>Language preference if mentioned</language>
<reason>Reason for adding this contact</reason>
</response>`;

export const addContactAction: Action = {
  name: "ADD_CONTACT",
  description:
    "Add a new contact to the rolodex with categorization and preferences",
  similes: [
    "add contact",
    "save contact",
    "add to contacts",
    "add to rolodex",
    "remember this person",
    "save their info",
    "add them to my list",
    "categorize as friend",
    "mark as vip",
    "add to address book",
  ],
  examples: [
    [
      {
        name: "User",
        content: { text: "Add John Smith to my contacts as a colleague" },
      },
      {
        name: "Agent",
        content: {
          text: "I've added John Smith to your contacts as a colleague.",
        },
      },
    ],
    [
      {
        name: "User",
        content: { text: "Save this person as a friend in my rolodex" },
      },
      {
        name: "Agent",
        content: { text: "I've saved them as a friend in your rolodex." },
      },
    ],
    [
      {
        name: "User",
        content: { text: "Remember Alice as a VIP contact" },
      },
      {
        name: "Agent",
        content: { text: "I've added Alice to your contacts as a VIP." },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<boolean> => {
    // Check if RolodexService is available
    const rolodexService = runtime.getService("rolodex") as RolodexService;
    if (!rolodexService) {
      logger.warn("[AddContact] RolodexService not available");
      return false;
    }

    // Check if message contains intent to add contact
    const addKeywords = [
      "add",
      "save",
      "remember",
      "categorize",
      "contact",
      "rolodex",
    ];
    const messageText = message.content.text?.toLowerCase() || "";

    return addKeywords.some((keyword) => messageText.includes(keyword));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<State> => {
    const rolodexService = runtime.getService("rolodex") as RolodexService;

    if (!rolodexService) {
      throw new Error("RolodexService not available");
    }

    try {
      // Build proper state for prompt composition
      if (!state) {
        state = {
          values: {},
          data: {},
          text: "",
        };
      }

      // Add our values to the state
      state.values = {
        ...state.values,
        message: message.content.text,
        senderId: message.entityId,
        senderName: state.values?.senderName || "User",
      };

      // Compose prompt to extract contact information
      const prompt = composePromptFromState({
        state,
        template: addContactTemplate,
      });

      // Use LLM to extract contact details
      const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
      });

      const parsedResponse = parseKeyValueXml(response);
      if (!parsedResponse || !parsedResponse.contactName) {
        logger.warn(
          "[AddContact] Failed to parse contact information from response",
        );
        throw new Error("Could not extract contact information");
      }

      // Determine entity ID
      let entityId = parsedResponse.entityId
        ? asUUID(parsedResponse.entityId)
        : null;

      // If no entity ID provided, try to find by name
      if (!entityId && parsedResponse.contactName) {
        const entity = await findEntityByName(runtime, message, state);

        if (entity) {
          entityId = entity.id as any;
        } else {
          // Create a new entity ID based on the name
          entityId = stringToUuid(
            `contact-${parsedResponse.contactName}-${runtime.agentId}`,
          );
        }
      }

      if (!entityId) {
        throw new Error("Could not determine entity ID for contact");
      }

      // Parse categories
      const categories = parsedResponse.categories
        ? parsedResponse.categories.split(",").map((c: string) => c.trim())
        : ["acquaintance"];

      // Build preferences
      const preferences: any = {};
      if (parsedResponse.timezone)
        preferences.timezone = parsedResponse.timezone;
      if (parsedResponse.language)
        preferences.language = parsedResponse.language;
      if (parsedResponse.notes) preferences.notes = parsedResponse.notes;

      // Add contact
      const contact = await rolodexService.addContact(
        entityId,
        categories,
        preferences,
      );

      logger.info(
        `[AddContact] Added contact ${parsedResponse.contactName} (${entityId})`,
      );

      // Prepare response
      const responseText = `I've added ${parsedResponse.contactName} to your contacts as ${categories.join(", ")}. ${
        parsedResponse.reason || "They have been saved to your rolodex."
      }`;

      if (callback) {
        await callback({
          text: responseText,
          action: "ADD_CONTACT",
          metadata: {
            contactId: entityId,
            contactName: parsedResponse.contactName,
            categories,
            success: true,
          },
        });
      }

      return {
        values: {
          contactId: entityId,
          contactName: parsedResponse.contactName,
          categories,
          preferences,
        },
        data: {
          contact: contact,
          contactId: entityId,
          contactName: parsedResponse.contactName,
          categories,
          preferences,
        },
        text: responseText,
      };
    } catch (error) {
      logger.error("[AddContact] Error adding contact:", error);

      const errorText = `I couldn't add the contact. ${
        error instanceof Error ? error.message : "Please try again."
      }`;

      if (callback) {
        await callback({
          text: errorText,
          action: "ADD_CONTACT",
          metadata: { error: true },
        });
      }

      return {
        values: {
          error: JSON.stringify(error),
        },
        data: {
          error: error,
        },
        text: errorText,
      };
    }
  },
};
