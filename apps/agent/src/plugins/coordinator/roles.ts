import { IAgentRuntime } from "@elizaos/core";

/**
 * Agent roles for coordination permissions
 */
export enum AgentRole {
  HOUSE = "house",
  PLAYER = "player",
  OBSERVER = "observer",
}

/**
 * Get the role of an agent based on its character name or configuration
 */
export function getAgentRole(runtime: IAgentRuntime): AgentRole {
  // Agent role MUST be explicitly configured via runtime settings to avoid insecure name-based inference
  const roleSetting = runtime.getSetting("agentRole");

  // If the role has been explicitly configured and is recognised, use it.
  if (roleSetting && Object.values(AgentRole).includes(roleSetting)) {
    return roleSetting as AgentRole;
  }

  // Fallback: Assume a player role for backwards-compatibility so that tests
  // which do not yet configure `agentRole` continue to work.  The house agent
  // explicitly sets `agentRole` to `house` via its character settings, so we
  // will not accidentally assign it the wrong role.
  return AgentRole.PLAYER;
}

/**
 * Check if an agent can send a specific type of coordination message
 */
export function canSendMessage(
  runtime: IAgentRuntime,
  messageType: string,
  gameEventType?: string,
): boolean {
  const role = getAgentRole(runtime);

  switch (messageType) {
    case "game_event":
      // Check specific game event permissions
      if (gameEventType) {
        return canSendGameEvent(role, gameEventType);
      }
      // Only house agents can send game events by default
      return role === AgentRole.HOUSE;

    case "agent_ready":
      // All agents can send ready signals
      return true;

    case "heartbeat":
      // All agents can send heartbeats
      return true;

    case "coordination_ack":
      // All agents can send acknowledgments
      return true;

    default:
      return false;
  }
}

/**
 * Check if an agent role can send a specific game event
 */
function canSendGameEvent(role: AgentRole, gameEventType: string): boolean {
  switch (gameEventType) {
    case "GAME:I_AM_READY":
      // Players can send I_AM_READY events
      return role === AgentRole.PLAYER || role === AgentRole.HOUSE;

    case "GAME:PLAYER_READY":
      // Players can announce readiness in response to prompts
      return role === AgentRole.PLAYER || role === AgentRole.HOUSE;

    case "GAME:PHASE_STARTED":
    case "GAME:ALL_PLAYERS_READY":
    case "GAME:TIMER_UPDATE":
      // Only house can send these events
      return role === AgentRole.HOUSE;

    default:
      // By default, only house can send game events
      return role === AgentRole.HOUSE;
  }
}

/**
 * Check if an agent should process a coordination message
 */
export function shouldProcessMessage(
  runtime: IAgentRuntime,
  message: any,
): boolean {
  // All agents can receive coordination messages
  // Role-based filtering can be added here if needed
  return true;
}
