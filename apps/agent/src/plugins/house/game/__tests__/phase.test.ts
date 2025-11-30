import { createActor } from "xstate";
import { createPhaseMachine } from "../phase";
import { Phase } from "../types";
import { describe, it, expect } from "bun:test";
import { stringToUuid } from "@elizaos/core";
import { pbkdf2 } from "crypto";

describe("Phase → DiaryRoom integration", () => {
  it("goes through diary phase and ends in LOBBY", () => {
    const p1 = stringToUuid("p1");
    const actor = createActor(
      createPhaseMachine({
        id: stringToUuid("game1"),
        timers: {
          diary: 1000,
          round: 1000,
          whisper: 1000,
          whisper_pick: 500,
          whisper_room: 500,
          diary_prompt: 500,
          diary_ready: 500,
          diary_response: 500,
        },
      }),
      {
        input: {
          playerSettings: [
            {
              agentId: p1,
              diaryRoomId: stringToUuid("diary1"),
            },
          ],
          maxPlayers: 2,
          minPlayers: 1,
        },
      },
    ).start();

    expect(actor.getSnapshot().value).toBe("init");
    actor.send({ type: "GAME:PLAYER_READY", playerId: p1 });

    expect(actor.getSnapshot().value).toBe("introduction_wait");

    // House creates the room
    const introRoomId = stringToUuid("intro");
    actor.send({
      type: "GAME:CREATE_ROOM",
      roomId: introRoomId,
      ownerId: p1,
      participantIds: [p1],
    });

    expect(actor.getSnapshot().value).toEqual({
      introduction: "waiting",
    });

    actor.send({
      type: "GAME:MESSAGE_SENT",
      playerId: p1,
      messageId: stringToUuid("m1"),
      roomId: introRoomId,
    });

    expect(actor.getSnapshot().value).toEqual({
      introduction: "strategy",
    });

    actor.send({
      type: "GAME:DIARY_PROMPT",
      messageId: stringToUuid("prompt1"),
      playerId: p1,
      roomId: stringToUuid("p1-diary"),
    });
    actor.send({
      type: "GAME:DIARY_RESPONSE",
      playerId: p1,
      roomId: stringToUuid("p1-diary"),
      messageId: stringToUuid("response1"),
    });

    expect(
      actor.getSnapshot().children?.["introduction-diary"]?.getSnapshot()
        ?.value,
    ).toBe("prompting");

    actor.send({ type: "GAME:PLAYER_READY", playerId: p1 });

    expect(actor.getSnapshot().value).toBe("lobby_wait");
  });
});
