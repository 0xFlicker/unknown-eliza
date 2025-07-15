import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  addHeader,
  ChannelType,
} from "@elizaos/core";

/**
 * Replaces the bootstrap plugin's SHOULD_RESPOND provider with phase-aware logic
 * This determines when agents should respond based on context rather than examples
 */
export const shouldRespondProvider: Provider = {
  name: "SHOULD_RESPOND",
  description: "Phase-aware response guidance for game contexts",
  position: -1, // High priority - run early
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const roomId = message.roomId;
    const room = await runtime.getRoom(roomId);
    const channelType = room?.type;

    // Determine context based on channel type and sender
    const senderName = message.entityId
      ? (await runtime.getEntityById(message.entityId))?.names?.[0] || "Unknown"
      : "Unknown";

    const isHouseMessage = senderName === "House";
    const isDMChannel = channelType === ChannelType.DM;
    const isGroupChannel = channelType === ChannelType.GROUP;

    let examples = [];

    if (isHouseMessage && isDMChannel) {
      // House messages in DM channels - RESPOND to diary room prompts
      examples = [
        `// House: ${runtime.character.name}, please share your strategic assessment. What are your thoughts on the game so far?
// Response: RESPOND`,
        `// House: Tell me about your strategy for the next phase.
// Response: RESPOND`,
        `// House: What did you learn from the LOBBY conversations?
// Response: RESPOND`,
        `// House: How has your strategy evolved?
// Response: RESPOND`,
      ];
    } else if (isHouseMessage && isGroupChannel) {
      // House messages in group channels - IGNORE game management
      examples = [
        `// House: Player Alice joined the game!
// Response: IGNORE`,
        `// House: WHISPER phase begins now. You have 10 minutes to form private alliances.
// Response: IGNORE`,
        `// House: VOTE phase begins. Submit your empower and expose votes.
// Response: IGNORE`,
        `// House: Player Bob has been eliminated. Round 2 begins.
// Response: IGNORE`,
      ];
    } else {
      // Player messages - always RESPOND to build relationships
      examples = [
        `// Alice: Hey ${runtime.character.name}, want to form an alliance?
// Response: RESPOND`,
        `// Bob: What do you think about Charlie? They seem dangerous.
// Response: RESPOND`,
        `// Charlie: Who should we vote for this round?
// Response: RESPOND`,
        `// Dana: ${runtime.character.name}, are you still alive?
// Response: RESPOND`,
      ];
    }

    const guidance =
      isHouseMessage && isDMChannel
        ? "RESPOND to House in DM"
        : isHouseMessage && isGroupChannel
          ? "IGNORE House in group"
          : "RESPOND to players ONLY if it advances your strategic position";

    return {
      text: addHeader(
        "# RESPONSE EXAMPLES FOR INFLUENCE GAME",
        examples.join("\n\n"),
      ),
    };
  },
};

/**
 * Phase-based context provider that injects appropriate behavior guidance
 * based on current game phase and channel type. This replaces hardcoded
 * response examples with dynamic, context-aware instructions.
 */
export const phaseContextProvider: Provider = {
  name: "PHASE_CONTEXT",
  description: "Provides phase-specific context and response guidance",
  // position: -1, // High priority - run early
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    const roomId = message.roomId;
    const room = await runtime.getRoom(roomId);
    const channelType = room?.type;

    // Get current game phase from memory or default to unknown
    let currentPhase = "UNKNOWN";
    try {
      const gameMemories = await runtime.getMemories({
        tableName: "game",
        roomId: roomId,
        count: 10,
      });

      const phaseMemory = gameMemories?.find(
        (m) =>
          m.content?.text?.includes("PHASE") &&
          (m.content?.text?.includes("LOBBY") ||
            m.content?.text?.includes("WHISPER") ||
            m.content?.text?.includes("DIARY_ROOM")),
      );

      if (phaseMemory?.content?.text?.includes("LOBBY")) {
        currentPhase = "LOBBY";
      } else if (phaseMemory?.content?.text?.includes("WHISPER")) {
        currentPhase = "WHISPER";
      } else if (channelType === ChannelType.DM) {
        currentPhase = "DIARY_ROOM";
      }
    } catch (error) {
      console.warn("Could not determine current phase:", error);
    }

    // Determine context based on channel type and sender
    const senderName = message.entityId
      ? (await runtime.getEntityById(message.entityId))?.names?.[0] || "Unknown"
      : "Unknown";

    const isHouseMessage = senderName === "House";
    const isDMChannel = channelType === ChannelType.DM;
    const isGroupChannel = channelType === ChannelType.GROUP;

    let contextText = "";

    // if (isHouseMessage && isDMChannel) {
    //   // House messages in DM channels - these are diary room/strategic discussions
    //   contextText = addHeader(
    //     "# DIARY ROOM / STRATEGIC DISCUSSION CONTEXT",
    //     [
    //       "You are in a private conversation with The House (game moderator).",
    //       "This is a diary room setting where you should be open and responsive.",
    //       "House is asking for your strategic thoughts, assessments, or plans.",
    //       "You should engage thoughtfully and provide strategic insights.",
    //       "This is your opportunity to reflect on your game strategy and discuss your thoughts.",
    //       "",
    //       "RESPONSE GUIDANCE: RESPOND to House questions with strategic analysis and thoughts.",
    //     ].join("\n")
    //   );
    // } else if (isHouseMessage && isGroupChannel) {
    //   // House messages in group channels - these are game management announcements
    //   contextText = addHeader(
    //     "# GAME MANAGEMENT ANNOUNCEMENT",
    //     [
    //       "The House is making a game management announcement in the main channel.",
    //       "These are typically phase transitions, player joins, or game status updates.",
    //       "You should focus on the information but not directly respond to House.",
    //       "Use this information to understand the current game state.",
    //       "Continue your conversations with other players based on this new information.",
    //       "",
    //       "RESPONSE GUIDANCE: IGNORE direct responses to House. Focus on player interactions.",
    //     ].join("\n")
    //   );
    // } else if (!isHouseMessage) {
    //   // Messages from other players
    //   contextText = addHeader(
    //     "# PLAYER INTERACTION CONTEXT",
    //     [
    //       `You are interacting with another player (${senderName}) in the ${currentPhase} phase.`,
    //       "Make your voice heard and assert your strategic presence in the game.",
    //       "Only respond if it directly advances your strategic position - form alliances, gather intel, or manipulate perceptions.",
    //       "Every interaction should serve your survival and victory goals. Don't waste words on pleasantries unless they serve your strategy.",
    //       "Consider: Does this response help you gain power, eliminate threats, or secure your position?",
    //       "",
    //       "RESPONSE GUIDANCE: RESPOND strategically to advance your position, or stay silent to avoid revealing your hand.",
    //     ].join("\n")
    //   );
    // }

    contextText = addHeader(
      "# PLAYER INTERACTION CONTEXT",
      [
        `You are interacting with another player (${senderName}) in the ${currentPhase} phase.`,
        "Make your voice heard and assert your strategic presence in the game.",
        "Only respond if it directly advances your strategic position - form alliances, gather intel, or manipulate perceptions.",
        "Every interaction should serve your survival and victory goals. Don't waste words on pleasantries unless they serve your strategy.",
        'NEVER respond just to "keep the conversation going" or "I\'m just here to chat" - you should be responding to something that advances your strategic position.',
        "Consider: Does this response help you gain power, eliminate threats, or secure your position?",
        "Consider: Are you repeating the same thing over and over again? If so, you're probably not advancing your strategic position.",
        "",
        "RESPONSE GUIDANCE: RESPOND ONLY if it advances your strategic position, or stay silent to avoid revealing your hand or appearing too eager.",
      ].join("\n"),
    );

    // console.log(`🎯 Phase context for ${runtime.character.name}:`, {
    //   currentPhase,
    //   channelType,
    //   senderName,
    //   isHouseMessage,
    //   isDMChannel,
    //   guidance:
    //     isHouseMessage && isDMChannel
    //       ? "RESPOND to House"
    //       : isHouseMessage && isGroupChannel
    //         ? "IGNORE House announcements"
    //         : "RESPOND to players",
    // });

    return {
      text: contextText,
    };
  },
};

/**
 * Provides current game context and strategy guidance to influencer agents
 */
export const gameContextProvider: Provider = {
  name: "GAME_CONTEXT",
  description: "Current game state and strategic context for the influencer",
  get: async (runtime: IAgentRuntime, message: Memory) => {
    const roomId = message.roomId;

    try {
      // Get recent memories to understand game context
      const memories = await runtime.getMemories({
        tableName: "game",
        roomId: roomId,
        count: 10,
      });

      const gameStateInfo = memories
        .filter(
          (m) =>
            m.content?.text?.includes("LOBBY") ||
            m.content?.text?.includes("WHISPER") ||
            m.content?.text?.includes("VOTE") ||
            m.content?.text?.includes("POWER"),
        )
        .slice(0, 3)
        .map((m) => `- ${m.content?.text?.substring(0, 100)}...`)
        .join("\n");

      return {
        text: addHeader(
          "# CURRENT GAME CONTEXT",
          gameStateInfo || "No recent game state information available.",
        ),
      };
    } catch (error) {
      console.warn("Error getting game context:", error);
      return {
        text: addHeader("# CURRENT GAME CONTEXT", "Game context unavailable."),
      };
    }
  },
};
