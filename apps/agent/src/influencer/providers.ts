import { Provider, IAgentRuntime, Memory, State } from "@elizaos/core";
import { Phase, GameState, PlayerStatus } from "../house/types";

/**
 * Provides current game context and strategy guidance to influencer agents
 */
export const gameContextProvider: Provider = {
  name: "GAME_CONTEXT",
  description: "Provides current game phase, objectives, and strategic guidance",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state?.values?.gameState as GameState;
    
    if (!gameState) {
      return {
        text: "No active game. You can join by saying 'I want to join the game'.",
        data: { phase: Phase.INIT, inGame: false },
      };
    }

    const playerId = runtime.agentId;
    const player = gameState.players.get(playerId);
    
    if (!player) {
      return {
        text: "You are not in the current game. Join by saying 'I want to join the game'.",
        data: { phase: gameState.phase, inGame: false },
      };
    }

    const phaseGuidance = getPhaseGuidance(gameState.phase, player, gameState);
    const strategicContext = getStrategicContext(player, gameState);

    return {
      text: `${phaseGuidance}\n\n${strategicContext}`,
      data: {
        phase: gameState.phase,
        round: gameState.round,
        inGame: true,
        isAlive: player.status === PlayerStatus.ALIVE,
        isHost: player.isHost,
        isEmpowered: gameState.empoweredPlayer === playerId,
        isExposed: gameState.exposedPlayers.has(playerId),
      },
    };
  },
};

/**
 * Provides information about other players and potential allies/threats
 */
export const playerAnalysisProvider: Provider = {
  name: "PLAYER_ANALYSIS",
  description: "Analyzes other players for alliance and threat assessment",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state?.values?.gameState as GameState;
    
    if (!gameState || !gameState.players.has(runtime.agentId)) {
      return {
        text: "No game data available for player analysis.",
        data: { players: [] },
      };
    }

    const myId = runtime.agentId;
    const otherPlayers = Array.from(gameState.players.values())
      .filter(p => p.id !== myId && p.status === PlayerStatus.ALIVE);

    const playerAnalysis = otherPlayers.map(player => {
      const isExposed = gameState.exposedPlayers.has(player.id);
      const isEmpowered = gameState.empoweredPlayer === player.id;
      
      // Check if we have private conversations with this player
      const hasPrivateRoom = Array.from(gameState.privateRooms.values())
        .some(room => 
          room.active && 
          room.participants.includes(myId) && 
          room.participants.includes(player.id)
        );

      return {
        name: player.name,
        id: player.id,
        isExposed,
        isEmpowered,
        hasPrivateRoom,
        threat: isEmpowered ? "high" : isExposed ? "low" : "medium",
        alliance: hasPrivateRoom ? "potential" : "unknown",
      };
    });

    const analysisText = playerAnalysis.length > 0
      ? `Other players: ${playerAnalysis.map(p => 
          `${p.name}${p.isEmpowered ? "(empowered)" : ""}${p.isExposed ? "(exposed)" : ""}${p.hasPrivateRoom ? "(ally?)" : ""}`
        ).join(", ")}`
      : "No other players to analyze.";

    return {
      text: analysisText,
      data: { players: playerAnalysis },
    };
  },
};

/**
 * Provides strategic recommendations based on current game state
 */
export const strategyProvider: Provider = {
  name: "STRATEGY_ADVICE",
  description: "Provides strategic recommendations for the current game situation",
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const gameState = state?.values?.gameState as GameState;
    
    if (!gameState || !gameState.players.has(runtime.agentId)) {
      return {
        text: "Join the game to receive strategic guidance.",
        data: { strategies: [] },
      };
    }

    const myId = runtime.agentId;
    const me = gameState.players.get(myId)!;
    const strategies = generateStrategies(me, gameState);

    return {
      text: `Strategic considerations: ${strategies.join("; ")}`,
      data: { strategies },
    };
  },
};

/**
 * Helper function to get phase-specific guidance
 */
function getPhaseGuidance(phase: Phase, player: any, gameState: GameState): string {
  switch (phase) {
    case Phase.INIT:
      if (player.isHost) {
        return `LOBBY PHASE: You are the host. Start the game when you have at least ${gameState.settings.minPlayers} players by saying "start the game".`;
      }
      return "LOBBY PHASE: Build initial trust and relationships. The host will start when ready.";
    
    case Phase.WHISPER:
      return "WHISPER PHASE: Form private alliances! Request private rooms with potential allies by saying 'request private room with [player]'.";
    
    case Phase.RUMOR:
      return "RUMOR PHASE: Make your one public statement count. Build trust or mislead strategically.";
    
    case Phase.VOTE:
      return "VOTE PHASE: Vote to empower someone you trust AND expose someone you suspect. Choose wisely!";
    
    case Phase.POWER:
      if (gameState.empoweredPlayer === player.id) {
        return "POWER PHASE: You are empowered! Choose to eliminate or protect an exposed player.";
      }
      return "POWER PHASE: The empowered player is deciding. Hope you're not exposed!";
    
    case Phase.REVEAL:
      return "REVEAL PHASE: Results are being announced. Prepare for the next round if you survive.";
    
    default:
      return "Unknown phase - stay alert!";
  }
}

/**
 * Helper function to get strategic context
 */
function getStrategicContext(player: any, gameState: GameState): string {
  const alivePlayers = Array.from(gameState.players.values())
    .filter(p => p.status === PlayerStatus.ALIVE);
  
  let context = `${alivePlayers.length} players remain alive.`;
  
  if (gameState.empoweredPlayer && gameState.empoweredPlayer !== player.id) {
    const empowered = gameState.players.get(gameState.empoweredPlayer);
    context += ` ${empowered?.name} is empowered.`;
  }
  
  if (gameState.exposedPlayers.size > 0) {
    context += ` ${gameState.exposedPlayers.size} player(s) exposed.`;
  }
  
  return context;
}

/**
 * Helper function to generate strategic recommendations
 */
function generateStrategies(player: any, gameState: GameState): string[] {
  const strategies: string[] = [];
  const alivePlayers = Array.from(gameState.players.values())
    .filter(p => p.status === PlayerStatus.ALIVE);
  
  switch (gameState.phase) {
    case Phase.WHISPER:
      if (alivePlayers.length > 4) {
        strategies.push("Form a small trusted alliance");
        strategies.push("Gather information about others' intentions");
      }
      break;
    
    case Phase.VOTE:
      strategies.push("Empower someone you can influence");
      strategies.push("Expose the biggest threat");
      if (gameState.exposedPlayers.has(player.id)) {
        strategies.push("You're exposed - convince the empowered player to protect you");
      }
      break;
    
    case Phase.POWER:
      if (gameState.empoweredPlayer === player.id) {
        strategies.push("Eliminate the most dangerous opponent");
        strategies.push("Or protect an ally to gain loyalty");
      }
      break;
  }
  
  return strategies;
}
