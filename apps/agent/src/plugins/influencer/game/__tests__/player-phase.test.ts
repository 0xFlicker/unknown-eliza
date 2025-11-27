import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";
import { createPlayerPhaseActor, PlayerPhaseEmitted } from "../phase";
import { Phase } from "../types";
import { ac } from "../../../../../../../packages/core/dist/index-C2b71pQw";

function createTestActor({
  name = "Alpha",
  now = (() => {
    let current = 0;
    return () => {
      current += 1000;
      return current;
    };
  })(),
}: { name?: string; now?: () => number } = {}) {
  const selfId = stringToUuid(name);
  const emitted: PlayerPhaseEmitted[] = [];
  const actor = createPlayerPhaseActor({
    self: { id: selfId, name },
    getNow: now,
  });
  actor.on("*", (event) => {
    // console.log("Emitted event:", event);
    emitted.push(event);
  });
  actor.start();
  return { actor, emitted, selfId };
}

describe("Influencer player phase machine", () => {
  it("marks introductions as required when the introduction phase begins", () => {
    const { actor, emitted } = createTestActor();
    const introRoom = stringToUuid("intro-room");

    actor.send({
      type: "GAME:PHASE_ENTERED",
      phase: Phase.INTRODUCTION,
      roomId: introRoom,
      timestamp: 42_000,
    });

    const snapshot = actor.getSnapshot();
    expect(snapshot.context.currentPhase).toBe(Phase.INTRODUCTION);
    expect(snapshot.context.phaseEnteredAt).toBe(42_000);
    // expect(snapshot.context.introduction.required).toBe(true);
    // expect(snapshot.context.introduction.roomId).toBe(introRoom);

    expect(emitted.map((e) => e.type)).toEqual(["PLAYER:PHASE_UPDATED"]);
  });

  // it("records our own introduction and emits completion", async () => {
  //   const { actor, emitted, selfId } = createTestActor();
  //   const introRoom = stringToUuid("intro-room");
  //   const introMessage = stringToUuid("intro-message");

  //   actor.send({
  //     type: "GAME:PHASE_ENTERED",
  //     phase: Phase.INTRODUCTION,
  //     roomId: introRoom,
  //     timestamp: 5_000,
  //   });

  //   emitted.length = 0; // ignore phase update notifications

  //   actor.send({
  //     type: "PLAYER:INTRODUCTION_SENT",
  //     playerId: selfId,
  //     roomId: introRoom,
  //     messageId: introMessage,
  //     timestamp: 7_500,
  //   });

  //   const snapshot = actor.getSnapshot();
  //   expect(snapshot.context.introduction.required).toBe(false);
  //   expect(snapshot.context.introduction.messageId).toBe(introMessage);
  //   expect(snapshot.context.introduction.completedAt).toBe(7_500);

  //   expect(emitted).toEqual([
  //     {
  //       type: "PLAYER:INTRO_COMPLETED",
  //       roomId: introRoom,
  //       messageId: introMessage,
  //       timestamp: 7_500,
  //     },
  //   ]);
  // });

  it("tracks diary prompts directed at the player and their responses", async () => {
    const { actor, emitted, selfId } = createTestActor();
    const diaryRoom = stringToUuid("diary-room");

    actor.send({
      type: "GAME:DIARY_PROMPT",
      roomId: diaryRoom,
      targetAgentId: selfId,
      promptMessageId: stringToUuid("prompt"),
      phase: Phase.INTRODUCTION,
      timestamp: 12_000,
    });

    const afterPrompt = actor.getSnapshot();
    const promptState = afterPrompt.context.diaryPrompts[diaryRoom];
    expect(promptState).toBeDefined();
    expect(promptState?.promptAt).toBe(12_000);
    expect(promptState?.respondedAt).toBeUndefined();

    expect(emitted).toEqual([
      {
        type: "PLAYER:DIARY_PROMPT",
        prompt: promptState!,
      },
    ]);
    emitted.length = 0;

    actor.send({
      type: "PLAYER:DIARY_RESPONSE_SENT",
      playerId: selfId,
      roomId: diaryRoom,
      messageId: stringToUuid("response"),
      timestamp: 13_500,
    });

    const afterResponse = actor.getSnapshot();
    const resolvedPrompt = afterResponse.context.diaryPrompts[diaryRoom];
    expect(resolvedPrompt?.respondedAt).toBe(13_500);

    expect(emitted).toEqual([
      {
        type: "PLAYER:DIARY_COMPLETED",
        roomId: diaryRoom,
        timestamp: 13_500,
      },
    ]);
  });

  it("captures other players as they are observed", () => {
    const { actor, emitted } = createTestActor();
    const otherId = stringToUuid("beta");
    const groupRoom = stringToUuid("group-room");

    actor.send({
      type: "PLAYER:SEEN",
      playerId: otherId,
      name: "Beta",
      roomId: groupRoom,
      timestamp: 21_000,
    });

    const snapshot = actor.getSnapshot();
    // console.log(snapshot.context);
    const known = snapshot.context.knownPlayers[otherId];
    expect(known).toBeDefined();
    expect(known?.name).toBe("Beta");
    expect(known?.roomsSeenIn).toEqual([groupRoom]);
    expect(known?.firstSeenAt).toBe(21_000);
    expect(known?.lastSeenAt).toBe(21_000);

    expect(emitted).toEqual([
      {
        type: "PLAYER:KNOWN_PLAYER_SEEN",
        player: known!,
      },
    ]);
  });
});
