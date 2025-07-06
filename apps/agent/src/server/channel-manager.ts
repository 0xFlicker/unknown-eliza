import {
  UUID,
  ChannelType,
  createUniqueUuid,
  logger,
  type IAgentRuntime,
} from "@elizaos/core";
import { AgentServer, MessageChannel, MessageServer } from "@elizaos/server";
import {
  Channel,
  ChannelConfig,
  ChannelParticipant,
  ParticipantState,
  ParticipantMode,
  AgentChannelAssociation,
} from "./types";
import { AssociationManager } from "./association-manager";

/**
 * Production-ready channel manager for handling channel lifecycle and n² agent associations
 */
export class ChannelManager {
  private channels = new Map<UUID, Channel>();

  constructor(
    private server: AgentServer,
    private messageServer: MessageServer,
    private associationManager: AssociationManager,
    private agentManager: {
      getAgentRuntime: (agentId: UUID) => IAgentRuntime | undefined;
    }
  ) {}

  /**
   * Create a new channel with participants
   * This handles the n² complexity of setting up agent associations
   */
  async createChannel(config: ChannelConfig): Promise<UUID> {
    logger.info(
      `Creating channel: ${config.name} with ${config.participants.length} participants`
    );

    // Validate all participants exist
    for (const participant of config.participants) {
      const runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) {
        throw new Error(
          `Agent ${participant.agentId} not found for channel ${config.name}`
        );
      }
    }

    // Create channel via AgentServer
    const serverChannel = await this.server.createChannel({
      messageServerId: this.messageServer.id,
      name: config.name,
      type: config.type,
      metadata: config.metadata,
    });

    // Create channel record
    const channel: Channel = {
      id: serverChannel.id,
      name: config.name,
      type: config.type,
      participants: new Map(),
      createdAt: Date.now(),
      maxMessages: config.maxMessages,
      timeoutMs: config.timeoutMs,
      metadata: config.metadata,
    };

    // Set up n² associations for all participants
    await this.setupChannelAssociations(channel, config.participants);

    // Store channel
    this.channels.set(channel.id, channel);

    logger.info(
      `Successfully created channel ${config.name} with ID: ${channel.id}`
    );

    return channel.id;
  }

  /**
   * Set up the n² complexity of agent associations for a channel
   * This is the core of the system - each agent needs to know about all other agents
   */
  private async setupChannelAssociations(
    channel: Channel,
    participants: ChannelParticipant[]
  ): Promise<void> {
    const participantIds = participants.map((p) => p.agentId);

    logger.info(
      `Setting up n² associations for channel ${channel.name} with ${participantIds.length} participants`
    );

    // Step 1: Create entities for ALL participants on ALL runtimes
    await this.createCrossAgentEntities(channel, participantIds);

    // Step 2: Create rooms and associations for each participant
    await this.createParticipantRooms(channel, participants);

    logger.info(`Completed n² setup for channel ${channel.name}`);
  }

  /**
   * Create entities for all participants on all runtimes
   * This ensures each agent knows about all other agents in the channel
   */
  private async createCrossAgentEntities(
    channel: Channel,
    participantIds: UUID[]
  ): Promise<void> {
    logger.debug(
      `Creating cross-agent entities for ${participantIds.length} participants`
    );

    for (const sourceAgentId of participantIds) {
      const sourceRuntime = this.agentManager.getAgentRuntime(sourceAgentId);
      if (!sourceRuntime) continue;

      // Create this participant's entity on ALL OTHER runtimes
      for (const targetAgentId of participantIds) {
        if (sourceAgentId === targetAgentId) continue;

        const targetRuntime = this.agentManager.getAgentRuntime(targetAgentId);
        if (!targetRuntime) continue;

        const entityId = createUniqueUuid(targetRuntime, sourceAgentId);

        try {
          await targetRuntime.createEntity({
            id: entityId,
            names: [sourceRuntime.character.name],
            agentId: targetRuntime.agentId,
            metadata: {
              source: "production-channel-manager",
              originalAgentId: sourceAgentId,
              channelId: channel.id,
            },
          });

          logger.debug(
            `Created entity for ${sourceRuntime.character.name} on ${targetRuntime.character.name}'s runtime`
          );
        } catch (error) {
          logger.warn(
            `Failed to create entity for ${sourceRuntime.character.name} on ${targetRuntime.character.name}'s runtime:`,
            error
          );
        }
      }
    }
  }

  /**
   * Create rooms and associations for each participant
   * This sets up the channel structure for each agent
   */
  private async createParticipantRooms(
    channel: Channel,
    participants: ChannelParticipant[]
  ): Promise<void> {
    logger.debug(
      `Creating participant rooms for ${participants.length} participants`
    );

    for (const participant of participants) {
      const runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) continue;

      // Create room for this participant
      const roomId = createUniqueUuid(runtime, channel.id);
      const worldId = createUniqueUuid(runtime, this.messageServer.id);

      // Ensure world exists
      await runtime.ensureWorldExists({
        id: worldId,
        name: "Production World",
        agentId: runtime.agentId,
        serverId: this.messageServer.id,
      });

      // Ensure room exists
      await runtime.ensureRoomExists({
        id: roomId,
        type: channel.type,
        name: channel.name,
        agentId: runtime.agentId,
        worldId: worldId,
        channelId: channel.id,
        serverId: this.messageServer.id,
        source: "production-channel-manager",
      });

      // Add this agent as participant in their own room
      await runtime.addParticipant(runtime.agentId, roomId);

      // Add all other participants to this agent's room
      for (const otherParticipant of participants) {
        if (participant.agentId === otherParticipant.agentId) continue;

        const otherRuntime = this.agentManager.getAgentRuntime(
          otherParticipant.agentId
        );
        if (!otherRuntime) continue;

        // Use the same UUID generation as entity creation
        const participantEntityId = createUniqueUuid(
          runtime,
          otherRuntime.agentId
        );
        await runtime.ensureParticipantInRoom(participantEntityId, roomId);
      }

      // Set participant state (FOLLOWED/MUTED)
      await runtime.setParticipantUserState(
        roomId,
        runtime.agentId,
        participant.state
      );

      // Store participant in channel
      channel.participants.set(participant.agentId, participant);

      // Create association record
      const association: AgentChannelAssociation = {
        agentId: participant.agentId,
        channelId: channel.id,
        participant: participant,
        entityId: createUniqueUuid(runtime, participant.agentId),
        roomId: roomId,
      };

      // Add to association manager
      this.associationManager.addAssociation(association);

      logger.debug(
        `Created room and associations for ${runtime.character.name} in channel ${channel.name}`
      );
    }
  }

  /**
   * Get a channel by ID
   */
  getChannel(channelId: UUID): Channel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get all channels
   */
  getAllChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get all channel IDs
   */
  getAllChannelIds(): UUID[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Remove a channel and clean up all associations
   */
  async removeChannel(channelId: UUID): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    logger.info(`Removing channel ${channel.name} (${channelId})`);

    try {
      // Remove all associations for this channel
      const associations =
        this.associationManager.getChannelAssociations(channelId);
      for (const association of associations) {
        this.associationManager.removeAssociation(
          association.agentId,
          channelId
        );
      }

      // Remove channel from storage
      this.channels.delete(channelId);

      logger.info(`Successfully removed channel ${channel.name}`);
    } catch (error) {
      logger.error(`Failed to remove channel ${channel.name}:`, error);
      throw error;
    }
  }

  /**
   * Add a participant to an existing channel
   */
  async addParticipantToChannel(
    channelId: UUID,
    participant: ChannelParticipant
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const runtime = this.agentManager.getAgentRuntime(participant.agentId);
    if (!runtime) {
      throw new Error(`Agent ${participant.agentId} not found`);
    }

    logger.info(`Adding ${runtime.character.name} to channel ${channel.name}`);

    // Create entities for this agent on all existing participants
    const existingParticipantIds = Array.from(channel.participants.keys());
    await this.createCrossAgentEntities(channel, [
      participant.agentId,
      ...existingParticipantIds,
    ]);

    // Create room and associations for this participant
    await this.createParticipantRooms(channel, [participant]);

    // Add to existing participants' rooms
    for (const existingParticipantId of existingParticipantIds) {
      const existingRuntime = this.agentManager.getAgentRuntime(
        existingParticipantId
      );
      if (!existingRuntime) continue;

      const existingAssociation = this.associationManager.getAssociation(
        existingParticipantId,
        channelId
      );
      if (!existingAssociation) continue;

      // Add new participant to existing participant's room
      const participantEntityId = createUniqueUuid(
        existingRuntime,
        participant.agentId
      );
      await existingRuntime.ensureParticipantInRoom(
        participantEntityId,
        existingAssociation.roomId
      );
    }

    logger.info(
      `Successfully added ${runtime.character.name} to channel ${channel.name}`
    );
  }

  /**
   * Remove a participant from a channel
   */
  async removeParticipantFromChannel(
    channelId: UUID,
    agentId: UUID
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const participant = channel.participants.get(agentId);
    if (!participant) {
      throw new Error(
        `Agent ${agentId} is not a participant in channel ${channel.name}`
      );
    }

    logger.info(`Removing agent ${agentId} from channel ${channel.name}`);

    // Remove association
    this.associationManager.removeAssociation(agentId, channelId);

    // Remove from channel participants
    channel.participants.delete(agentId);

    // Remove from other participants' rooms
    const otherParticipantIds = Array.from(channel.participants.keys());
    for (const otherParticipantId of otherParticipantIds) {
      const otherRuntime =
        this.agentManager.getAgentRuntime(otherParticipantId);
      if (!otherRuntime) continue;

      const otherAssociation = this.associationManager.getAssociation(
        otherParticipantId,
        channelId
      );
      if (!otherAssociation) continue;

      // Remove this agent's entity from other participant's room
      const participantEntityId = createUniqueUuid(otherRuntime, agentId);
      // Note: This would require a removeParticipantFromRoom method that may not exist
      // For now, we'll just log this limitation
      logger.warn(
        `Cannot remove participant entity from room - this may need manual cleanup`
      );
    }

    logger.info(
      `Successfully removed agent ${agentId} from channel ${channel.name}`
    );
  }

  /**
   * Update participant state in a channel
   */
  async updateParticipantState(
    channelId: UUID,
    agentId: UUID,
    state: ParticipantState
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const participant = channel.participants.get(agentId);
    if (!participant) {
      throw new Error(
        `Agent ${agentId} is not a participant in channel ${channel.name}`
      );
    }

    const runtime = this.agentManager.getAgentRuntime(agentId);
    if (!runtime) {
      throw new Error(`Agent ${agentId} runtime not found`);
    }

    // Update association manager
    this.associationManager.updateParticipantState(agentId, channelId, state);

    // Update channel participant
    participant.state = state;

    // Update runtime participant state
    const association = this.associationManager.getAssociation(
      agentId,
      channelId
    );
    if (association) {
      await runtime.setParticipantUserState(association.roomId, agentId, state);
    }

    logger.info(
      `Updated participant state for agent ${agentId} in channel ${channel.name} to ${state}`
    );
  }

  /**
   * Check if a channel exists
   */
  hasChannel(channelId: UUID): boolean {
    return this.channels.has(channelId);
  }

  /**
   * Get channel count
   */
  getChannelCount(): number {
    return this.channels.size;
  }

  /**
   * Get channel statistics
   */
  getStats(): {
    totalChannels: number;
    channelsByType: Record<ChannelType, number>;
    averageParticipantsPerChannel: number;
  } {
    const channels = Array.from(this.channels.values());
    const channelsByType: Record<ChannelType, number> = {} as Record<
      ChannelType,
      number
    >;

    let totalParticipants = 0;

    for (const channel of channels) {
      channelsByType[channel.type] = (channelsByType[channel.type] || 0) + 1;
      totalParticipants += channel.participants.size;
    }

    return {
      totalChannels: channels.length,
      channelsByType,
      averageParticipantsPerChannel:
        channels.length > 0 ? totalParticipants / channels.length : 0,
    };
  }

  /**
   * Clean up all channels
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up ${this.channels.size} channels`);

    const cleanupPromises = Array.from(this.channels.keys()).map((channelId) =>
      this.removeChannel(channelId).catch((error) => {
        logger.error(`Failed to cleanup channel ${channelId}:`, error);
      })
    );

    await Promise.all(cleanupPromises);
    this.channels.clear();

    logger.info("Channel cleanup completed");
  }
}
