import { describe, it, expect } from "bun:test";
import { InfluenceApp } from "../../server/influence-app";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import { coordinatorPlugin } from "../../plugins/coordinator";
import { influencerPlugin } from "../../plugins/influencer";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState, StreamedMessage } from "@/server";
import alexCharacter from "@/characters/alex";

describe("Introduction → LOBBY → Diary Room flow", () => {
  it(
    "runs intros, intro diary, lobby chat, then lobby diary",
    async () => {
      const app = new InfluenceApp({
        context: { suiteName: "E2E", testName: "Intro→Lobby→Diary" },
        dataDir: `.elizaos/intro-lobby-diary-${Date.now()}`,
        serverPort: 4592,
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
            metadata: { name },
          });
          players.push(player);
        }

        // Create a game in INTRODUCTION phase
        const gameId = await app.createGame({
          players: players.map((p) => p.id),
          settings: { minPlayers: 3, maxPlayers: 5 },
          initialPhase: 0 as any, // Phase.INTRODUCTION
        } as any);

        const nameById = new Map(
          players.map((p) => [p.id, p.character.name] as const),
        );

        // ------ INTRODUCTION PHASE (separate group room) ------
        const introChannelId = await app.createGameChannel(gameId, {
          name: "intro-room",
          participants: players.map((p) => ({
            agentId: p.id,
            mode: ParticipantMode.READ_WRITE,
            state: ParticipantState.FOLLOWED,
          })),
          type: ChannelType.GROUP,
        });

        const introByPlayer = new Map<string, StreamedMessage>();
        const introSub = app
          .getChannelMessageStream(introChannelId)
          .subscribe((msg) => {
            const isPlayer = players.some((p) => p.id === msg.authorId);
            if (!isPlayer) return;
            if (!introByPlayer.has(msg.authorId)) {
              introByPlayer.set(msg.authorId, msg);
            }
          });

        // Step 1: House announces introduction phase
        await app.sendMessage(
          introChannelId,
          "🎮 INTRODUCTION PHASE BEGINS! Please introduce yourself with ONE message. Write a long-form backstory.",
        );

        // Wait until one intro per player
        const waitForIntros = async () => {
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            if (introByPlayer.size === players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for player introductions");
        };
        await waitForIntros();

        // Step 2: Ask intro diaries in per-player DMs
        const diaryIntro = new Map<string, StreamedMessage>();
        const diaryIntroResponded = new Set<string>();
        const introDmSubs: Array<{ unsubscribe: () => void }> = [];

        for (const p of players) {
          const others = players.filter((o) => o.id !== p.id);
          const prompt = [
            `@${p.character.name} Diary Question for ${p.character.name}:`,
            `What do you think of each other player based on their introductions?`,
            ...others.map(
              (o) =>
                `- ${o.character.name}: ${introByPlayer.get(o.id)?.content}`,
            ),
          ].join("\n");

          const dmId = await app.getChannelManager().ensureDmChannel(p.id);
          const dmSub = app.getChannelMessageStream(dmId).subscribe((msg) => {
            if (msg.authorId !== p.id) return;
            if (!diaryIntro.has(msg.authorId)) {
              diaryIntro.set(msg.authorId, msg);
            }
            diaryIntroResponded.add(msg.authorId);
          });
          introDmSubs.push(dmSub);

          await app.sendMessage(dmId, prompt);
        }

        const waitForIntroDiaries = async () => {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            if (diaryIntroResponded.size === players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for intro diary responses");
        };
        await waitForIntroDiaries();

        // Cleanup intro subscriptions
        introSub.unsubscribe();
        for (const s of introDmSubs) s.unsubscribe();

        // ------ LOBBY PHASE (separate group room) ------
        const lobbyChannelId = await app.createGameChannel(gameId, {
          name: "lobby-room",
          participants: players.map((p) => ({
            agentId: p.id,
            mode: ParticipantMode.READ_WRITE,
            state: ParticipantState.FOLLOWED,
          })),
          type: ChannelType.GROUP,
        });

        const lobbyMessages: StreamedMessage[] = [];
        const lobbySub = app
          .getChannelMessageStream(lobbyChannelId)
          .subscribe((msg) => {
            const isPlayer = players.some((p) => p.id === msg.authorId);
            if (!isPlayer) return;
            lobbyMessages.push(msg);
          });

        // Step 3: Announce LOBBY and allow free conversation
        await app.sendMessage(
          lobbyChannelId,
          "🎮 LOBBY PHASE BEGINS! You may now freely respond in the group. Build alliances or test others.",
        );

        // Wait for at least one lobby message from each player
        const waitForLobbyMessages = async () => {
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            const authors = new Set(lobbyMessages.map((m) => m.authorId));
            if (authors.size >= players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for lobby messages");
        };
        await waitForLobbyMessages();

        // Step 4: Ask lobby diaries in per-player DMs
        const diaryLobby = new Map<string, StreamedMessage>();
        const diaryLobbyResponded = new Set<string>();
        const lobbyDmSubs: Array<{ unsubscribe: () => void }> = [];

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

          const dmId = await app.getChannelManager().ensureDmChannel(p.id);
          const dmSub = app.getChannelMessageStream(dmId).subscribe((msg) => {
            if (msg.authorId !== p.id) return;
            if (!diaryLobby.has(msg.authorId)) {
              diaryLobby.set(msg.authorId, msg);
            }
            diaryLobbyResponded.add(msg.authorId);
          });
          lobbyDmSubs.push(dmSub);

          await app.sendMessage(dmId, prompt);
        }

        const waitForLobbyDiaries = async () => {
          const deadline = Date.now() + 40000;
          while (Date.now() < deadline) {
            if (diaryLobbyResponded.size === players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for lobby diary responses");
        };
        await waitForLobbyDiaries();

        // Cleanup lobby subscriptions
        lobbySub.unsubscribe();
        for (const s of lobbyDmSubs) s.unsubscribe();

        // Output summaries for visibility
        const introSummary = players
          .map(
            (p) => `- ${p.character.name}: ${introByPlayer.get(p.id)?.content}`,
          )
          .join("\n");
        console.log(`📒 INTRODUCTION SUMMARIES\n${introSummary}`);

        const introDiaries = Array.from(diaryIntro.values())
          .map((m) => ({
            player: nameById.get(m.authorId)!,
            content: m.content,
          }))
          .map((d) => `- ${d.player}: ${d.content}`)
          .join("\n");
        console.log(`📒 INTRODUCTION DIARIES\n${introDiaries}`);

        // Build a summary from lobby messages (not diary responses)
        const latestLobbyByPlayer = new Map<string, StreamedMessage>();
        for (const msg of lobbyMessages) {
          if (!latestLobbyByPlayer.has(msg.authorId)) {
            latestLobbyByPlayer.set(msg.authorId, msg);
          } else {
            const prev = latestLobbyByPlayer.get(msg.authorId)!;
            if (msg.timestamp > prev.timestamp)
              latestLobbyByPlayer.set(msg.authorId, msg);
          }
        }
        const lobbySummary = players
          .map(
            (p) =>
              `- ${p.character.name}: ${latestLobbyByPlayer.get(p.id)?.content}`,
          )
          .filter(Boolean)
          .join("\n");
        console.log(`📘 LOBBY SUMMARY\n${lobbySummary}`);

        const lobbyDiarySummary = players
          .map((p) => `- ${p.character.name}: ${diaryLobby.get(p.id)?.content}`)
          .join("\n");
        console.log(`📘 LOBBY DIARY SUMMARY\n${lobbyDiarySummary}`);

        // (all subscriptions cleaned up above)

        expect(introByPlayer.size).toBe(players.length);
        expect(diaryIntroResponded.size).toBe(players.length);
        expect(lobbyMessages.length).toBeGreaterThanOrEqual(players.length);
        expect(diaryLobbyResponded.size).toBe(players.length);
      } finally {
        await app.stop();
      }
    },
    { timeout: 90000 },
  );
});
