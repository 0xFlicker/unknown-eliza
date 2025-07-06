import { InfluenceApp } from "./app";
import {
  AgentConfig,
  ChannelConfig,
  ParticipantState,
  ParticipantMode,
} from "./types";
import { Character, ChannelType } from "@elizaos/core";

/**
 * Example usage of the production-ready agent and channel management system
 * This demonstrates how to properly handle the n² complexity of agent-channel associations
 */
export async function exampleUsage() {
  // Create the app with configuration
  const app = new InfluenceApp({
    dataDir: "./data",
    serverPort: 3100,
    context: {
      environment: "production",
      version: "1.0.0",
    },
  });

  // Initialize the app
  await app.initialize();

  // Define agent characters
  const houseCharacter: Character = {
    name: "House",
    bio: "The game host and moderator",
    system: "You are the host of a social strategy game.",
    messageExamples: [],
    topics: ["game hosting", "moderation"],
    adjectives: ["fair", "authoritative"],
    style: { all: [], chat: [], post: [] },
    settings: {},
    secrets: {},
    plugins: [],
  };

  const alphaCharacter: Character = {
    name: "Alpha",
    bio: "A strategic player",
    system: "You are a strategic player in a social game.",
    messageExamples: [],
    topics: ["strategy", "alliances"],
    adjectives: ["strategic", "competitive"],
    style: { all: [], chat: [], post: [] },
    settings: {},
    secrets: {},
    plugins: [],
  };

  const betaCharacter: Character = {
    name: "Beta",
    bio: "A cooperative player",
    system: "You are a cooperative player in a social game.",
    messageExamples: [],
    topics: ["cooperation", "teamwork"],
    adjectives: ["cooperative", "friendly"],
    style: { all: [], chat: [], post: [] },
    settings: {},
    secrets: {},
    plugins: [],
  };

  // Add agents to the system
  console.log("Adding agents...");

  const houseAgent = await app.addAgent({
    character: houseCharacter,
    plugins: [],
    metadata: { role: "host" },
  });

  const alphaAgent = await app.addAgent({
    character: alphaCharacter,
    plugins: [],
    metadata: { role: "player" },
  });

  const betaAgent = await app.addAgent({
    character: betaCharacter,
    plugins: [],
    metadata: { role: "player" },
  });

  console.log(
    `Added agents: ${houseAgent.character.name}, ${alphaAgent.character.name}, ${betaAgent.character.name}`
  );

  // Create a channel with all participants
  console.log("Creating channel...");

  const channelConfig: ChannelConfig = {
    name: "Game Channel",
    type: ChannelType.GROUP,
    participants: [
      {
        agentId: houseAgent.id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      },
      {
        agentId: alphaAgent.id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      },
      {
        agentId: betaAgent.id,
        mode: ParticipantMode.READ_WRITE,
        state: ParticipantState.FOLLOWED,
      },
    ],
    metadata: { gameType: "social-strategy" },
  };

  const channelId = await app.createChannel(channelConfig);
  console.log(`Created channel: ${channelId}`);

  // Demonstrate participant state management
  console.log("Demonstrating participant state management...");

  // Mute Alpha (they can receive but not send)
  await app
    .getChannelManager()
    .updateParticipantState(channelId, alphaAgent.id, ParticipantState.MUTED);
  console.log(`Muted ${alphaAgent.character.name}`);

  // Note: updateParticipantMode is not implemented yet
  // For now, we can only change participant state (FOLLOWED/MUTED)
  console.log(`Note: ${betaAgent.character.name} remains in READ_WRITE mode`);

  // Get statistics
  const stats = app.getStats();
  console.log("System Statistics:", {
    agents: stats.agents.totalAgents,
    channels: stats.channels.totalChannels,
    associations: stats.associations.totalAssociations,
    averageAgentsPerChannel: stats.associations.averageAgentsPerChannel,
  });

  // Demonstrate association queries
  console.log("Demonstrating association queries...");

  const houseChannels = app
    .getAssociationManager()
    .getAgentChannels(houseAgent.id);
  console.log(
    `${houseAgent.character.name} is in ${houseChannels.length} channels`
  );

  const channelAgents = app.getAssociationManager().getChannelAgents(channelId);
  console.log(`Channel has ${channelAgents.length} agents`);

  const sendingAgents = app.getAssociationManager().getSendingAgents(channelId);
  console.log(`Agents that can send messages: ${sendingAgents.length}`);

  const receivingAgents = app
    .getAssociationManager()
    .getReceivingAgents(channelId);
  console.log(`Agents that can receive messages: ${receivingAgents.length}`);

  // Start the server
  await app.start();
  console.log("Server started on port 3100");

  // Return the app for further use
  return app;
}

/**
 * Example of adding a new participant to an existing channel
 */
export async function addParticipantExample(app: InfluenceApp<any, any>) {
  const gammaCharacter: Character = {
    name: "Gamma",
    bio: "A new player joining the game",
    system: "You are a new player joining an ongoing social game.",
    messageExamples: [],
    topics: ["adaptation", "learning"],
    adjectives: ["adaptive", "curious"],
    style: { all: [], chat: [], post: [] },
    settings: {},
    secrets: {},
    plugins: [],
  };

  // Add new agent
  const gammaAgent = await app.addAgent({
    character: gammaCharacter,
    plugins: [],
    metadata: { role: "player" },
  });

  // Get existing channel
  const channels = app.getChannelManager().getAllChannels();
  if (channels.length === 0) {
    throw new Error("No channels available");
  }

  const channelId = channels[0].id;

  // Add to existing channel
  await app.getChannelManager().addParticipantToChannel(channelId, {
    agentId: gammaAgent.id,
    mode: ParticipantMode.READ_WRITE,
    state: ParticipantState.FOLLOWED,
  });

  console.log(`Added ${gammaAgent.character.name} to existing channel`);

  // Show updated statistics
  const stats = app.getStats();
  console.log("Updated Statistics:", {
    agents: stats.agents.totalAgents,
    associations: stats.associations.totalAssociations,
  });
}

/**
 * Cleanup function
 */
export async function cleanup(app: InfluenceApp<any, any>) {
  console.log("Cleaning up...");
  await app.stop();
  console.log("Cleanup completed");
}
