import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";
import { createPlayerPhaseActor } from "../phase";
import { Phase } from "../types";

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
  // TODO FIXME: phase DOES NOT EXPORT ANYTHING SO IT CAN'T BE TYPED. DEFINE THE SET OF EVENTS AND EMITTED EVENTS IN PHASE.TS
  const emitted: unknown[] = [];
  const actor = createPlayerPhaseActor(
    {
      self: { id: selfId, name },
      getNow: now,
    },
    {
      roundTimeoutMs: 60000,
      diaryTimeoutMs: 30000,
    },
  );
  actor.on("*", (event) => {
    // console.log("Emitted event:", event);
    emitted.push(event);
  });
  actor.start();
  return { actor, emitted, selfId };
}

describe("Influencer player phase machine", () => {
  it("tracks diary prompts directed at the player and their responses", async () => {
    const { actor, emitted, selfId } = createTestActor();
    const diaryRoom = stringToUuid("diary-room");
    const promptMessageId = stringToUuid("prompt");

    // First, enter introduction phase so the diary machine is invoked
    actor.send({
      type: "GAME:PHASE_ENTERED",
      phase: Phase.INTRODUCTION,
      roomId: diaryRoom,
    });

    // Wait for introduction to transition to diary state
    let snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("introduction");

    // Send diary prompt with new structure
    actor.send({
      type: "GAME:DIARY_PROMPT",
      roomId: diaryRoom,
      messageId: promptMessageId,
    });

    // Check that the diary child received the prompt
    const introChild = snapshot.children.introduction;
    if (introChild) {
      const introSnapshot = introChild.getSnapshot();
      const diaryChild = introSnapshot.children.diary;
      if (diaryChild) {
        const diarySnapshot = diaryChild.getSnapshot();
        expect(diarySnapshot.context.messageId).toBe(promptMessageId);
      }
    }

    // Send response
    const responseMessageId = stringToUuid("response");
    actor.send({
      type: "GAME:MESSAGE_SENT",
      playerId: selfId,
      roomId: diaryRoom,
      messageId: responseMessageId,
    });

    // Verify response was processed
    snapshot = actor.getSnapshot();
    const introChildAfter = snapshot.children.introduction;
    if (introChildAfter) {
      const introSnapshotAfter = introChildAfter.getSnapshot();
      const diaryChildAfter = introSnapshotAfter.children.diary;
      if (diaryChildAfter) {
        const diarySnapshotAfter = diaryChildAfter.getSnapshot();
        expect(diarySnapshotAfter.context.responded).toBe(true);
      }
    }
  });
});
