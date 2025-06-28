import { Provider, IAgentRuntime, Memory, State } from "@elizaos/core";
import { GameState, Phase, PlayerStatus } from "./types";

/**
 * Provides current game state information to the House agent
 */
export const gameStateProvider: Provider = {
  name: "GAME_STATE",
  description: "Provides information about the current game state, phase, and players",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state.values?.gameState as GameState;
    
    if (!gameState) {
      return {
        text: "No active game. Players can join by saying 'join game'.",
        data: { phase: Phase.INIT, hasGame: false },
      };
    }

    const alivePlayers = Array.from(gameState.players.values()).filter(
      p => p.status === PlayerStatus.ALIVE
    );
    
    const exposedPlayers = Array.from(gameState.players.values()).filter(
      p => gameState.exposedPlayers.has(p.id)
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
      stateText += `\nExposed: ${exposedPlayers.map(p => p.name).join(", ")}`;
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
    const gameState = state.values?.gameState as GameState;
    
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
        availableActions: actions,
      },
    };
  },
};

/**
 * Provides information about player relationships and alliances
 */
export const playerRelationsProvider: Provider = {
  name: "PLAYER_RELATIONS",
  description: "Tracks player interactions and potential alliances based on private room usage",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state.values?.gameState as GameState;
    
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

    const relationsText = Object.keys(relationships).length > 0
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
 * Helper function to get phase description
 */
function getPhaseDescription(phase: Phase): string {
  switch (phase) {
    case Phase.INIT:
      return "Lobby phase - players joining";
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