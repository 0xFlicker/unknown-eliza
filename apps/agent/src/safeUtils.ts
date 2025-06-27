import { type UUID, type IAgentRuntime } from "@elizaos/core";

export async function getParticipantsForRoom(
  runtime: IAgentRuntime,
  roomId: UUID,
) {
  try {
    return await runtime.getParticipantsForRoom(roomId);
  } catch {
    return [];
  }
}

export async function safeAddParticipant({
  runtime,
  entityId,
  roomId,
  worldId,
}: {
  runtime: IAgentRuntime;
  entityId: UUID;
  roomId: UUID;
  worldId: UUID;
}) {
  try {
    await runtime.ensureConnection({
      entityId,
      roomId,
      type: "conversation",
      worldId,
    });
  } catch {
    // Most likely a duplicate-room warning; just add the participant.
    // await runtime.addParticipant(entityId, roomId);
  }
}
