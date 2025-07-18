import { GameContext, Phase, Player } from "./types";

export function createInitialContext(playerIds: string[]): GameContext {
  const players: Record<string, Player> = {};
  for (const id of playerIds) {
    players[id] = { id, name: id, status: "alive" };
  }
  return {
    phase: Phase.INIT,
    players,
    ready: {},
  };
}

export function generateDiaryRooms(
  playerIds: string[],
): Record<string, string> {
  const rooms: Record<string, string> = {};
  for (const id of playerIds) {
    rooms[id] = `diary-${id}`; // simplistic deterministic id for tests
  }
  return rooms;
}
