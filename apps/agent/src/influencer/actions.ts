import {
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  type HandlerCallback,
} from "@elizaos/core";
import { Phase, GameState, PlayerStatus } from "../house/types";

/**
 * Join the game lobby
 */
export const joinLobbyAction: Action = {
  name: "JOIN_LOBBY",
  description: "Join the Influence game lobby",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const content = message.content.text?.toLowerCase() || "";
    // Only trigger if this is the player's own message about joining
    return (
      message.entityId === runtime.agentId &&
      (content.includes("join") || content.includes("enter")) &&
      content.includes("game")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // This action doesn't need to do anything - it's just to trigger the behavior
    // The actual joining logic is handled by the House agent's joinGameAction
    // This action exists to provide examples and context for the player agent
    return;
  },
  examples: [
    [
      {
        user: "player",
        content: { text: "I want to join the game" },
      },
      {
        user: "player",
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
    const content = message.content.text?.toLowerCase() || "";
    return (
      message.entityId === runtime.agentId &&
      content.includes("start") &&
      content.includes("game")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // This action doesn't need to do anything - it guides the player's language
    // The actual start logic is handled by the House agent
    return;
  },
  examples: [
    [
      {
        user: "host",
        content: { text: "Let's start the game" },
      },
      {
        user: "host",
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
    const content = message.content.text?.toLowerCase() || "";
    const gameState = state.values?.gameState as GameState;
    
    return (
      message.entityId === runtime.agentId &&
      gameState?.phase === Phase.WHISPER &&
      ((content.includes("private") && content.includes("room")) ||
       content.includes("whisper") ||
       content.includes("dm")) &&
      content.includes("with")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // This action provides context for the player - actual room creation is handled by House
    return;
  },
  examples: [
    [
      {
        user: "player",
        content: { text: "I want to create a private room with Alice" },
      },
      {
        user: "player",
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
    const gameState = state.values?.gameState as GameState;
    const content = message.content.text?.toLowerCase() || "";
    
    return (
      message.entityId === runtime.agentId &&
      gameState?.phase === Phase.RUMOR &&
      (content.includes("public") || content.includes("announce") || content.includes("statement"))
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // This provides context for public statements during rumor phase
    return;
  },
  examples: [
    [
      {
        user: "player",
        content: { text: "I want to make a public statement about my trustworthiness" },
      },
      {
        user: "player",
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
    const gameState = state.values?.gameState as GameState;
    const content = message.content.text?.toLowerCase() || "";
    
    return (
      message.entityId === runtime.agentId &&
      gameState?.phase === Phase.VOTE &&
      content.includes("empower")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // Voting logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        user: "player",
        content: { text: "I want to empower Alice" },
      },
      {
        user: "player",
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
    const gameState = state.values?.gameState as GameState;
    const content = message.content.text?.toLowerCase() || "";
    
    return (
      message.entityId === runtime.agentId &&
      gameState?.phase === Phase.VOTE &&
      content.includes("expose")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // Voting logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        user: "player",
        content: { text: "I want to expose Charlie" },
      },
      {
        user: "player",
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
    const gameState = state.values?.gameState as GameState;
    const content = message.content.text?.toLowerCase() || "";
    
    return (
      message.entityId === runtime.agentId &&
      gameState?.phase === Phase.POWER &&
      gameState?.empoweredPlayer === runtime.agentId &&
      content.includes("eliminate")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // Elimination logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        user: "empowered_player",
        content: { text: "I choose to eliminate Alice" },
      },
      {
        user: "empowered_player",
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
    const gameState = state.values?.gameState as GameState;
    const content = message.content.text?.toLowerCase() || "";
    
    return (
      message.entityId === runtime.agentId &&
      gameState?.phase === Phase.POWER &&
      gameState?.empoweredPlayer === runtime.agentId &&
      content.includes("protect")
    );
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    // Protection logic would be handled by House - this provides context
    return;
  },
  examples: [
    [
      {
        user: "empowered_player",
        content: { text: "I choose to protect Charlie" },
      },
      {
        user: "empowered_player",
        content: { text: "I will protect David" },
      },
    ],
  ] as ActionExample[][],
};