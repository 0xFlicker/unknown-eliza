import {
  UUID,
  ChannelType,
  logger,
  type IAgentRuntime,
  EventType,
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
import { AgentManager } from "./agent-manager";

/**
 * Channel manager that uses the proper AgentServer infrastructure
 * Leverages the API client and SocketIO events for compatibility with www client
 */
export class ChannelManager {
  private channels = new Map<UUID, Channel>();
  private agentManager: AgentManager<any>;
  private associationManager: AssociationManager;
  private server: AgentServer;
  private messageServer: MessageServer;

  constructor(
    agentManager: AgentManager<any>,
    associationManager: AssociationManager,
    server: AgentServer,
    messageServer: MessageServer
  ) {
    this.agentManager = agentManager;
    this.associationManager = associationManager;
    this.server = server;
    this.messageServer = messageServer;
  }

  /**
   * Create a new channel with participants using the central messaging API
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

    // Create channel through central messaging API
    const channel = await apiClient.createCentralGroupChat({
      name: config.name,
      participantCentralUserIds: config.participants.map((p) => p.agentId),
      type: config.type,
      server_id: this.messageServer.id,
      metadata: config.metadata,
    });

    // Create channel record
    const channelRecord: Channel = {
      id: channel.data.id,
      messageServerId: channel.data.messageServerId,
      name: config.name,
      type: config.type,
      participants: new Map(),
      createdAt: Date.now(),
      maxMessages: config.maxMessages || 100,
      timeoutMs: config.timeoutMs || 1000 * 60 * 60 * 24,
      metadata: config.metadata,
    };

    // Set up agent associations using proper AgentServer flow
    await this.setupChannelAssociations(channelRecord, config.participants);

    // Store channel
    this.channels.set(channelRecord.id, channelRecord);

    logger.info(
      `Successfully created channel ${config.name} with ID: ${channel.data.id}`
    );

    return channelRecord.id;
  }

  /**
   * Set up agent associations using proper AgentServer infrastructure
   * This triggers the ENTITY_JOINED events that the bootstrap plugin handles
   */
  private async setupChannelAssociations(
    channel: Channel,
    participants: ChannelParticipant[]
  ): Promise<void> {
    const participantIds = participants.map((p) => p.agentId);

    logger.info(
      `Setting up associations for channel ${channel.name} (${channel.id}) with ${participantIds.length} participants`
    );

    // Get the first available runtime to emit events
    const firstRuntime = this.agentManager.getAgentRuntime(
      participants[0].agentId
    );
    if (!firstRuntime) {
      throw new Error(`No runtime available for channel setup`);
    }

    // Set up each participant using proper AgentServer flow
    for (const participant of participants) {
      const runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) continue;

      logger.info(
        `Setting up agent ${runtime.character.name} (${participant.agentId}) for channel ${channel.name}`
      );

      // Ensure the agent is added to the server that this channel belongs to
      // Subscribe agent to messaging server via central API (server_agent_update bus event will follow)
      await apiClient.addAgentToServer(channel.messageServerId, participant.agentId);
      logger.info(
        `Subscribed agent ${runtime.character.name} to messaging server ${channel.messageServerId}`
      );

      // Emit ENTITY_JOINED event for this participant
      // This will trigger the bootstrap plugin to create proper world/room/entity structure
      logger.info(
        `Emitting ENTITY_JOINED for agent ${runtime.character.name} in channel ${channel.name}`
      );

      await runtime.emitEvent([EventType.ENTITY_JOINED], {
        runtime,
        entityId: participant.agentId,
        worldId: channel.messageServerId, // Use server ID as world ID
        roomId: channel.id, // Use channel ID as room ID
        source: "channel-manager",
        metadata: {
          type: channel.type,
          isDm: channel.type === ChannelType.DM,
          originalId: participant.agentId,
          username: runtime.character.name,
          displayName: runtime.character.name,
          roles: [],
          joinedAt: Date.now(),
        },
      });
      logger.info(
        `Successfully emitted ENTITY_JOINED for agent ${runtime.character.name}`
      );

      // Store participant in channel
      channel.participants.set(participant.agentId, participant);

      // Create association record
      const association: AgentChannelAssociation = {
        agentId: participant.agentId,
        channelId: channel.id,
        participant: participant,
        entityId: participant.agentId,
      };

      // Add to association manager
      this.associationManager.addAssociation(association);

      logger.info(
        `Created associations for ${runtime.character.name} in channel ${channel.name}`
      );
    }

    logger.info(
      `Completed setup for channel ${channel.name}`
    );
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

    // Add participant to central channel through API
    await apiClient.addUserToChannel(channelId, participant.agentId);

    // Emit ENTITY_JOINED event for proper AgentServer setup
    await runtime.emitEvent([EventType.ENTITY_JOINED], {
      runtime,
      entityId: participant.agentId,
      worldId: this.messageServer.id,
      roomId: channelId,
      source: "channel-manager-add-participant",
      metadata: {
        type: channel.type,
        isDm: channel.type === ChannelType.DM,
        originalId: participant.agentId,
        username: runtime.character.name,
        displayName: runtime.character.name,
        roles: [],
        joinedAt: Date.now(),
      },
    });

    // Store participant in channel
    channel.participants.set(participant.agentId, participant);

    // Create association record
    const association: AgentChannelAssociation = {
      agentId: participant.agentId,
      channelId: channel.id,
      participant: participant,
      entityId: participant.agentId,
    };

    // Add to association manager
    this.associationManager.addAssociation(association);

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

    // Remove participant from central channel through API
    await apiClient.removeUserFromChannel(channelId, agentId);

    // Remove association
    this.associationManager.removeAssociation(agentId, channelId);

    // Remove from channel participants
    channel.participants.delete(agentId);

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
   * Get messages for a channel using the central messaging API
   */
  async getMessages(channelId: UUID): Promise<ChannelMessage[]> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Get messages from the central messaging API
    const response = await apiClient.getChannelMessages(channelId);

    // Convert ServerMessage to ChannelMessage
    return response.data.messages.map((message) => ({
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      content: message.content,
      timestamp: message.createdAt,
      metadata: message.metadata,
    }));
  }
}
