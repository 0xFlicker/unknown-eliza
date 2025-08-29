import {
  UUID,
  ChannelType,
  logger,
  type IAgentRuntime,
  EventType,
  EntityPayload,
  createUniqueUuid,
  stringToUuid,
  World,
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
  RuntimeDecorator,
} from "./types";
import { AssociationManager } from "./association-manager";
import { apiClient } from "../lib/api";
import { AgentManager } from "./agent-manager";
import { getCapacityTracker } from "@elizaos/server";
import SocketIOManager from "../lib/socketio-manager";

/**
 * Channel manager that uses the proper AgentServer infrastructure
 * Leverages the API client and SocketIO events for compatibility with www client
 */
export class ChannelManager<
  Context extends Record<string, unknown>,
  Runtime extends IAgentRuntime,
> {
  private world?: World;
  private channels = new Map<UUID, Channel>();
  private agentManager: AgentManager<Context, Runtime>;
  private associationManager: AssociationManager;
  private server: AgentServer;
  private messageServer: MessageServer;
  private houseAgent: IAgentRuntime;

  constructor(
    agentManager: AgentManager<Context, Runtime>,
    associationManager: AssociationManager,
    server: AgentServer,
    messageServer: MessageServer,
    houseAgent: IAgentRuntime,
  ) {
    this.agentManager = agentManager;
    this.associationManager = associationManager;
    this.server = server;
    this.messageServer = messageServer;
    this.houseAgent = houseAgent;
  }

  /**
   * Create a new channel with participants using the central messaging API
   */
  async createChannel(config: ChannelConfig): Promise<UUID> {
    logger.info(
      `Creating channel: ${config.name} with ${config.participants.length} participants`,
    );

    // Validate all participants exist
    for (const participant of config.participants) {
      const runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) {
        throw new Error(
          `Agent ${participant.agentId} not found for channel ${config.name}`,
        );
      }
    }

    // Create channel through central messaging API
    const channel = await apiClient.createCentralGroupChat({
      name: config.name,
      participantCentralUserIds: [
        this.houseAgent.agentId,
        ...config.participants.map((p) => p.agentId),
      ],
      type: config.type,
      server_id: this.messageServer.id,
      metadata: config.metadata,
    });

    if (!channel?.data?.id) {
      throw new Error(
        `Failed to create channel "${config.name}": API returned null/invalid response`,
      );
    }

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
    await this.setupChannelAssociations({
      channel: channelRecord,
      participants: config.participants,
      runtimeDecorators: config.runtimeDecorators,
      houseClientId: this.houseAgent.agentId,
    });

    // Store channel
    this.channels.set(channelRecord.id, channelRecord);

    // Configure per-participant capacity limits if provided (no global limit)
    try {
      if (config.maxRepliesPerParticipant) {
        const tracker = getCapacityTracker?.();
        tracker?.setChannelConfig(channelRecord.id as any, {
          maxRepliesPerParticipant: config.maxRepliesPerParticipant,
        });
        logger.info(
          `Configured capacity for channel ${channelRecord.id}: maxRepliesPerParticipant=${config.maxRepliesPerParticipant}`,
        );
      }
    } catch (err) {
      logger.warn(
        `Failed to configure capacity for channel ${channelRecord.id}:`,
        err,
      );
    }

    logger.info(
      `Successfully created channel ${config.name} with ID: ${channel.data.id}`,
    );

    return channelRecord.id;
  }

  /**
   * Ensure a DM channel exists between House and a specific player. Returns channel ID.
   */
  async ensureDmChannel(playerAgentId: UUID): Promise<UUID> {
    // Create or fetch DM channel via central server
    const dm = await this.server.findOrCreateCentralDmChannel(
      this.houseAgent.agentId,
      playerAgentId,
      this.messageServer.id,
    );

    const channelRecord: Channel = {
      id: dm.id,
      messageServerId: dm.messageServerId,
      name: `DM:${playerAgentId}`,
      type: ChannelType.DM,
      participants: new Map(),
      createdAt: Date.now(),
      metadata: {},
    } as any;

    // Set up associations for House and the player
    await this.setupChannelAssociations({
      channel: channelRecord,
      participants: [
        {
          agentId: this.houseAgent.agentId,
          mode: ParticipantMode.BROADCAST_ONLY,
          state: ParticipantState.FOLLOWED,
        },
        {
          agentId: playerAgentId,
          mode: ParticipantMode.READ_WRITE,
          state: ParticipantState.FOLLOWED,
        },
      ],
      runtimeDecorators: [],
      houseClientId: this.houseAgent.agentId,
    });

    this.channels.set(channelRecord.id, channelRecord);
    // Ensure House joins DM channel for real-time messaging
    try {
      const socket = SocketIOManager.getInstance();
      if (!SocketIOManager.isConnected()) {
        socket.initialize(
          this.houseAgent.agentId,
          Number(process.env.SERVER_PORT),
        );
      }
      await socket.joinChannel(channelRecord.id);
    } catch {}
    return channelRecord.id;
  }

  /**
   * Send a House-authored message into a channel via SocketIO.
   */
  async sendHouseMessage(channelId: UUID, content: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }
    const socket = SocketIOManager.getInstance();
    if (!SocketIOManager.isConnected()) {
      socket.initialize(
        this.houseAgent.agentId,
        Number(process.env.SERVER_PORT),
      );
    }
    if (!socket.isChannelActive(channelId)) {
      await socket.joinChannel(channelId);
    }
    await socket.sendMessage(
      content,
      channelId,
      channel.messageServerId,
      channel.type === ChannelType.DM ? "client_chat" : "client_group_chat",
      [],
      undefined,
      {
        channelType: channel.type,
        isDm: channel.type === ChannelType.DM,
        user_display_name: "The House",
        username: "The House",
      },
    );
  }

  /**
   * Set up agent associations using proper AgentServer infrastructure
   * This triggers the ENTITY_JOINED events that the bootstrap plugin handles
   */
  private async setupChannelAssociations({
    channel,
    participants,
    runtimeDecorators,
    houseClientId,
  }: {
    channel: Channel;
    participants: ChannelParticipant[];
    runtimeDecorators?: RuntimeDecorator<IAgentRuntime, { channelId: UUID }>[];
    houseClientId?: UUID;
  }): Promise<void> {
    const participantIds = participants.map((p) => p.agentId);

    logger.info(
      `Setting up associations for channel ${channel.name} (${channel.id}) with ${participantIds.length} participants`,
    );

    // Add the house agent to the participants
    await apiClient.addAgentToChannel(channel.id, this.houseAgent.agentId);
    // Let the other agents know about the house agent by creating the memory
    for (const otherParticipant of participants) {
      const runtime = this.houseAgent;
      if (otherParticipant.agentId === runtime.agentId) continue;
      const otherRuntime = this.agentManager.getAgentRuntime(
        otherParticipant.agentId,
      );
      if (!otherRuntime) continue;

      const entityId = createUniqueUuid(runtime, otherParticipant.agentId);
      const worldId = createUniqueUuid(runtime, channel.messageServerId);

      runtime.ensureRoomExists({
        id: channel.id,
        name: channel.name,
        source: "channel-manager",
        agentId: runtime.agentId,
        type: ChannelType.GROUP,
        worldId,
      });

      await runtime.emitEvent(EventType.ENTITY_JOINED, {
        runtime,
        entityId,
        worldId,
        roomId: channel.id,
        source: "channel-manager",
        metadata: {
          originalId: otherParticipant.agentId,
          type: channel.type,
          isDm: channel.type === ChannelType.DM,
          username: otherRuntime.character.name,
          displayName: otherRuntime.character.name,
          roles: [],
          joinedAt: Date.now(),
        } as any,
      } as EntityPayload);
    }

    // Set up each participant using proper AgentServer flow
    for (const participant of participants) {
      let runtime = this.agentManager.getAgentRuntime(participant.agentId);
      if (!runtime) continue;

      logger.info(
        `Setting up agent ${runtime.character.name} (${participant.agentId}) for channel ${channel.name}`,
      );

      // Ensure the agent is added to the server that this channel belongs to
      // Subscribe agent to messaging server via central API (server_agent_update bus event will follow)
      await apiClient.addAgentToServer(
        channel.messageServerId,
        participant.agentId,
      );
      logger.info(
        `Subscribed agent ${runtime.character.name} to messaging server ${channel.messageServerId}`,
      );

      if (runtimeDecorators) {
        for (const decorator of runtimeDecorators) {
          runtime = await decorator(runtime, { channelId: channel.id });
        }
      }

      for (const otherParticipant of [
        ...participants,
        {
          agentId: this.houseAgent.agentId,
          mode: ParticipantMode.BROADCAST_ONLY,
          state: ParticipantState.FOLLOWED,
        },
      ]) {
        if (otherParticipant.agentId === participant.agentId) continue;
        const otherRuntime = this.agentManager.getAgentRuntime(
          otherParticipant.agentId,
        );
        if (!otherRuntime) continue;

        const entityId = createUniqueUuid(runtime, otherParticipant.agentId);
        const worldId = createUniqueUuid(runtime, channel.messageServerId);

        runtime.ensureRoomExists({
          id: channel.id,
          name: channel.name,
          source: "channel-manager",
          agentId: runtime.agentId,
          type: ChannelType.GROUP,
          worldId,
        });

        await runtime.emitEvent(EventType.ENTITY_JOINED, {
          runtime,
          entityId,
          worldId,
          roomId: channel.id,
          source: "channel-manager",
          metadata: {
            originalId: otherParticipant.agentId,
            type: channel.type,
            isDm: channel.type === ChannelType.DM,
            username: otherRuntime.character.name,
            displayName: otherRuntime.character.name,
            roles: [],
            joinedAt: Date.now(),
          } as any,
        } as EntityPayload);
      }

      // Emit ENTITY_JOINED for the House
      await runtime.emitEvent(EventType.ENTITY_JOINED, {
        runtime,
        entityId: houseClientId,
        worldId: channel.messageServerId,
        roomId: channel.id,
        source: "channel-manager",
        metadata: {
          originalId: houseClientId,
          type: channel.type,
          isDm: channel.type === ChannelType.DM,
          username: "The House",
          displayName: "The House",
        } as any,
      } as EntityPayload);

      logger.info(
        `Successfully emitted ENTITY_JOINED for agent ${runtime.character.name}`,
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
        `Created associations for ${runtime.character.name} in channel ${channel.name}`,
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
          channelId,
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
   * Remove a participant from a channel
   */
  async removeParticipantFromChannel(
    channelId: UUID,
    agentId: UUID,
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const participant = channel.participants.get(agentId);
    if (!participant) {
      throw new Error(
        `Agent ${agentId} is not a participant in channel ${channel.name}`,
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
      `Successfully removed agent ${agentId} from channel ${channel.name}`,
    );
  }

  /**
   * Update participant state in a channel
   */
  async updateParticipantState(
    channelId: UUID,
    agentId: UUID,
    state: ParticipantState,
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const participant = channel.participants.get(agentId);
    if (!participant) {
      throw new Error(
        `Agent ${agentId} is not a participant in channel ${channel.name}`,
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
      `Updated participant state for agent ${agentId} in channel ${channel.name} to ${state}`,
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
      }),
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
    return response.data.messages.map((message) => {
      const replyId = (message as any).in_reply_to_message_id;
      const meta = { ...message.metadata } as Record<string, unknown>;
      if (replyId) {
        meta.in_reply_to_message_id = replyId;
      }
      return {
        id: message.id,
        channelId: message.channelId,
        authorId: message.authorId,
        content: message.content,
        timestamp: message.createdAt,
        metadata: meta,
      };
    });
  }
}
