import { describe, it, expect } from "bun:test";
import { InfluenceApp } from "../../server/influence-app";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import { coordinatorPlugin } from "../../plugins/coordinator";
import { influencerPlugin } from "../../plugins/influencer";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState, StreamedMessage } from "@/server";
import alexCharacter from "@/characters/alex";
import { Phase } from "@/game/types";

describe("LOBBY-only flow with preloaded context", () => {
  it(
    "starts in LOBBY, observes chat, then prompts and collects LOBBY diary",
    async () => {
      const app = new InfluenceApp({
        context: { suiteName: "E2E", testName: "LobbyOnly" },
        dataDir: `.elizaos/lobby-only-${Date.now()}`,
        serverPort: 4593,
      });

      await app.initialize();
      await app.start();

      try {
        // Add 3 influencer agents
        const players: Awaited<ReturnType<typeof app.addAgent>>[] = [];
        const playerNames = ["Alpha", "Beta", "Gamma"];
        for (const name of playerNames) {
          const player = await app.addAgent({
            character: {
              ...alexCharacter,
              name,
              system: alexCharacter.system?.replaceAll("Alex", name),
              bio: Array.isArray(alexCharacter.bio)
                ? alexCharacter.bio.map((b) => b.replaceAll("Alex", name))
                : alexCharacter.bio.replaceAll("Alex", name),
            },
            plugins: [
              coordinatorPlugin,
              influencerPlugin,
              sqlPlugin,
              openaiPlugin,
            ],
            metadata: { entityName: name, role: "player" },
          });
          players.push(player);
        }

        // Create a game starting in LOBBY
        const gameId = await app.createGame({
          players: players.map((p) => p.id),
          settings: { minPlayers: 3, maxPlayers: 5 },
          initialPhase: Phase.LOBBY,
        });

        const channelId = await app.createGameChannel(gameId, {
          name: "lobby-only",
          participants: [
            ...players.map((p) => ({
              agentId: p.id,
              mode: ParticipantMode.READ_WRITE,
              state: ParticipantState.FOLLOWED,
            })),
          ],
          type: ChannelType.GROUP,
        });

        const nameById = new Map(
          players.map((p) => [p.id, p.character.name] as const),
        );

        const lobbyMessages: StreamedMessage[] = [];
        const diaryLobby = new Map<string, StreamedMessage>();
        const diaryLobbyResponded = new Set<string>();
        let lobbyStart = 0;
        let lobbyDiariesStart = 0;

        const sub = app.getChannelMessageStream(channelId).subscribe((msg) => {
          const isPlayer = players.some((p) => p.id === msg.authorId);
          if (!isPlayer) return;
          if (!lobbyDiariesStart) {
            if (msg.timestamp >= lobbyStart) {
              lobbyMessages.push(msg);
            }
          } else {
            if (msg.timestamp >= lobbyDiariesStart) {
              if (!diaryLobby.has(msg.authorId)) {
                diaryLobby.set(msg.authorId, msg);
              }
              diaryLobbyResponded.add(msg.authorId);
            }
          }
        });

        // Announce LOBBY and seed brief intro recap to simulate preloaded context
        lobbyStart = Date.now();
        await app.sendMessage(
          channelId,
          "🎮 LOBBY PHASE CONTINUES! Recap: Keep in mind your introductions from earlier. You may now freely converse.",
        );

        // Wait for lobby messages
        const waitForLobbyMessages = async () => {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            const authors = new Set(lobbyMessages.map((m) => m.authorId));
            if (authors.size >= players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for lobby messages");
        };
        await waitForLobbyMessages();

        // Prompt lobby diaries referencing lobby history
        lobbyDiariesStart = Date.now();
        for (const p of players) {
          const recentByOther = lobbyMessages
            .filter((m) => m.authorId !== p.id)
            .slice(-6)
            .map(
              (m) =>
                `- ${nameById.get(m.authorId)!}: ${String(m.content).slice(0, 280)}`,
            )
            .join("\n");
          const prompt = [
            `@${p.character.name} Diary Question for ${p.character.name}:`,
            `Reflect on the LOBBY conversations so far. Who seems aligned or deceptive?`,
            `Recent messages:`,
            recentByOther || "(no recent messages)",
          ].join("\n");
          await app.sendMessage(channelId, prompt);
        }

        const waitForLobbyDiaries = async () => {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            if (diaryLobbyResponded.size === players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for lobby diary responses");
        };
        await waitForLobbyDiaries();

        sub.unsubscribe();
        expect(lobbyMessages.length).toBeGreaterThanOrEqual(players.length);
        expect(diaryLobbyResponded.size).toBe(players.length);
      } finally {
        await app.stop();
      }
    },
    { timeout: 90000 },
  );
});
