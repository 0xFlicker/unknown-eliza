import {
  Action,
  ActionExample,
  IAgentRuntime,
  Memory,
  State,
  stringToUuid,
  type HandlerCallback,
} from "@elizaos/core";
import { GameEvent, Player, Phase, PlayerStatus, PrivateRoom } from "./types";
import {
  getGameState,
  saveGameState,
  createNewGame,
  getAuthorName,
} from "./runtime/memory";

/**
 * Join the game lobby
 */
export const joinGameAction: Action = {
  name: "JOIN_GAME",
  description: "Join the Influence game lobby",
  validate: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
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
    _state: State,
    _options: any,
  ) => {
    try {
      // Get or create game state
      let gameState = await getGameState(runtime, message.roomId);
      if (!gameState) {
        gameState = createNewGame(runtime.agentId);
        await saveGameState(runtime, message.roomId, gameState);
      }

      // Add player to the game
      const playerId = message.entityId;

      // Safely extract agent name from metadata
      const agentName = getAuthorName(message);

      if (gameState.players.has(playerId)) {
        return; // Already in game, no need to respond
      }

      if (gameState.players.size >= gameState.settings.maxPlayers) {
        return; // Game full, no need to respond
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

      // Save updated game state
      await saveGameState(runtime, message.roomId, gameState);

      // Don't call callback - let the LLM generate response based on updated state and examples
    } catch (error) {
      console.error("Error in joinGameAction:", error);
      return; // Don't respond on error
    }
  },
  examples: [
    [
      {
        name: "player",
        content: { text: "I want to join the game" },
      },
      {
        name: "house",
        content: { text: "player joined the game! (1/12 players)" },
      },
    ],
    [
      {
        name: "newbie",
        content: { text: "Can I join?" },
      },
      {
        name: "house",
        content: { text: "newbie joined the game! (2/12 players)" },
      },
    ],
    [
      {
        name: "alice",
        content: { text: "Let me join this game please" },
      },
      {
        name: "house",
        content: { text: "alice joined the game! (3/12 players)" },
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
  validate: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
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
    _state: State,
    _options: any,
  ) => {
    try {
      const gameState = await getGameState(runtime, message.roomId);
      if (!gameState) {
        return; // No game found, don't respond
      }

      const playerId = message.entityId;
      const player = gameState.players.get(playerId);

      if (!player?.isHost) {
        return; // Not host, don't respond
      }

      if (gameState.players.size < gameState.settings.minPlayers) {
        return; // Not enough players, don't respond
      }

      if (gameState.phase !== Phase.INIT) {
        return; // Game already started, don't respond
      }

      // Transition to LOBBY phase
      gameState.phase = Phase.LOBBY;
      gameState.round = 0; // Lobby is pre-game
      gameState.isActive = true;
      gameState.timerEndsAt = Date.now() + gameState.settings.timers.lobby;

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

      // Save updated game state
      await saveGameState(runtime, message.roomId, gameState);

      // Don't call callback - let the LLM generate response based on updated state and examples
    } catch (error) {
      console.error("Error in startGameAction:", error);
      return; // Don't respond on error
    }
  },
  examples: [
    [
      {
        name: "host",
        content: { text: "start the game" },
      },
      {
        name: "house",
        content: {
          text: "🎮 INFLUENCE GAME STARTED! 🎮\n\nLOBBY PHASE - Public Mixer",
        },
      },
    ],
    [
      {
        name: "host",
        content: { text: "Let's start the game now" },
      },
      {
        name: "house",
        content: {
          text: "🎮 INFLUENCE GAME STARTED! 🎮\n\nLOBBY PHASE - Public Mixer",
        },
      },
    ],
    [
      {
        name: "host",
        content: { text: "I think we should begin" },
      },
      {
        name: "house",
        content: {
          text: "🎮 INFLUENCE GAME STARTED! 🎮\n\nLOBBY PHASE - Public Mixer",
        },
      },
    ],
  ] as ActionExample[][],
};

/**
 * Request a private room for whisper phase
 */
export const requestPrivateRoomAction: Action = {
  name: "REQUEST_PRIVATE_ROOM",
  description:
    "Request a private room with another player during WHISPER phase",
  validate: async (runtime: IAgentRuntime, message: Memory, _state: State) => {
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
    _state: State,
    _options: any,
    callback?: HandlerCallback,
  ) => {
    try {
      const gameState = await getGameState(runtime, message.roomId);
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
        (p) => p.name.toLowerCase() === targetName.toLowerCase(),
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
        (room) =>
          room.active &&
          room.participants.includes(requesterId) &&
          room.participants.includes(targetPlayer.id),
      );

      if (existingRoom) {
        await callback?.({
          text: `You already have a private room with ${targetPlayer.name}.`,
          source: "house",
        });
        return;
      }

      // Create private room
      const roomId = stringToUuid(
        `room-${requesterId}-${targetPlayer.id}-${Date.now()}`,
      );
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

      // Save updated game state
      await saveGameState(runtime, message.roomId, gameState);

      // Don't call callback - let the LLM generate response based on updated state and examples
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
        name: "player1",
        content: { text: "request private room with player2" },
      },
      {
        name: "house",
        content: {
          text: "🔒 Private room created between player1 and player2.",
        },
      },
    ],
  ] as ActionExample[][],
};
