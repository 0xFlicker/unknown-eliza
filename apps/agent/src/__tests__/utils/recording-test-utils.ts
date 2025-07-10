import { expect } from "vitest";

/**
 * Test utilities for recording mode that allow soft failures
 */

/**
 * Check if we're in recording mode
 */
export function isSoftMode(): boolean {
  return process.env.SOFT_MODE === "true";
}

/**
 * Soft expect that logs warnings instead of failing in record mode
 */
export function expectSoft<T>(actual: T) {
  if (isSoftMode()) {
    return new SoftExpectWrapper(actual);
  }
  return expect(actual);
}

/**
 * Wrapper that converts assertion failures to warnings in record mode
 */
class SoftExpectWrapper<T> {
  constructor(private actual: T) {}

  toBe(expected: T) {
    try {
      expect(this.actual).toBe(expected);
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to be ${expected}`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toContain(expected: any) {
    try {
      expect(this.actual).toContain(expected);
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to contain ${expected}`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toEqual(expected: T) {
    try {
      expect(this.actual).toEqual(expected);
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to equal ${expected}`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toBeGreaterThan(expected: number) {
    try {
      expect(this.actual).toBeGreaterThan(expected);
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to be greater than ${expected}`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toBeGreaterThanOrEqual(expected: number) {
    try {
      expect(this.actual).toBeGreaterThanOrEqual(expected);
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to be greater than or equal to ${expected}`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toBeUndefined() {
    try {
      expect(this.actual).toBeUndefined();
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to be undefined`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toBeDefined() {
    try {
      expect(this.actual).toBeDefined();
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to be defined`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }

  toHaveLength(expected: number) {
    try {
      expect(this.actual).toHaveLength(expected);
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Soft assertion failed: expected ${this.actual} to have length ${expected}`
      );
      console.warn(
        `🎬 [RECORD MODE] Error:`,
        error instanceof Error ? error.message : error
      );
    }
    return this;
  }
}

/**
 * Recording-aware test wrapper that provides utilities for soft assertions
 */
export class RecordingTestUtils {
  static isRecording = isSoftMode();

  /**
   * Execute a block of code with soft assertions in record mode
   */
  static async withSoftAssertions<T>(
    fn: () => Promise<T>
  ): Promise<T | undefined> {
    if (!this.isRecording) {
      return await fn();
    }

    try {
      return await fn();
    } catch (error) {
      console.warn(
        `🎬 [RECORD MODE] Test block failed (continuing for recording):`,
        error
      );
      return undefined;
    }
  }

  /**
   * Log recording status
   */
  static logRecordingStatus(testName: string) {
    if (this.isRecording) {
      console.log(`🎬 [RECORD MODE] Recording model calls for: ${testName}`);
    }
  }

  /**
   * Update test expectations based on actual values (for manual copying)
   */
  static suggestExpectation(description: string, actual: any, expected: any) {
    if (this.isRecording && actual !== expected) {
      console.log(`🔧 [RECORD MODE] Suggestion for ${description}:`);
      console.log(
        `   expect(...).toBe(${JSON.stringify(actual)}) // was: ${JSON.stringify(expected)}`
      );
    }
  }
}
