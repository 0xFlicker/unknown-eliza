import { UUID } from "@elizaos/core";
import { AgentChannelAssociation, ChannelParticipant } from "./types";

/**
 * Simplified association manager for tracking agent-channel relationships
 *
 * This handles the complexity of:
 * - Each agent needs to know about all other agents in each channel
 * - Each channel has a single room where roomId equals channelId
 * - Each agent needs entities for all other agents in each channel
 * - Participant states and modes must be tracked per agent-channel pair
 */
export class AssociationManager {
  // Primary storage: agentId -> channelId -> association
  private agentToChannelAssociations = new Map<
    UUID,
    Map<UUID, AgentChannelAssociation>
  >();

  // Reverse lookup: channelId -> agentId -> association
  private channelToAgentAssociations = new Map<
    UUID,
    Map<UUID, AgentChannelAssociation>
  >();

  // All associations for fast iteration
  private allAssociations = new Set<AgentChannelAssociation>();

  /**
   * Get all channels that an agent participates in
   */
  getAgentChannels(agentId: UUID): UUID[] {
    const agentAssociations = this.agentToChannelAssociations.get(agentId);
    if (!agentAssociations) return [];
    return Array.from(agentAssociations.keys());
  }

  /**
   * Get all agents that participate in a channel
   */
  getChannelAgents(channelId: UUID): UUID[] {
    const channelAssociations = this.channelToAgentAssociations.get(channelId);
    if (!channelAssociations) return [];
    return Array.from(channelAssociations.keys());
  }

  /**
   * Get specific association between agent and channel
   */
  getAssociation(
    agentId: UUID,
    channelId: UUID
  ): AgentChannelAssociation | undefined {
    const agentAssociations = this.agentToChannelAssociations.get(agentId);
    if (!agentAssociations) return undefined;
    return agentAssociations.get(channelId);
  }

  /**
   * Add a new association
   */
  addAssociation(association: AgentChannelAssociation): void {
    const { agentId, channelId } = association;

    // Add to agent -> channel mapping
    if (!this.agentToChannelAssociations.has(agentId)) {
      this.agentToChannelAssociations.set(agentId, new Map());
    }
    this.agentToChannelAssociations.get(agentId)!.set(channelId, association);

    // Add to channel -> agent mapping
    if (!this.channelToAgentAssociations.has(channelId)) {
      this.channelToAgentAssociations.set(channelId, new Map());
    }
    this.channelToAgentAssociations.get(channelId)!.set(agentId, association);

    // Add to all associations set
    this.allAssociations.add(association);
  }

  /**
   * Remove an association
   */
  removeAssociation(agentId: UUID, channelId: UUID): void {
    const association = this.getAssociation(agentId, channelId);
    if (!association) return;

    // Remove from agent -> channel mapping
    const agentAssociations = this.agentToChannelAssociations.get(agentId);
    if (agentAssociations) {
      agentAssociations.delete(channelId);
      if (agentAssociations.size === 0) {
        this.agentToChannelAssociations.delete(agentId);
      }
    }

    // Remove from channel -> agent mapping
    const channelAssociations = this.channelToAgentAssociations.get(channelId);
    if (channelAssociations) {
      channelAssociations.delete(agentId);
      if (channelAssociations.size === 0) {
        this.channelToAgentAssociations.delete(channelId);
      }
    }

    // Remove from all associations set
    this.allAssociations.delete(association);
  }

  /**
   * Get all associations for an agent
   */
  getAgentAssociations(agentId: UUID): AgentChannelAssociation[] {
    const agentAssociations = this.agentToChannelAssociations.get(agentId);
    if (!agentAssociations) return [];
    return Array.from(agentAssociations.values());
  }

  /**
   * Get all associations for a channel
   */
  getChannelAssociations(channelId: UUID): AgentChannelAssociation[] {
    const channelAssociations = this.channelToAgentAssociations.get(channelId);
    if (!channelAssociations) return [];
    return Array.from(channelAssociations.values());
  }

  /**
   * Update participant state for an agent in a channel
   */
  updateParticipantState(
    agentId: UUID,
    channelId: UUID,
    state: ChannelParticipant["state"]
  ): void {
    const association = this.getAssociation(agentId, channelId);
    if (!association) {
      throw new Error(
        `No association found for agent ${agentId} in channel ${channelId}`
      );
    }

    association.participant.state = state;
  }

  /**
   * Update participant mode for an agent in a channel
   */
  updateParticipantMode(
    agentId: UUID,
    channelId: UUID,
    mode: ChannelParticipant["mode"]
  ): void {
    const association = this.getAssociation(agentId, channelId);
    if (!association) {
      throw new Error(
        `No association found for agent ${agentId} in channel ${channelId}`
      );
    }

    association.participant.mode = mode;
  }

  /**
   * Get all associations (for debugging/testing)
   */
  getAllAssociations(): AgentChannelAssociation[] {
    return Array.from(this.allAssociations);
  }

  /**
   * Check if an agent is in a channel
   */
  hasAssociation(agentId: UUID, channelId: UUID): boolean {
    return this.getAssociation(agentId, channelId) !== undefined;
  }

  /**
   * Get participant config for an agent in a channel
   */
  getParticipant(
    agentId: UUID,
    channelId: UUID
  ): ChannelParticipant | undefined {
    const association = this.getAssociation(agentId, channelId);
    return association?.participant;
  }

  /**
   * Get all agents that can send messages in a channel
   */
  getSendingAgents(channelId: UUID): UUID[] {
    return this.getChannelAssociations(channelId)
      .filter(
        (assoc) =>
          assoc.participant.state === "FOLLOWED" &&
          assoc.participant.mode !== "observe_only"
      )
      .map((assoc) => assoc.agentId);
  }

  /**
   * Get all agents that can receive messages in a channel
   */
  getReceivingAgents(channelId: UUID): UUID[] {
    return this.getChannelAssociations(channelId)
      .filter((assoc) => assoc.participant.state === "FOLLOWED")
      .map((assoc) => assoc.agentId);
  }

  /**
   * Clear all associations
   */
  clear(): void {
    this.agentToChannelAssociations.clear();
    this.channelToAgentAssociations.clear();
    this.allAssociations.clear();
  }

  /**
   * Get statistics about associations
   */
  getStats(): {
    totalAssociations: number;
    totalAgents: number;
    totalChannels: number;
    averageAgentsPerChannel: number;
    averageChannelsPerAgent: number;
  } {
    const totalAssociations = this.allAssociations.size;
    const totalAgents = this.agentToChannelAssociations.size;
    const totalChannels = this.channelToAgentAssociations.size;

    return {
      totalAssociations,
      totalAgents,
      totalChannels,
      averageAgentsPerChannel:
        totalChannels > 0 ? totalAssociations / totalChannels : 0,
      averageChannelsPerAgent:
        totalAgents > 0 ? totalAssociations / totalAgents : 0,
    };
  }
}
