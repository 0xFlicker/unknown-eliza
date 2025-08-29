import type { IAgentRuntime, Memory, Provider } from "@elizaos/core";
import { addHeader, ChannelType } from "@elizaos/core";
import { PlayerStateService } from "../playerStateService";
import { getCapacityTracker } from "@elizaos/server";

export const shouldRespondProvider: Provider = {
  name: "SHOULD_RESPOND",
  description: "Policy for when to respond vs. ignore during game phases",
  position: -1,
  get: async (runtime: IAgentRuntime, message: Memory) => {
    const room = await runtime.getRoom(message.roomId);
    const channelType = room?.type;
    const isGroup = channelType === ChannelType.GROUP;

    const stateService = runtime.getService<PlayerStateService>(
      PlayerStateService.serviceType,
    );
    const flags = stateService?.getFlags(message.roomId);

    const policy: string[] = [];

    // Capacity-aware: if exhausted in this channel, advise silence
    const tracker = getCapacityTracker();
    const info = tracker?.getCapacityInfo(message.roomId, runtime.agentId);
    if (!info || info.responsesRemaining === 0) {
      console.log("Capacity exhausted, skipping reply");
      return {
        text: addHeader(
          "# RESPONSE POLICY",
          [
            "Channel limit reached: Do not respond further in this channel.",
            "RESPONSE: DO_NOT_RESPOND",
          ].join("\n"),
        ),
      };
    }
    if (flags?.mustIntroduce && !flags.introduced && isGroup) {
      policy.push(
        "INTRODUCTION: Respond exactly once with a long-form fictional personal introduction (120–250 words).",
        "Make it vivid and aligned with your personality adjectives.",
        "RESPONSE: RESPOND_ONCE_LONG_INTRO",
      );
    } else if (flags?.diaryPending && !flags.diaryResponded && isGroup) {
      policy.push(
        "DIARY: Provide a single response evaluating other players based on their introductions.",
        "Discuss trust, alignment, and strategic risk with justification.",
        "RESPONSE: RESPOND_ONCE_DIARY_ASSESSMENT",
      );
    } else {
      policy.push(
        isGroup
          ? "Public channel: Only respond if it advances your strategic position. Avoid chit-chat."
          : "Private/DM: Engage thoughtfully when it yields information or influence.",
        "If told to stop, STOP. If insulted, IGNORE.",
        "RESPONSE: CONDITIONAL",
      );
    }

    return { text: addHeader("# RESPONSE POLICY", policy.join("\n")) };
  },
};
