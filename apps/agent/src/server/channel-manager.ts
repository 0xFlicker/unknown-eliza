import {
  UUID,
  ChannelType,
  createUniqueUuid,
  logger,
  type IAgentRuntime,
  stringToUuid,
} from "@elizaos/core";
import { AgentServer, MessageChannel, MessageServer } from "@elizaos/server";
import {
  Channel,
  ChannelConfig,
  ChannelParticipant,
  ParticipantState,
  ParticipantMode,
  AgentChannelAssociation,
  ChannelMessage,
} from "./types";
import { AssociationManager } from "./association-manager";
import { apiClient } from "../lib/api";

/**
 * Simplified channel manager for handling channel lifecycle and agent associations
 * Each channel has a single room where roomId equals channelId
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
   * Simplified to use a single room per channel
   */
  async createChannel(config: ChannelConfig): Promise<UUID> {
    logger.info(
      `Creating channel: ${config.name} with ${config.participants.length} participants`
    );

    const channel = await apiClient.createCentralGroupChat({
      name: config.name,
      participantCentralUserIds: config.participants.map((p) => p.agentId),
      type: config.type,
      server_id: this.messageServer.id,
      metadata: config.metadata,
    });

    // Validate all participants exist
    for (const participant of config.participants) {
      const runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) {
        throw new Error(
          `Agent ${participant.agentId} not found for channel ${config.name}`
        );
      }
    }

    // Create channel record
    const channelRecord: Channel = {
      id: channel.data.id,
      name: config.name,
      type: config.type,
      participants: new Map(),
      createdAt: Date.now(),
      maxMessages: config.maxMessages || 100,
      timeoutMs: config.timeoutMs || 1000 * 60 * 60 * 24,
      metadata: config.metadata,
    };

    // Set up simplified associations for all participants
    await this.setupChannelAssociations(channelRecord, config.participants);

    // Store channel
    this.channels.set(channelRecord.id, channelRecord);

    logger.info(
      `Successfully created channel ${config.name} with ID: ${channel.data.id}`
    );

    return channelRecord.id;
  }

  /**
   * Set up simplified agent associations for a channel
   * Each channel has a single room where roomId equals channelId
   */
  private async setupChannelAssociations(
    channel: Channel,
    participants: ChannelParticipant[]
  ): Promise<void> {
    const participantIds = participants.map((p) => p.agentId);

    logger.info(
      `Setting up associations for channel ${channel.name} with ${participantIds.length} participants`
    );

    // Create a single room for the channel (roomId = channelId)
    const roomId = channel.id;
    const worldId = stringToUuid(this.messageServer.id, this.messageServer.id);

    // Set up each participant in the single room
    for (const participant of participants) {
      const runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) continue;

      // Ensure world exists
      await runtime.ensureWorldExists({
        id: worldId,
        name: "Production World",
        agentId: runtime.agentId,
        serverId: this.messageServer.id,
      });

      // Ensure room exists (single room per channel)
      await runtime.ensureRoomExists({
        id: roomId,
        type: channel.type,
        name: channel.name,
        agentId: runtime.agentId,
        worldId: worldId,
        channelId: channel.id,
        serverId: this.messageServer.id,
        source: "simplified-channel-manager",
      });

      // Add this agent as participant in the room
      await runtime.addParticipant(runtime.agentId, roomId);

      // Create entities for all other participants in this agent's runtime
      for (const otherParticipant of participants) {
        if (participant.agentId === otherParticipant.agentId) continue;

        const otherRuntime = this.agentManager.getAgentRuntime(
          otherParticipant.agentId
        );
        if (!otherRuntime) continue;

        const entityId = createUniqueUuid(runtime, otherRuntime.agentId);

        try {
          await runtime.createEntity({
            id: entityId,
            names: [otherRuntime.character.name],
            agentId: runtime.agentId,
            metadata: {
              source: "simplified-channel-manager",
              originalAgentId: otherRuntime.agentId,
              channelId: channel.id,
            },
          });

          // Add other participant to this agent's room
          await runtime.ensureParticipantInRoom(entityId, roomId);

          logger.debug(
            `Created entity for ${otherRuntime.character.name} on ${runtime.character.name}'s runtime`
          );
        } catch (error) {
          logger.warn(
            `Failed to create entity for ${otherRuntime.character.name} on ${runtime.character.name}'s runtime:`,
            error
          );
        }
      }

      // Set participant state (FOLLOWED/MUTED)
      await runtime.setParticipantUserState(
        roomId,
        runtime.agentId,
        participant.state
      );

      // Store participant in channel
      channel.participants.set(participant.agentId, participant);

      // Create simplified association record (no roomId needed)
      const association: AgentChannelAssociation = {
        agentId: participant.agentId,
        channelId: channel.id,
        participant: participant,
        entityId: createUniqueUuid(runtime, participant.agentId),
      };

      // Add to association manager
      this.associationManager.addAssociation(association);

      logger.debug(
        `Created associations for ${runtime.character.name} in channel ${channel.name}`
      );
    }

    logger.info(`Completed setup for channel ${channel.name}`);
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

    // Create associations for this participant
    await this.setupChannelAssociations(channel, [participant]);

    // Add this participant to existing participants' rooms
    const existingParticipantIds = Array.from(channel.participants.keys());
    for (const existingParticipantId of existingParticipantIds) {
      if (existingParticipantId === participant.agentId) continue;

      const existingRuntime = this.agentManager.getAgentRuntime(
        existingParticipantId
      );
      if (!existingRuntime) continue;

      // Add new participant to existing participant's room (same roomId = channelId)
      const participantEntityId = createUniqueUuid(
        existingRuntime,
        participant.agentId
      );
      await existingRuntime.ensureParticipantInRoom(
        participantEntityId,
        channelId
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

    // Remove from other participants' rooms (same roomId = channelId)
    const otherParticipantIds = Array.from(channel.participants.keys());
    for (const otherParticipantId of otherParticipantIds) {
      const otherRuntime =
        this.agentManager.getAgentRuntime(otherParticipantId);
      if (!otherRuntime) continue;

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

    // Update runtime participant state (roomId = channelId)
    await runtime.setParticipantUserState(channelId, agentId, state);

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

  /**
   * Get messages for a channel
   */
  async getMessages(channelId: UUID): Promise<ChannelMessage[]> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Get messages from the server
    const messages = await this.server.getMessagesForChannel(channelId);

    // Convert CentralRootMessage to ChannelMessage
    return messages.map((message) => ({
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      content: message.content,
      timestamp: message.createdAt.getTime(),
      metadata: message.metadata,
    }));
  }
}
