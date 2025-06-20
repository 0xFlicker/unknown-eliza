import {
  type Action,
  type IAgentRuntime,
  type Memory,
  logger,
  parseKeyValueXml,
  composePromptFromState,
  findEntityByName,
  asUUID,
  type HandlerCallback,
  ModelType,
  type State,
} from "@elizaos/core";
import { RolodexService, FollowUpService } from "../services";

const scheduleFollowUpTemplate = `# Schedule Follow-up

Current message: {{message}}
Sender: {{senderName}} (ID: {{senderId}})

## Instructions
Extract the follow-up scheduling information from the message:
1. Who to follow up with (name or entity reference)
2. When to follow up (date/time or relative time like "tomorrow", "next week")
3. Reason for the follow-up
4. Priority (high, medium, low)
5. Any specific message or notes

## Current Date/Time
{{currentDateTime}}

## Response Format
<response>
<contactName>Name of the contact to follow up with</contactName>
<entityId>ID if known, otherwise leave empty</entityId>
<scheduledAt>ISO datetime for the follow-up</scheduledAt>
<reason>Reason for the follow-up</reason>
<priority>high, medium, or low</priority>
<message>Optional message or notes for the follow-up</message>
</response>`;

export const scheduleFollowUpAction: Action = {
  name: "SCHEDULE_FOLLOW_UP",
  description: "Schedule a follow-up reminder for a contact",
  similes: [
    "follow up with",
    "remind me to contact",
    "schedule a check-in",
    "set a reminder for",
    "follow up on",
    "check back with",
    "reach out to",
    "schedule follow-up",
    "remind me about",
  ],
  examples: [
    [
      {
        name: "User",
        content: {
          text: "Remind me to follow up with John next week about the project",
        },
      },
      {
        name: "Agent",
        content: {
          text: "I've scheduled a follow-up with John for next week about the project.",
        },
      },
    ],
    [
      {
        name: "User",
        content: { text: "Schedule a follow-up with Sarah tomorrow at 2pm" },
      },
      {
        name: "Agent",
        content: {
          text: "I've scheduled a follow-up with Sarah for tomorrow at 2:00 PM.",
        },
      },
    ],
    [
      {
        name: "User",
        content: { text: "Follow up with the VIP client in 3 days" },
      },
      {
        name: "Agent",
        content: {
          text: "I've scheduled a follow-up with the VIP client in 3 days.",
        },
      },
    ],
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> => {
    // Check if both services are available
    const rolodexService = runtime.getService("rolodex") as RolodexService;
    const followUpService = runtime.getService("follow_up") as FollowUpService;

    if (!rolodexService || !followUpService) {
      logger.warn("[ScheduleFollowUp] Required services not available");
      return false;
    }

    // Check if message contains intent to schedule follow-up
    const followUpKeywords = [
      "follow up",
      "followup",
      "remind",
      "check in",
      "check back",
      "reach out",
      "schedule",
    ];
    const messageText = message.content.text?.toLowerCase() || "";

    return followUpKeywords.some((keyword) => messageText.includes(keyword));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<State | void> => {
    const rolodexService = runtime.getService("rolodex") as RolodexService;
    const followUpService = runtime.getService("follow_up") as FollowUpService;

    if (!rolodexService || !followUpService) {
      throw new Error("Required services not available");
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
        currentDateTime: new Date().toISOString(),
      };

      // Compose prompt to extract follow-up information
      const prompt = composePromptFromState({
        state,
        template: scheduleFollowUpTemplate,
      });

      // Use LLM to extract follow-up details
      const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
      });

      const parsedResponse = parseKeyValueXml(response);
      if (
        !parsedResponse ||
        (!parsedResponse.contactName && !parsedResponse.entityId)
      ) {
        logger.warn(
          "[ScheduleFollowUp] Failed to parse follow-up information from response"
        );
        throw new Error("Could not extract follow-up information");
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
          throw new Error(
            `Contact "${parsedResponse.contactName}" not found in rolodex`
          );
        }
      }

      if (!entityId) {
        throw new Error("Could not determine contact to follow up with");
      }

      // Verify contact exists in rolodex
      const contact = await rolodexService.getContact(entityId);
      if (!contact) {
        throw new Error("Contact not found in rolodex. Please add them first.");
      }

      // Parse scheduled time
      const scheduledAt = new Date(parsedResponse.scheduledAt);
      if (isNaN(scheduledAt.getTime())) {
        throw new Error("Invalid follow-up date/time");
      }

      // Schedule the follow-up
      const task = await followUpService.scheduleFollowUp(
        entityId,
        scheduledAt,
        parsedResponse.reason || "Follow-up",
        parsedResponse.priority || "medium",
        parsedResponse.message
      );

      logger.info(
        `[ScheduleFollowUp] Scheduled follow-up for ${parsedResponse.contactName} at ${scheduledAt.toISOString()}`
      );

      // Prepare response
      const responseText = `I've scheduled a follow-up with ${parsedResponse.contactName} for ${scheduledAt.toLocaleString()}. ${
        parsedResponse.reason ? `Reason: ${parsedResponse.reason}` : ""
      }`;

      if (callback) {
        await callback({
          text: responseText,
          action: "SCHEDULE_FOLLOW_UP",
          metadata: {
            contactId: entityId,
            contactName: parsedResponse.contactName,
            scheduledAt: scheduledAt.toISOString(),
            taskId: task.id,
            success: true,
          },
        });
      }

      return {
        values: {
          contactId: entityId,
          taskId: task.id,
        },
        data: {
          contactId: entityId,
          contactName: parsedResponse.contactName,
          scheduledAt: scheduledAt.toISOString(),
          taskId: task.id,
          reason: parsedResponse.reason,
          priority: parsedResponse.priority,
        },
        text: responseText,
      };
    } catch (error) {
      logger.error("[ScheduleFollowUp] Error scheduling follow-up:", error);

      const errorText = `I couldn't schedule the follow-up. ${
        error instanceof Error ? error.message : "Please try again."
      }`;

      if (callback) {
        await callback({
          text: errorText,
          action: "SCHEDULE_FOLLOW_UP",
          metadata: { error: true },
        });
      }

      return {
        values: {
          contactId: runtime.agentId,
          taskId: null,
        },
        data: {
          contactId: runtime.agentId,
          contactName: "Error",
          scheduledAt: null,
          taskId: null,
          reason: errorText,
          priority: null,
        },
        text: errorText,
      };
    }
  },
};
