import {
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  type HandlerCallback,
} from "@elizaos/core";

/**
 * Ignore House game management messages - players should not respond to these
 */
export const ignoreHouseAction: Action = {
  name: "IGNORE_HOUSE",
  description:
    "Ignore House game management messages (players don't respond to these)",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    // Don't respond to own messages
    if (message.entityId === runtime.agentId) {
      return false;
    }

    // Basic validation - any message with text content is potentially valid
    return !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // Explicitly do nothing - this is an ignore action
    return;
  },
  examples: [
    [
      {
        name: "house",
        content: { text: "Alice joined the game! " },
      },
      {
        name: "player",
        content: { text: "", actions: ["IGNORE"] },
      },
    ],
    [
      {
        name: "house",
        content: { text: "🎮 INFLUENCE GAME STARTED! 🎮" },
      },
      {
        name: "player",
        content: { text: "", actions: ["IGNORE"] },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Join the game lobby
 */
export const joinLobbyAction: Action = {
  name: "JOIN_LOBBY",
  description: "Join the Influence game lobby",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    // Only trigger for other agents' messages (not our own)
    return message.entityId !== runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // This action doesn't need to do anything - it's just to trigger the behavior
    // The actual joining logic is handled by the House agent's joinGameAction
    // This action exists to provide examples and context for the player agent
    return;
  },
  examples: [
    [
      {
        name: "player",
        content: { text: "I want to join the game" },
      },
      {
        name: "player",
        content: { text: "Let me join this game" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Request to start the game (host only)
 */
export const requestStartAction: Action = {
  name: "REQUEST_START",
  description: "Request to start the game as host",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // This action doesn't need to do anything - it guides the player's language
    // The actual start logic is handled by the House agent
    return;
  },
  examples: [
    [
      {
        name: "host",
        content: { text: "Let's start the game" },
      },
      {
        name: "host",
        content: { text: "I think we should start the game now" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Create a private room during whisper phase
 */
export const createPrivateRoomAction: Action = {
  name: "CREATE_PRIVATE_ROOM",
  description: "Create a private room with another player during whisper phase",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // This action provides context for the player - actual room creation is handled by House
    return;
  },
  examples: [
    [
      {
        name: "player",
        content: { text: "I want to create a private room with Alice" },
      },
      {
        name: "player",
        content: { text: "Can I whisper with Bob privately?" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Make a public statement during rumor phase
 */
export const publicStatementAction: Action = {
  name: "PUBLIC_STATEMENT",
  description: "Make a public statement during the rumor phase",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // This provides context for public statements during rumor phase
    return;
  },
  examples: [
    [
      {
        name: "player",
        content: {
          text: "I want to make a public statement about my trustworthiness",
        },
      },
      {
        name: "player",
        content: { text: "Let me announce my intentions publicly" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Cast empowerment vote
 */
export const empowerVoteAction: Action = {
  name: "EMPOWER_VOTE",
  description: "Cast a vote to empower another player",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // Voting logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        name: "player",
        content: { text: "I want to empower Alice" },
      },
      {
        name: "player",
        content: { text: "I think Bob should be empowered" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Cast expose vote
 */
export const exposeVoteAction: Action = {
  name: "EXPOSE_VOTE",
  description: "Cast a vote to expose another player",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // Voting logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        name: "player",
        content: { text: "I want to expose Charlie" },
      },
      {
        name: "player",
        content: { text: "I think David should be exposed" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Eliminate an exposed player (empowered player only)
 */
export const eliminateAction: Action = {
  name: "ELIMINATE_PLAYER",
  description: "Eliminate an exposed player (empowered player only)",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // Elimination logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        name: "empowered_player",
        content: { text: "I choose to eliminate Alice" },
      },
      {
        name: "empowered_player",
        content: { text: "I will eliminate Bob" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Protect an exposed player (empowered player only)
 */
export const protectAction: Action = {
  name: "PROTECT_PLAYER",
  description: "Protect an exposed player (empowered player only)",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return message.entityId === runtime.agentId && !!message.content?.text;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback,
  ) => {
    // Protection logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        name: "empowered_player",
        content: { text: "I choose to protect Charlie" },
      },
      {
        name: "empowered_player",
        content: { text: "I will protect David" },
      },
    ],
  ] as ActionExample[][],
};
