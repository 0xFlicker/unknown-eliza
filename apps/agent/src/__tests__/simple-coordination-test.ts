import { describe, it, expect } from "vitest";
import { ConversationSimulatorV3 } from "./utils/conversation-simulator-v3";
import { coordinatorPlugin, CoordinationService } from "../plugins/coordinator";
import alexCharacter from "../characters/alex";
import houseCharacter from "../characters/house";
import { createUniqueUuid, UUID, stringToUuid, EventType } from "@elizaos/core";
import fs from "fs";
import os from "os";
import path from "path";
import { GameEventType } from "../plugins/house/events/types";
import { Phase } from "../plugins/house/types";

describe("Simple Coordination Test", () => {
  it("should test coordination", async () => {
    const simDataDir = path.join(path.join(os.tmpdir(), "simple-coord-test"));

    const sim = new ConversationSimulatorV3({
      dataDir: simDataDir,
      useModelMockingService: false,
      testContext: {
        suiteName: "SimpleCoordination",
        testName: "basic test",
      },
    });

    try {
      await sim.initialize();

      // Add a simple test house agent with just coordinator plugin
      const house = await sim.addAgent("House", houseCharacter, [
        coordinatorPlugin,
      ]);

      // Verify coordination service is available
      const houseCoordination = house.getService<CoordinationService>(
        CoordinationService.serviceType
      );

      expect(houseCoordination).toBeDefined();
      expect(house).toBeDefined();

      console.log("✅ Simple coordination test passed!");
    } finally {
      await sim.cleanup();
    }
  }, 10000);
});
