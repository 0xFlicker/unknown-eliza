import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ModelType,
  UUID,
} from "@elizaos/core";
import { Phase, PlayerStatus, GameState } from "./types";
import { getGameState, hasAuthorName } from "./runtime/memory";

/**
 * Provides current game state information to the House agent
 */
export const gameStateProvider: Provider = {
  name: "GAME_STATE",
  description:
    "Provides information about the current game state, phase, and players",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = await getGameState(runtime, message.roomId);

    if (!gameState) {
      return {
        text: "No active game. Players can join by saying 'join game'.",
        data: { phase: Phase.INIT, hasGame: false },
      };
    }

    const alivePlayers = Array.from(gameState.players.values()).filter(
      (p) => p.status === PlayerStatus.ALIVE,
    );

    const exposedPlayers = Array.from(gameState.players.values()).filter((p) =>
      gameState.exposedPlayers.has(p.id),
    );

    const phaseDescription = getPhaseDescription(gameState.phase);
    const timeRemaining = gameState.timerEndsAt
      ? Math.max(0, gameState.timerEndsAt - Date.now())
      : 0;

    let stateText = `Game Phase: ${gameState.phase} (Round ${gameState.round})\n`;
    stateText += `Players: ${alivePlayers.length} alive`;

    if (gameState.phase !== Phase.INIT) {
      stateText += `\n${phaseDescription}`;
      if (timeRemaining > 0) {
        stateText += `\nTime remaining: ${Math.ceil(timeRemaining / 1000)}s`;
      }
    }

    if (gameState.empoweredPlayer) {
      const empowered = gameState.players.get(gameState.empoweredPlayer);
      stateText += `\nEmpowered: ${empowered?.name}`;
    }

    if (exposedPlayers.length > 0) {
      stateText += `\nExposed: ${exposedPlayers.map((p) => p.name).join(", ")}`;
    }

    return {
      text: stateText,
      data: {
        phase: gameState.phase,
        round: gameState.round,
        playerCount: alivePlayers.length,
        empoweredPlayer: gameState.empoweredPlayer,
        exposedPlayers: Array.from(gameState.exposedPlayers),
        timeRemaining,
        hasGame: true,
        isActive: gameState.isActive,
      },
    };
  },
};

/**
 * Provides context about what actions are available in the current phase
 */
export const phaseActionsProvider: Provider = {
  name: "PHASE_ACTIONS",
  description: "Describes what actions players can take in the current phase",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = await getGameState(runtime, message.roomId);

    if (!gameState) {
      return {
        text: "Available: Players can 'join game'. Host can 'start game' with ≥4 players.",
        data: { availableActions: ["join_game", "start_game"] },
      };
    }

    const actions = getAvailableActions(gameState.phase);
    const actionsText = `Available actions for ${gameState.phase}: ${actions.join(", ")}`;

    return {
      text: actionsText,
      data: {
        phase: gameState.phase,
        listenFor: actions,
      },
    };
  },
};

/**
 * Provides information about player relationships and alliances
 */
export const playerRelationsProvider: Provider = {
  name: "PLAYER_RELATIONS",
  description:
    "Tracks player interactions and potential alliances based on private room usage",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = await getGameState(runtime, message.roomId);

    if (!gameState) {
      return {
        text: "No game active - no player relationships to track.",
        data: { relationships: {} },
      };
    }

    const relationships: Record<string, string[]> = {};

    // Track private room relationships
    for (const room of gameState.privateRooms.values()) {
      if (room.active && room.participants.length === 2) {
        const [p1, p2] = room.participants;
        const player1 = gameState.players.get(p1);
        const player2 = gameState.players.get(p2);

        if (player1 && player2) {
          if (!relationships[player1.name]) relationships[player1.name] = [];
          if (!relationships[player2.name]) relationships[player2.name] = [];

          if (!relationships[player1.name].includes(player2.name)) {
            relationships[player1.name].push(player2.name);
          }
          if (!relationships[player2.name].includes(player1.name)) {
            relationships[player2.name].push(player1.name);
          }
        }
      }
    }

    const relationsText =
      Object.keys(relationships).length > 0
        ? `Private conversations: ${Object.entries(relationships)
            .map(([player, contacts]) => `${player} ↔ ${contacts.join(", ")}`)
            .join("; ")}`
        : "No private conversations yet.";

    return {
      text: relationsText,
      data: { relationships },
    };
  },
};

/**
 * Game Master Decision Provider - Helps House agent decide what actions to take
 */
export const gameMasterProvider: Provider = {
  name: "GAME_MASTER_CONTEXT",
  description:
    "Provides contextual information to help the House agent make game management decisions",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = await getGameState(runtime, message.roomId);
    const messageText = message.content.text || "";

    // Get author name using ElizaOS standard pattern
    const authorName: string =
      (message.metadata as any)?.authorName ??
      (message.metadata as any)?.entityName ??
      (message.metadata as any)?.username ??
      (message.metadata as any)?.raw?.senderName ??
      gameState?.players.get(message.entityId)?.name ??
      `Player-${message.entityId.slice(0, 8)}`;

    // Don't respond to own messages
    if (message.entityId === runtime.agentId) {
      return {
        text: "This is my own message - no response needed.",
        data: { shouldRespond: false, reasoning: "own_message" },
      };
    }

    let context = `You are The House, the game master for Influence.\n\n`;

    if (!gameState) {
      context += `CURRENT STATE: No game exists yet. Waiting for players to join.\n`;
      context += `RECENT MESSAGE: "${messageText}" from ${authorName}\n\n`;
      context += `AVAILABLE ACTIONS:\n`;
      context += `- When a player joins, respond: "${authorName} joined the game!"\n`;
      context += `- Once we have 4+ players, the host can start the game\n`;
    } else {
      const alivePlayers = Array.from(gameState.players.values()).filter(
        (p) => p.status === PlayerStatus.ALIVE,
      );
      context += `CURRENT GAME STATE:\n`;
      context += `- Phase: ${gameState.phase}\n`;
      context += `- Round: ${gameState.round}\n`;
      context += `- Players: ${alivePlayers.length} (${alivePlayers.map((p) => p.name).join(", ")})\n`;
      context += `- Host: ${alivePlayers.find((p) => p.isHost)?.name || "None"}\n\n`;

      context += `RECENT MESSAGE: "${messageText}" from ${authorName}\n`;
      context += `PLAYER INFO: The player speaking is "${authorName}"\n\n`;

      switch (gameState.phase) {
        case Phase.INIT:
          context += `INIT PHASE ACTIONS:\n`;
          context += `- When a player joins, respond: "${authorName} joined the game!"\n`;
          context += `- When host starts with 4+ players: "🎮 INFLUENCE GAME STARTED! 🎮"\n`;
          context += `- Current players: ${alivePlayers.map((p) => p.name).join(", ")}\n`;
          break;
        case Phase.LOBBY:
          context += `LOBBY PHASE: Players can chat freely. Private messages disabled.\n`;
          context += `- After timer expires, transition to WHISPER phase\n`;
          break;
        case Phase.WHISPER:
          context += `WHISPER PHASE ACTIONS:\n`;
          context += `- Help players create private rooms for secret conversations\n`;
          context += `- After timer expires, transition to RUMOR phase\n`;
          break;
        case Phase.RUMOR:
          context += `RUMOR PHASE: Each player makes one public statement.\n`;
          break;
        case Phase.VOTE:
          context += `VOTE PHASE: Players vote to empower one and expose others.\n`;
          break;
        case Phase.POWER:
          context += `POWER PHASE: Empowered player eliminates or protects someone.\n`;
          break;
        case Phase.REVEAL:
          context += `REVEAL PHASE: Announce results and check for game end.\n`;
          break;
      }
    }

    return {
      text: context,
      data: {
        shouldRespond: true,
        gameState: gameState
          ? {
              phase: gameState.phase,
              round: gameState.round,
              playerCount: gameState.players.size,
              isActive: gameState.isActive,
            }
          : null,
        messageAuthor: authorName,
        messageText,
      },
    };
  },
};

/**
 * Helper function to get phase description
 */
function getPhaseDescription(phase: Phase): string {
  switch (phase) {
    case Phase.INIT:
      return "Waiting room - players joining";
    case Phase.LOBBY:
      return "Public mixer - free chat in main channel";
    case Phase.WHISPER:
      return "Private conversations and alliance building";
    case Phase.RUMOR:
      return "Public messaging phase - one message per player";
    case Phase.VOTE:
      return "Voting phase - empower one, expose any";
    case Phase.POWER:
      return "Empowered player must eliminate or protect";
    case Phase.REVEAL:
      return "Results revealed";
    default:
      return "Unknown phase";
  }
}

/**
 * Helper function to get available actions for a phase
 */
function getAvailableActions(phase: Phase): string[] {
  switch (phase) {
    case Phase.INIT:
      return ["join game", "start game (host only)"];
    case Phase.LOBBY:
      return ["chat freely", "form initial impressions"];
    case Phase.WHISPER:
      return ["request private room with [player]", "whisper privately"];
    case Phase.RUMOR:
      return ["post public message"];
    case Phase.VOTE:
      return ["empower [player]", "expose [player]"];
    case Phase.POWER:
      return ["eliminate [exposed player]", "protect [exposed player]"];
    case Phase.REVEAL:
      return ["wait for results"];
    default:
      return [];
  }
}
