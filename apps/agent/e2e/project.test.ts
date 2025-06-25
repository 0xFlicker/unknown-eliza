import { character } from "../src/index.ts";
import { v4 as uuidv4 } from "uuid";
import {
  type UUID,
  type Memory,
  MemoryType,
  stringToUuid,
} from "@elizaos/core";

// Define a minimal TestSuite interface that matches what's needed
interface TestSuite {
  name: string;
  description: string;
  tests: Array<{
    name: string;
    fn: (runtime: any) => Promise<any>;
  }>;
}

// Define minimal interfaces for the types we need
interface State {
  values: Record<string, unknown>;
  data: Record<string, unknown>;
  text: string;
}

interface Content {
  text: string;
  source?: string;
  actions?: string[];
}

interface HandlerResult {
  success: boolean;
  data: {
    players: Record<UUID, unknown>;
    relationships: unknown[];
    statements: unknown[];
    [key: string]: unknown;
  };
}

export class ProjectTestSuite implements TestSuite {
  name = "project";
  description = "E2E tests for project-specific features";

  tests = [
    {
      name: "Project runtime environment test",
      fn: async (runtime: any) => {
        // Test that the project's runtime environment is set up correctly
        try {
          // Verify character is loaded
          if (!runtime.character) {
            throw new Error("Character not loaded in runtime");
          }

          // Verify expected character properties
          const character = runtime.character;
          if (!character.name) {
            throw new Error("Character name is missing");
          }

          // No need to return anything - assertions above will throw on failure
        } catch (error) {
          throw new Error(
            `Project runtime environment test failed: ${error.message}`
          );
        }
      },
    },
  ];
}

// Export a default instance of the test suite for the E2E test runner
export default new ProjectTestSuite();
