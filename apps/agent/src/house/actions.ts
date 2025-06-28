import {
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  stringToUuid,
  type HandlerCallback,
} from "@elizaos/core";
import {
  GameState,
  Player,
  Phase,
  PlayerStatus,
  DEFAULT_GAME_SETTINGS,
  GameEvent,
  PrivateRoom,
} from "./types";

/**
 * Join the game lobby
 */
export const joinGameAction: Action = {
  name: "JOIN_GAME",
  description: "Join the Influence game lobby",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    // Only validate if the message contains "join" and we're in INIT phase
    const content = message.content.text?.toLowerCase() || "";
    return content.includes("join") && content.includes("game");
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      // Get or create game state
      let gameState = state.values?.gameState as GameState;
      if (!gameState) {
        gameState = createNewGame(runtime.agentId);
        await runtime.createMemory({
          id: stringToUuid("game-state"),
          entityId: runtime.agentId,
          roomId: message.roomId,
          content: {
            text: "Game state initialized",
            source: "house",
            metadata: { gameState },
          },
        });
      }

      // Add player to the game
      const playerId = message.entityId;
      const agentName = message.metadata?.authorName || `Player-${playerId.slice(0, 8)}`;

      if (gameState.players.has(playerId)) {
        await callback?.({
          text: `${agentName} is already in the game.`,
          source: "house",
        });
        return;
      }

      if (gameState.players.size >= gameState.settings.maxPlayers) {
        await callback?.({
          text: `Game is full (${gameState.settings.maxPlayers} players max).`,
          source: "house",
        });
        return;
      }

      const player: Player = {
        id: playerId,
        agentId: playerId,
        name: agentName,
        status: PlayerStatus.ALIVE,
        isHost: gameState.players.size === 0, // First player is host
        joinedAt: Date.now(),
      };

      gameState.players.set(playerId, player);
      if (player.isHost) {
        gameState.hostId = playerId;
      }

      // Record the join event
      const event: GameEvent = {
        id: stringToUuid(`join-${playerId}-${Date.now()}`),
        type: "PLAYER_JOINED",
        playerId,
        phase: gameState.phase,
        round: gameState.round,
        timestamp: Date.now(),
        details: { playerName: agentName },
      };
      gameState.history.push(event);

      await callback?.({
        text: `${agentName} joined the game! (${gameState.players.size}/${gameState.settings.maxPlayers} players)${
          player.isHost ? " You are the host - type 'start game' when ready." : ""
        }`,
        source: "house",
      });
    } catch (error) {
      console.error("Error in joinGameAction:", error);
      await callback?.({
        text: "Error joining game. Please try again.",
        source: "house",
      });
    }
  },
  examples: [
    [
      {
        user: "user1",
        content: { text: "I want to join the game" },
      },
      {
        user: "house",
        content: { text: "user1 joined the game! (1/12 players)" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Start the game (host only)
 */
export const startGameAction: Action = {
  name: "START_GAME",
  description: "Start the Influence game (host only)",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const content = message.content.text?.toLowerCase() || "";
    return content.includes("start") && content.includes("game");
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      const gameState = state.values?.gameState as GameState;
      if (!gameState) {
        await callback?.({
          text: "No game found. Someone needs to join first.",
          source: "house",
        });
        return;
      }

      const playerId = message.entityId;
      const player = gameState.players.get(playerId);

      if (!player?.isHost) {
        await callback?.({
          text: "Only the host can start the game.",
          source: "house",
        });
        return;
      }

      if (gameState.players.size < gameState.settings.minPlayers) {
        await callback?.({
          text: `Need at least ${gameState.settings.minPlayers} players to start (currently ${gameState.players.size}).`,
          source: "house",
        });
        return;
      }

      if (gameState.phase !== Phase.INIT) {
        await callback?.({
          text: "Game has already started.",
          source: "house",
        });
        return;
      }

      // Transition to WHISPER phase
      gameState.phase = Phase.WHISPER;
      gameState.round = 1;
      gameState.isActive = true;
      gameState.timerEndsAt = Date.now() + gameState.settings.timers.whisper;

      const event: GameEvent = {
        id: stringToUuid(`start-${Date.now()}`),
        type: "GAME_STARTED",
        playerId,
        phase: gameState.phase,
        round: gameState.round,
        timestamp: Date.now(),
        details: { playerCount: gameState.players.size },
      };
      gameState.history.push(event);

      const playerList = Array.from(gameState.players.values())
        .map(p => p.name)
        .join(", ");

      await callback?.({
        text: `🎮 INFLUENCE GAME STARTED! 🎮\n\nPlayers: ${playerList}\n\n**WHISPER PHASE** (Round ${gameState.round})\nYou have ${gameState.settings.timers.whisper / 60000} minutes to create private rooms and conspire. Use 'request private room with [player]' to start private conversations.`,
        source: "house",
      });
    } catch (error) {
      console.error("Error in startGameAction:", error);
      await callback?.({
        text: "Error starting game. Please try again.",
        source: "house",
      });
    }
  },
  examples: [
    [
      {
        user: "host",
        content: { text: "start the game" },
      },
      {
        user: "house",
        content: { text: "🎮 INFLUENCE GAME STARTED! 🎮\n\nWHISPER PHASE (Round 1)" },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Request a private room for whisper phase
 */
export const requestPrivateRoomAction: Action = {
  name: "REQUEST_PRIVATE_ROOM",
  description: "Request a private room with another player during WHISPER phase",
  validate: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const content = message.content.text?.toLowerCase() || "";
    return (
      (content.includes("private") && content.includes("room")) ||
      (content.includes("dm") || content.includes("whisper"))
    ) && content.includes("with");
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ) => {
    try {
      const gameState = state.values?.gameState as GameState;
      if (!gameState?.isActive) {
        await callback?.({
          text: "No active game found.",
          source: "house",
        });
        return;
      }

      if (gameState.phase !== Phase.WHISPER) {
        await callback?.({
          text: "Private rooms can only be created during the WHISPER phase.",
          source: "house",
        });
        return;
      }

      const requesterId = message.entityId;
      const requester = gameState.players.get(requesterId);

      if (!requester || requester.status !== PlayerStatus.ALIVE) {
        await callback?.({
          text: "Only living players can request private rooms.",
          source: "house",
        });
        return;
      }

      // Parse target player from message
      const content = message.content.text || "";
      const withMatch = content.match(/with\s+([^\s]+)/i);
      const targetName = withMatch?.[1];

      if (!targetName) {
        await callback?.({
          text: "Please specify who you want to create a private room with: 'request private room with [player]'",
          source: "house",
        });
        return;
      }

      // Find target player
      const targetPlayer = Array.from(gameState.players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase()
      );

      if (!targetPlayer) {
        await callback?.({
          text: `Player '${targetName}' not found.`,
          source: "house",
        });
        return;
      }

      if (targetPlayer.status !== PlayerStatus.ALIVE) {
        await callback?.({
          text: `${targetPlayer.name} is not alive and cannot join private rooms.`,
          source: "house",
        });
        return;
      }

      if (targetPlayer.id === requesterId) {
        await callback?.({
          text: "You cannot create a private room with yourself.",
          source: "house",
        });
        return;
      }

      // Check if room already exists
      const existingRoom = Array.from(gameState.privateRooms.values()).find(
        room => 
          room.active &&
          room.participants.includes(requesterId) &&
          room.participants.includes(targetPlayer.id)
      );

      if (existingRoom) {
        await callback?.({
          text: `You already have a private room with ${targetPlayer.name}.`,
          source: "house",
        });
        return;
      }

      // Create private room
      const roomId = stringToUuid(`room-${requesterId}-${targetPlayer.id}-${Date.now()}`);
      const privateRoom: PrivateRoom = {
        id: roomId,
        participants: [requesterId, targetPlayer.id],
        createdBy: requesterId,
        createdAt: Date.now(),
        active: true,
      };

      gameState.privateRooms.set(roomId, privateRoom);

      const event: GameEvent = {
        id: stringToUuid(`private-room-${Date.now()}`),
        type: "PRIVATE_ROOM_CREATED",
        playerId: requesterId,
        targetId: targetPlayer.id,
        phase: gameState.phase,
        round: gameState.round,
        timestamp: Date.now(),
        details: { roomId, participants: [requester.name, targetPlayer.name] },
      };
      gameState.history.push(event);

      await callback?.({
        text: `🔒 Private room created between ${requester.name} and ${targetPlayer.name}. You can now whisper privately.`,
        source: "house",
      });
    } catch (error) {
      console.error("Error in requestPrivateRoomAction:", error);
      await callback?.({
        text: "Error creating private room. Please try again.",
        source: "house",
      });
    }
  },
  examples: [
    [
      {
        user: "player1",
        content: { text: "request private room with player2" },
      },
      {
        user: "house",
        content: { text: "🔒 Private room created between player1 and player2." },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Utility function to create a new game
 */
function createNewGame(houseAgentId: string): GameState {
  return {
    id: stringToUuid(`game-${Date.now()}`),
    phase: Phase.INIT,
    round: 0,
    players: new Map(),
    votes: [],
    privateRooms: new Map(),
    exposedPlayers: new Set(),
    settings: { ...DEFAULT_GAME_SETTINGS },
    history: [],
    isActive: false,
  };
}