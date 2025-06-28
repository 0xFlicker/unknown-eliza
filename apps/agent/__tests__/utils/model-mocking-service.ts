import { vi } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import type { IAgentRuntime } from "@elizaos/core";

/**
 * Represents a single model call recording
 */
export interface ModelCallRecord {
  id: string;
  agentId: string;
  modelType: string;
  prompt: string;
  promptHash: string; // SHA-256 hash of prompt content for content-based matching
  contextHash?: string; // Hash of conversation context
  options: Record<string, any>;
  response: string;
  timestamp: string;
  relativeTimestamp?: number; // Milliseconds since test start
  globalSequence?: number; // Global call order across all agents
  testContext?: {
    suiteName: string;
    testName: string;
  };
}

/**
 * Storage format for model recordings
 */
export interface ModelRecordingFile {
  testSuite: string;
  testName: string;
  recordings: ModelCallRecord[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    version: string;
  };
}

/**
 * Configuration for model mocking behavior
 */
export interface ModelMockConfig {
  mode: "record" | "playback" | "verify";
  recordingsDir: string;
  recordSpecificTests?: string[];
  verifyTemperature?: number;
}

/**
 * Result of agent response attempt
 */
export interface AgentResponseResult {
  agentName: string;
  responded: boolean;
  response?: string;
  modelCalls: number;
  error?: string;
}

/**
 * Comprehensive model mocking service that supports record, playback, and verify modes
 */
export class ModelMockingService {
  private config: ModelMockConfig;
  private recordings: Map<string, ModelCallRecord[]> = new Map();
  private callCounters: Map<string, number> = new Map();
  private playbackCounters: Map<string, number> = new Map();
  private usedPromptHashes: Map<string, Set<string>> = new Map(); // Track used hashes per test
  private testStartTime?: number; // Track test start time for relative timestamps
  private globalSequence: number = 0; // Global call sequence counter
  private currentTest?: { suiteName: string; testName: string };

  // Playback ordering guarantees
  private playbackQueue: Array<{
    resolve: (value: any) => void;
    reject: (error: any) => void;
    record: ModelCallRecord;
    callId: string;
  }> = [];
  private playbackSequence: number = 0;
  private isProcessingPlayback: boolean = false;

  constructor(config?: Partial<ModelMockConfig>) {
    this.config = {
      mode: this.getModeFromEnv(),
      recordingsDir: process.env.MODEL_RECORDINGS_DIR || "./recordings",
      recordSpecificTests: this.getRecordTestsFromEnv(),
      verifyTemperature: 1.0,
      ...config,
    };

    // Ensure recordings directory exists
    if (!existsSync(this.config.recordingsDir)) {
      mkdirSync(this.config.recordingsDir, { recursive: true });
    }
  }

  /**
   * Set the current test context for recording organization
   */
  setTestContext(suiteName: string, testName: string): void {
    this.currentTest = { suiteName, testName };
    this.loadRecordingsForTest(suiteName, testName);

    // Clear recordings for this test if we're in record mode
    // This ensures clean re-recording without duplicates
    if (this.config.mode === "record") {
      const recordingKey = this.getRecordingKey(suiteName, testName);
      this.recordings.set(recordingKey, []);
      console.log(
        `🧹 Cleared existing recordings for clean re-recording: ${testName}`
      );
    }

    // Always clear counters and tracking for fresh test run
    this.callCounters.clear();
    this.playbackCounters.clear();
    this.usedPromptHashes.clear();
    this.testStartTime = Date.now();
    this.globalSequence = 0;

    // Clear playback ordering state
    this.playbackQueue = [];
    this.playbackSequence = 0;
    this.isProcessingPlayback = false;
  }

  /**
   * Monkey patch a runtime to intercept useModel calls
   */
  patchRuntime(runtime: IAgentRuntime, agentId: string): () => void {
    const originalUseModel = runtime.useModel.bind(runtime);

    runtime.useModel = vi
      .fn()
      .mockImplementation(async (modelType: string, options: any) => {
        const callId = this.generateCallId(agentId, modelType);
        // console.log(`📞 Model call: ${agentId} -> ${modelType} (${callId}) [${this.config.mode} mode]`);

        switch (this.config.mode) {
          case "record":
            return this.recordCall(
              originalUseModel,
              callId,
              agentId,
              modelType,
              options
            );

          case "playback":
            return this.playbackCall(callId, agentId, modelType, options);

          case "verify":
            return this.verifyCall(
              originalUseModel,
              callId,
              agentId,
              modelType,
              options
            );

          default:
            throw new Error(`Unknown model mock mode: ${this.config.mode}`);
        }
      });

    // Return cleanup function
    return () => {
      runtime.useModel = originalUseModel;
    };
  }

  /**
   * Get agent response statistics for testing
   */
  getResponseStats(): { totalResponses: number; totalCalls: number } {
    const totalCalls = Array.from(this.callCounters.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const totalResponses = Array.from(this.recordings.values()).reduce(
      (sum, records) => sum + records.length,
      0
    );

    return { totalResponses, totalCalls };
  }

  /**
   * Save all recordings for the current test with deduplication and clean organization
   */
  async saveRecordings(): Promise<void> {
    if (!this.currentTest || this.config.mode !== "record") return;

    const { suiteName, testName } = this.currentTest;
    const recordingKey = this.getRecordingKey(suiteName, testName);
    const records = this.recordings.get(recordingKey) || [];

    if (records.length === 0) return;

    // Deduplicate records by ID (keep the latest based on timestamp)
    const deduplicatedRecords = this.deduplicateRecordings(records);

    // Sort records for consistent ordering (by agent, then model type, then call number)
    const sortedRecords = this.sortRecordings(deduplicatedRecords);

    const filePath = this.getRecordingFilePath(suiteName, testName);
    const recordingFile: ModelRecordingFile = {
      testSuite: suiteName,
      testName: testName,
      recordings: sortedRecords,
      metadata: {
        createdAt: sortedRecords[0]?.timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: "2.0.0", // Bump version to indicate improved format
      },
    };

    // Ensure directory exists
    mkdirSync(dirname(filePath), { recursive: true });

    writeFileSync(filePath, JSON.stringify(recordingFile, null, 2));
    console.log(
      `📹 Saved ${sortedRecords.length} deduplicated model call recordings to ${filePath}`
    );

    if (records.length !== sortedRecords.length) {
      console.log(
        `🧹 Removed ${records.length - sortedRecords.length} duplicate recordings`
      );
    }
  }

  /**
   * Remove duplicate recordings, keeping the latest based on timestamp
   */
  private deduplicateRecordings(records: ModelCallRecord[]): ModelCallRecord[] {
    const recordMap = new Map<string, ModelCallRecord>();

    for (const record of records) {
      const existing = recordMap.get(record.id);
      if (
        !existing ||
        new Date(record.timestamp) > new Date(existing.timestamp)
      ) {
        recordMap.set(record.id, record);
      }
    }

    return Array.from(recordMap.values());
  }

  /**
   * Sort recordings for consistent file organization
   */
  private sortRecordings(records: ModelCallRecord[]): ModelCallRecord[] {
    return records.sort((a, b) => {
      // Sort by agent ID first
      if (a.agentId !== b.agentId) {
        return a.agentId.localeCompare(b.agentId);
      }

      // Then by model type
      if (a.modelType !== b.modelType) {
        return a.modelType.localeCompare(b.modelType);
      }

      // Finally by call number (extracted from ID)
      const aCallNum = this.extractCallNumber(a.id);
      const bCallNum = this.extractCallNumber(b.id);
      return aCallNum - bCallNum;
    });
  }

  /**
   * Extract call number from recording ID for sorting
   */
  private extractCallNumber(id: string): number {
    const match = id.match(/-call-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Clear recordings for current test (useful for test cleanup)
   */
  clearCurrentRecordings(): void {
    if (!this.currentTest) return;

    const recordingKey = this.getRecordingKey(
      this.currentTest.suiteName,
      this.currentTest.testName
    );
    this.recordings.delete(recordingKey);
    this.callCounters.clear();
  }

  // Private methods

  /**
   * Hash content for content-based matching
   */
  private hashContent(content: string): string {
    return createHash("sha256")
      .update(content.trim())
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * Create a context hash from conversation state
   */
  private createContextHash(agentId: string, modelType: string): string {
    const context = `${agentId}-${modelType}-${this.globalSequence}`;
    return this.hashContent(context);
  }

  /**
   * Find best content match using fuzzy matching
   */
  private findBestContentMatch(
    records: ModelCallRecord[],
    agentId: string,
    modelType: string,
    promptContent: string
  ): ModelCallRecord | undefined {
    const agentModelRecords = records.filter(
      (r) => r.agentId === agentId && r.modelType === modelType
    );

    if (agentModelRecords.length === 0) return undefined;

    // Simple fuzzy matching based on prompt similarity
    let bestMatch: ModelCallRecord | undefined;
    let bestScore = 0;

    for (const record of agentModelRecords) {
      const similarity = this.calculatePromptSimilarity(
        promptContent,
        record.prompt
      );
      if (similarity > bestScore && similarity > 0.8) {
        // 80% similarity threshold
        bestScore = similarity;
        bestMatch = record;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate prompt similarity using simple string metrics
   */
  private calculatePromptSimilarity(prompt1: string, prompt2: string): number {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/\s+/g, " ").trim();
    const n1 = normalize(prompt1);
    const n2 = normalize(prompt2);

    if (n1 === n2) return 1.0;
    if (n1.length === 0 || n2.length === 0) return 0;

    // Simple Jaccard similarity
    const set1 = new Set(n1.split(" "));
    const set2 = new Set(n2.split(" "));
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  private getModeFromEnv(): "record" | "playback" | "verify" {
    if (process.env.MODEL_RECORD_MODE === "true") return "record";
    if (process.env.MODEL_VERIFY_MODE === "true") return "verify";
    return "playback"; // Default
  }

  private getRecordTestsFromEnv(): string[] | undefined {
    const tests = process.env.MODEL_RECORD_TESTS;
    return tests ? tests.split(",").map((t) => t.trim()) : undefined;
  }

  private shouldRecordForCurrentTest(): boolean {
    if (!this.currentTest) return false;
    if (!this.config.recordSpecificTests) return true;

    return this.config.recordSpecificTests.some(
      (testPattern) =>
        this.currentTest!.testName.includes(testPattern) ||
        this.currentTest!.suiteName.includes(testPattern)
    );
  }

  private generateCallId(agentId: string, modelType: string): string {
    // Use a more specific key for recording that includes model type
    const callKey = `${agentId}-${modelType}`;
    const count = this.callCounters.get(callKey) || 0;
    this.callCounters.set(callKey, count + 1);
    return `${agentId}-${modelType}-call-${count + 1}`;
  }

  private getRecordingKey(suiteName: string, testName: string): string {
    return `${suiteName}::${testName}`;
  }

  private getRecordingFilePath(suiteName: string, testName: string): string {
    const sanitizedSuite = suiteName.replace(/[^a-zA-Z0-9-_]/g, "_");
    const sanitizedTest = testName.replace(/[^a-zA-Z0-9-_]/g, "_");
    return join(
      this.config.recordingsDir,
      `${sanitizedSuite}__${sanitizedTest}.json`
    );
  }

  private loadRecordingsForTest(suiteName: string, testName: string): void {
    const filePath = this.getRecordingFilePath(suiteName, testName);
    const recordingKey = this.getRecordingKey(suiteName, testName);

    if (existsSync(filePath)) {
      try {
        const fileContent = readFileSync(filePath, "utf-8");
        const recordingFile: ModelRecordingFile = JSON.parse(fileContent);

        // Migrate and clean recordings on load
        const cleanedRecordings = this.migrateAndCleanRecordings(
          recordingFile.recordings,
          recordingFile.metadata?.version
        );

        this.recordings.set(recordingKey, cleanedRecordings);
        console.log(
          `📼 Loaded ${cleanedRecordings.length} model call recordings from ${filePath} (version: ${recordingFile.metadata?.version || "legacy"})`
        );

        if (cleanedRecordings.length !== recordingFile.recordings.length) {
          console.log(
            `🧹 Cleaned ${recordingFile.recordings.length - cleanedRecordings.length} problematic recordings during load`
          );
        }
      } catch (error) {
        console.warn(`⚠️ Failed to load recordings from ${filePath}:`, error);
        this.recordings.set(recordingKey, []);
      }
    } else {
      this.recordings.set(recordingKey, []);
    }
  }

  /**
   * Migrate recordings from older formats and clean up issues
   */
  private migrateAndCleanRecordings(
    recordings: ModelCallRecord[],
    version?: string
  ): ModelCallRecord[] {
    let migratedRecordings = [...recordings];

    // For legacy recordings (pre-2.0.0), clean up duplicates and fix IDs
    if (!version || version < "2.0.0") {
      console.log("🔄 Migrating recordings from legacy format...");

      // Deduplicate by ID, keeping the latest
      migratedRecordings = this.deduplicateRecordings(migratedRecordings);

      // Fix any malformed response data (arrays stored as raw instead of JSON strings)
      migratedRecordings = migratedRecordings.map((record, index) => {
        let updatedRecord = { ...record };

        if (Array.isArray(record.response)) {
          console.warn(
            `🔧 Converting array response to JSON string for ${record.id}`
          );
          updatedRecord.response = JSON.stringify(record.response);
        }

        // Add missing hash fields for legacy records
        if (!record.promptHash) {
          updatedRecord.promptHash = this.hashContent(record.prompt || "");
        }

        if (!record.contextHash) {
          updatedRecord.contextHash = this.hashContent(
            `${record.agentId}-${record.modelType}-${index}`
          );
        }

        if (!record.relativeTimestamp) {
          updatedRecord.relativeTimestamp = index * 1000; // Approximate timing
        }

        if (!record.globalSequence) {
          updatedRecord.globalSequence = index + 1;
        }

        return updatedRecord;
      });

      // Sort for consistent ordering
      migratedRecordings = this.sortRecordings(migratedRecordings);
    }

    return migratedRecordings;
  }

  private async recordCall(
    originalUseModel: Function,
    callId: string,
    agentId: string,
    modelType: string,
    options: any
  ) {
    if (!this.shouldRecordForCurrentTest()) {
      // If not recording this test, just pass through
      return originalUseModel(modelType, options);
    }

    const response = await originalUseModel(modelType, options);

    // Ensure we record the response in a consistent format
    // For text models, response should already be a string
    // For other models, we need to handle the type appropriately
    let recordedResponse: string;
    if (typeof response === "string") {
      recordedResponse = response;
    } else {
      recordedResponse = JSON.stringify(response);
    }

    const promptContent = options?.prompt || options?.text || "";
    const promptHash = this.hashContent(promptContent);
    const contextHash = this.createContextHash(agentId, modelType);
    const relativeTimestamp = this.testStartTime
      ? Date.now() - this.testStartTime
      : 0;

    this.globalSequence++;

    const record: ModelCallRecord = {
      id: callId,
      agentId,
      modelType,
      prompt: promptContent,
      promptHash,
      contextHash,
      options: options ? { ...options } : {},
      response: recordedResponse,
      timestamp: new Date().toISOString(),
      relativeTimestamp,
      globalSequence: this.globalSequence,
      testContext: this.currentTest,
    };

    const recordingKey = this.getRecordingKey(
      this.currentTest!.suiteName,
      this.currentTest!.testName
    );
    const records = this.recordings.get(recordingKey) || [];
    records.push(record);
    this.recordings.set(recordingKey, records);

    console.log(
      `🎬 Recorded model call ${callId} for ${agentId} (${modelType}) hash:${promptHash.substring(0, 8)}`
    );
    return response;
  }

  private async playbackCall(
    callId: string,
    agentId: string,
    modelType: string,
    options: any
  ): Promise<any> {
    if (!this.currentTest) {
      throw new Error("No test context set for playback mode");
    }

    const recordingKey = this.getRecordingKey(
      this.currentTest.suiteName,
      this.currentTest.testName
    );
    const records = this.recordings.get(recordingKey) || [];
    const promptContent = options?.prompt || options?.text || "";
    const promptHash = this.hashContent(promptContent);

    // Strategy 1: Exact content match by prompt hash
    let matchingRecord = records.find(
      (r) =>
        r.agentId === agentId &&
        r.modelType === modelType &&
        r.promptHash === promptHash
    );

    if (matchingRecord) {
      console.log(
        `▶️ Content match: ${matchingRecord.id} for ${agentId} (${modelType}) hash:${promptHash.substring(0, 8)}`
      );
      return this.queueOrderedPlayback(matchingRecord, callId);
    }

    // Strategy 2: Fuzzy content matching
    matchingRecord = this.findBestContentMatch(
      records,
      agentId,
      modelType,
      promptContent
    );

    if (matchingRecord) {
      console.log(
        `▶️ Fuzzy match: ${matchingRecord.id} for ${agentId} (${modelType}) similarity > 80%`
      );
      return this.queueOrderedPlayback(matchingRecord, callId);
    }

    // Strategy 3: Sequential fallback with ordering
    const sortedRecords = records
      .filter((r) => r.agentId === agentId && r.modelType === modelType)
      .sort((a, b) => (a.globalSequence || 0) - (b.globalSequence || 0));

    const playbackKey = `${agentId}-${modelType}`;
    const callIndex = this.playbackCounters.get(playbackKey) || 0;

    if (callIndex < sortedRecords.length) {
      const record = sortedRecords[callIndex];
      this.playbackCounters.set(playbackKey, callIndex + 1);
      console.log(
        `▶️ Sequential fallback: ${record.id} for ${agentId} (${modelType}) call ${callIndex + 1} (seq: ${record.globalSequence})`
      );
      return this.queueOrderedPlayback(record, callId);
    }

    // No match found - enhanced error reporting
    this.throwDetailedPlaybackError(
      agentId,
      modelType,
      promptContent,
      promptHash,
      callIndex,
      sortedRecords,
      records
    );
  }

  /**
   * Queue a model call for ordered playback to ensure deterministic timing
   */
  private async queueOrderedPlayback(
    record: ModelCallRecord,
    callId: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.playbackQueue.push({
        resolve,
        reject,
        record,
        callId,
      });

      // Start processing queue if not already processing
      if (!this.isProcessingPlayback) {
        this.processPlaybackQueue();
      }
    });
  }

  /**
   * Process playback queue in order to ensure deterministic timing
   */
  private async processPlaybackQueue(): Promise<void> {
    if (this.isProcessingPlayback || this.playbackQueue.length === 0) {
      return;
    }

    this.isProcessingPlayback = true;

    try {
      // Sort queue by global sequence to ensure original recording order
      this.playbackQueue.sort(
        (a, b) =>
          (a.record.globalSequence || 0) - (b.record.globalSequence || 0)
      );

      while (this.playbackQueue.length > 0) {
        const { resolve, record, callId } = this.playbackQueue.shift()!;

        try {
          console.log(
            `🎬 Ordered playback: ${callId} (seq: ${record.globalSequence})`
          );

          const response = this.parseRecordedResponse(record, record.modelType);
          resolve(response);

          // Small delay to maintain timing characteristics
          // Skip delay in playback mode for better performance
          const isRecordMode = process.env.MODEL_RECORD_MODE === "true";
          if (isRecordMode) {
            await new Promise((r) => setTimeout(r, 10));
          }
        } catch (error) {
          resolve(error);
        }
      }
    } finally {
      this.isProcessingPlayback = false;
    }
  }

  /**
   * Parse recorded response based on model type with dimension validation and transformation
   */
  private parseRecordedResponse(
    record: ModelCallRecord,
    modelType: string
  ): any {
    let response: any = record.response;

    // If the response looks like JSON (starts with [ or {), try to parse it
    if (
      typeof response === "string" &&
      (response.startsWith("[") || response.startsWith("{"))
    ) {
      try {
        const parsed = JSON.parse(response);

        // this HACK was always transforming 1536-dimensional embeddings to 384, which while useful for some cases, is not always appropriate
        // // For embedding models, validate dimensions and transform if needed
        // if (modelType === "TEXT_EMBEDDING" && Array.isArray(parsed)) {
        //   const dimensions = parsed.length;
        //   console.log(
        //     `🔢 Embedding response: ${dimensions} dimensions for ${record.agentId} (${record.id})`
        //   );

        //   // Transform 1536-dimensional embeddings to 384 for compatibility
        //   if (dimensions === 1536) {
        //     console.log(
        //       `🔄 Transforming 1536-dim embedding to 384-dim for database compatibility (${record.id})`
        //     );
        //     // Simple dimensionality reduction: take every 4th element
        //     const reduced = [];
        //     for (let i = 0; i < 384; i++) {
        //       reduced.push(parsed[i * 4]);
        //     }
        //     response = reduced;
        //     console.log(
        //       `✅ Transformed embedding from ${dimensions} to ${reduced.length} dimensions`
        //     );
        //   } else if (dimensions === 384) {
        //     // Already correct size
        //     response = parsed;
        //   } else {
        //     console.warn(
        //       `⚠️ Unsupported embedding dimensions (${dimensions}) for ${record.id} - may cause database insertion errors`
        //     );
        //     response = parsed;
        //   }
        // } else {
        //   // For text models, keep the parsed object
        //   response = parsed;
        // }
        response = parsed; // Keep parsed object for text models
      } catch (e) {
        console.warn(
          `Failed to parse JSON response for ${record.id}, using as string`
        );
        // Keep as string if parsing fails
      }
    }

    return response;
  }

  /**
   * Throw detailed error for playback failures with diagnostics
   */
  private throwDetailedPlaybackError(
    agentId: string,
    modelType: string,
    promptContent: string,
    promptHash: string,
    callIndex: number,
    agentModelCalls: ModelCallRecord[],
    allRecords: ModelCallRecord[]
  ): never {
    const availableCalls = agentModelCalls.map((r, i) => ({
      index: i + 1,
      promptPreview: r.prompt.substring(0, 80),
      promptHash: r.promptHash?.substring(0, 8) || "N/A",
      timestamp: r.timestamp,
      id: r.id,
    }));

    const allAgentModelTypes = new Set(
      allRecords.filter((r) => r.agentId === agentId).map((r) => r.modelType)
    );

    const diagnostics = {
      requestedCall: callIndex + 1,
      availableCalls: agentModelCalls.length,
      agent: agentId,
      modelType: modelType,
      promptHash: promptHash.substring(0, 8),
      currentPromptPreview: promptContent.substring(0, 80),
      availableRecordings: availableCalls,
      allModelTypes: Array.from(allAgentModelTypes),
    };

    const errorMessage =
      `❌ PLAYBACK MISMATCH for ${agentId}:${modelType}\n` +
      `Expected call: ${callIndex + 1}, Available: ${agentModelCalls.length}\n` +
      `Current prompt hash: ${diagnostics.promptHash}\n` +
      `Current prompt: ${diagnostics.currentPromptPreview}...\n` +
      `\nAvailable recordings for ${agentId}:${modelType}:\n` +
      availableCalls
        .map(
          (c) => `  ${c.index}: hash:${c.promptHash} "${c.promptPreview}..."`
        )
        .join("\n") +
      `\n\nAll model types for ${agentId}: ${diagnostics.allModelTypes.join(", ")}\n` +
      `\n💡 Solutions:\n` +
      `  - Run with MODEL_RECORD_MODE=true to re-record\n` +
      `  - Check for race conditions in agent processing order\n` +
      `  - Verify test determinism (same inputs = same model calls)\n` +
      `  - Check if prompt content changed between recording and playback`;

    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  private async verifyCall(
    originalUseModel: Function,
    callId: string,
    agentId: string,
    modelType: string,
    options: any
  ): Promise<any> {
    // First try to get recorded response
    try {
      const recordedResponse = await this.playbackCall(
        callId,
        agentId,
        modelType,
        options
      );

      // Make new call with verification temperature
      const verifyOptions = {
        ...options,
        temperature: this.config.verifyTemperature,
      };
      const newResponse = await originalUseModel(modelType, verifyOptions);

      // Compare responses
      if (recordedResponse !== newResponse) {
        console.warn(
          `🔍 Response drift detected for ${agentId} ${callId}:\n` +
            `Recorded: ${recordedResponse.substring(0, 100)}...\n` +
            `Current:  ${newResponse.substring(0, 100)}...`
        );
      } else {
        console.log(`✅ Response verified for ${agentId} ${callId}`);
      }

      return recordedResponse; // Return recorded for consistency
    } catch (error) {
      // If no recording exists, fall back to live call
      console.warn(
        `⚠️ No recording for verification, using live call: ${error}`
      );
      return originalUseModel(modelType, options);
    }
  }
}
