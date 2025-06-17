import { describe, expect, it, vi } from "vitest";
import { socialStrategyPlugin as plugin } from "../src/plugin/socialStrategy";
import { v4 as uuidv4 } from "uuid";
import { MemoryType } from "@elizaos/core";

describe("Plugin Routes", () => {
  it("should have routes defined", () => {
    expect(plugin.routes).toBeDefined();
    if (plugin.routes) {
      expect(Array.isArray(plugin.routes)).toBe(true);
      expect(plugin.routes.length).toBeGreaterThan(0);
    }
  });

  it("should have a route for /social-strategy", () => {
    if (plugin.routes) {
      const socialStrategyRoute = plugin.routes.find(
        (route) => route.path === "/social-strategy"
      );
      expect(socialStrategyRoute).toBeDefined();

      if (socialStrategyRoute) {
        expect(socialStrategyRoute.type).toBe("GET");
        expect(typeof socialStrategyRoute.handler).toBe("function");
      }
    }
  });

  it("should handle route requests correctly", async () => {
    if (plugin.routes) {
      const socialStrategyRoute = plugin.routes.find(
        (route) => route.path === "/social-strategy"
      );

      if (socialStrategyRoute && socialStrategyRoute.handler) {
        // Create mock request and response objects
        const mockReq = {};
        const mockRes = {
          json: vi.fn(),
        };

        // Create mock runtime with getMemoriesByIds
        const mockRuntime = {
          agentId: "test-agent",
          getMemoriesByIds: async (ids: string[]) => {
            if (ids.includes("test-agent:social-strategy")) {
              return [
                {
                  id: uuidv4(),
                  entityId: "test-agent",
                  roomId: "test-room",
                  timestamp: Date.now(),
                  content: {
                    text: JSON.stringify({
                      players: {
                        player1: {
                          id: "player1",
                          name: "Test Player",
                          trust: 50,
                          relationship: "neutral",
                        },
                      },
                      relationships: [],
                      statements: [],
                    }),
                  },
                  metadata: {
                    type: MemoryType.CUSTOM,
                  },
                },
              ];
            }
            return [];
          },
        } as any;

        // Call the route handler
        await socialStrategyRoute.handler(mockReq, mockRes, mockRuntime);

        // Verify response
        expect(mockRes.json).toHaveBeenCalledTimes(1);
        expect(mockRes.json).toHaveBeenCalledWith({
          players: {
            player1: {
              id: "player1",
              name: "Test Player",
              trust: 50,
              relationship: "neutral",
            },
          },
          relationships: [],
          statements: [],
        });
      }
    }
  });

  it("should handle missing memory gracefully", async () => {
    if (plugin.routes) {
      const socialStrategyRoute = plugin.routes.find(
        (route) => route.path === "/social-strategy"
      );

      if (socialStrategyRoute && socialStrategyRoute.handler) {
        // Create mock request and response objects
        const mockReq = {};
        const mockRes = {
          json: vi.fn(),
        };

        // Create mock runtime that returns empty memory
        const mockRuntime = {
          agentId: "test-agent",
          getMemoriesByIds: async () => [],
        } as any;

        // Call the route handler
        await socialStrategyRoute.handler(mockReq, mockRes, mockRuntime);

        // Verify response is empty state
        expect(mockRes.json).toHaveBeenCalledTimes(1);
        expect(mockRes.json).toHaveBeenCalledWith({
          players: {},
          relationships: [],
          statements: [],
        });
      }
    }
  });

  it("should validate route structure", () => {
    if (plugin.routes) {
      // Validate each route
      plugin.routes.forEach((route) => {
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("type");
        expect(route).toHaveProperty("handler");

        // Path should be a string starting with /
        expect(typeof route.path).toBe("string");
        expect(route.path.startsWith("/")).toBe(true);

        // Type should be a valid HTTP method
        expect(["GET", "POST", "PUT", "DELETE", "PATCH"]).toContain(route.type);

        // Handler should be a function
        expect(typeof route.handler).toBe("function");
      });
    }
  });

  it("should have unique route paths", () => {
    if (plugin.routes) {
      const paths = plugin.routes.map((route) => route.path);
      const uniquePaths = new Set(paths);
      expect(paths.length).toBe(uniquePaths.size);
    }
  });
});
