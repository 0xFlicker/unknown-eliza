import { describe, it, expect } from "bun:test";
import { InfluenceApp } from "../../server/influence-app";
import { plugin as sqlPlugin } from "@elizaos/plugin-sql";
import openaiPlugin from "@elizaos/plugin-openai";
import { coordinatorPlugin } from "../../plugins/coordinator";
import { influencerPlugin } from "../../plugins/influencer";
import { ChannelType } from "@elizaos/core";
import { ParticipantMode, ParticipantState, StreamedMessage } from "@/server";
import alexCharacter from "@/characters/alex";

describe("Introduction → Diary Room flow", () => {
  it(
    "prompts introductions, collects one intro per player, shares summary, asks diary questions, and receives responses",
    async () => {
      const app = new InfluenceApp({
        context: { suiteName: "E2E", testName: "Introduction→Diary" },
        dataDir: `.elizaos/intro-diary-${Date.now()}`,
        serverPort: 4591,
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

        // Create a game in INTRODUCTION phase and channel with players
        const gameId = await app.createGame({
          players: players.map((p) => p.id),
          settings: { minPlayers: 3, maxPlayers: 5 },
          initialPhase: 0 as any, // Phase.INTRODUCTION
        } as any);

        const channelId = await app.createGameChannel(gameId, {
          name: "intro-diary",
          participants: [
            ...players.map((p) => ({
              agentId: p.id,
              mode: ParticipantMode.READ_WRITE,
              state: ParticipantState.FOLLOWED,
            })),
          ],
          type: ChannelType.GROUP,
        });

        // Map agentId → display name helper
        const nameById = new Map(
          players.map((p) => [p.id, p.character.name] as const),
        );

        // Collect stream for assertions
        const intros = new Map<string, StreamedMessage>();
        const diary = new Map<string, StreamedMessage>();
        const diaryResponses = new Set<string>();
        let diariesStart = 0;

        const sub = app.getChannelMessageStream(channelId).subscribe((msg) => {
          const isPlayer = players.some((p) => p.id === msg.authorId);
          if (!isPlayer) return;
          if (!diariesStart) {
            // Collect first intro per player
            if (!intros.has(msg.authorId)) {
              intros.set(msg.authorId, msg);
            }
          } else {
            // After diary prompts, record one response per player
            if (msg.timestamp >= diariesStart) {
              if (!diary.has(msg.authorId)) {
                diary.set(msg.authorId, msg);
              }
              diaryResponses.add(msg.authorId);
            }
          }
        });

        // Step 1: House announces introduction phase
        await app.sendMessage(
          channelId,
          "🎮 INTRODUCTION PHASE BEGINS! Please introduce yourself with ONE message. Write a long-form backstory.",
        );

        // Wait until one intro per player
        const waitForIntros = async () => {
          const deadline = Date.now() + 15000; // 15s
          while (Date.now() < deadline) {
            if (intros.size === players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for player introductions");
        };
        await waitForIntros();

        // Step 2: House shares introduction summary
        const ordered = players.map((p) => p.id);
        const summaryLines = ordered
          .map((id) => {
            const m = intros.get(id);
            return `- ${nameById.get(id)!}: ${m?.content}`;
          })
          .join("\n");
        console.log(`📒 INTRODUCTION SUMMARIES\n${summaryLines}`);

        // Step 3: Create per-player DIARY rooms (DMs with The House) and send diary questions
        diariesStart = Date.now();

        // We'll subscribe to each DM channel separately to capture the single response
        const dmSubs: Array<{ unsubscribe: () => void }> = [];

        for (const p of players) {
          const others = players.filter((o) => o.id !== p.id);
          const prompt = [
            `@${p.character.name} Diary Question for ${p.character.name}:`,
            `What do you think of each other player based on their introductions?`,
            ...others.map(
              (o) => `- ${o.character.name}: ${intros.get(o.id)?.content}`,
            ),
          ].join("\n");

          // Ensure a DM channel exists between The House and this player
          const dmChannelId = await app
            .getChannelManager()
            .ensureDmChannel(p.id);

          // Subscribe to the DM's message stream and record the first response from the player
          const dmSub = app
            .getChannelMessageStream(dmChannelId)
            .subscribe((msg) => {
              if (msg.authorId !== p.id) return;
              if (msg.timestamp < diariesStart) return;
              if (!diary.has(msg.authorId)) {
                diary.set(msg.authorId, msg);
              }
              diaryResponses.add(msg.authorId);
            });
          dmSubs.push(dmSub);

          // Send the diary prompt into the DM channel as The House
          await app.sendMessage(dmChannelId, prompt);
        }

        // Wait for one diary response from each player
        const waitForDiaries = async () => {
          const deadline = Date.now() + 20000; // 20s
          while (Date.now() < deadline) {
            if (diaryResponses.size === players.length) return;
            await new Promise((r) => setTimeout(r, 100));
          }
          throw new Error("Timed out waiting for diary responses");
        };
        await waitForDiaries();

        // Step 4: House shares diary summary of first responses
        const diaryOrdered = players.map((p) => p.id);
        const diaryLines = diaryOrdered
          .map((id) => {
            const m = diary.get(id);
            return `- ${nameById.get(id)!}: ${m?.content}`;
          })
          .join("\n");
        // await app.sendMessage(channelId, `📘 DIARY SUMMARY\n${diaryLines}`);
        console.log(`📘 DIARY SUMMARY\n${diaryLines}`);

        sub.unsubscribe();

        expect(intros.size).toBe(players.length);
        expect(diaryResponses.size).toBe(players.length);
      } finally {
        await app.stop();
      }
    },
    { timeout: 60000 },
  );
});
