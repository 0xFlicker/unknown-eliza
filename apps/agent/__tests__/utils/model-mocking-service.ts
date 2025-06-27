import { vi } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { IAgentRuntime } from "@elizaos/core";

/**
 * Represents a single model call recording
 */
export interface ModelCallRecord {
  id: string;
  agentId: string;
  modelType: string;
  prompt: string;
  options: Record<string, any>;
  response: string;
  timestamp: string;
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
  private currentTest?: { suiteName: string; testName: string };

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
    if (this.config.mode === 'record') {
      const recordingKey = this.getRecordingKey(suiteName, testName);
      this.recordings.set(recordingKey, []);
      console.log(`🧹 Cleared existing recordings for clean re-recording: ${testName}`);
    }
    
    // Always clear counters for fresh test run
    this.callCounters.clear();
    this.playbackCounters.clear();
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
      console.log(`🧹 Removed ${records.length - sortedRecords.length} duplicate recordings`);
    }
  }

  /**
   * Remove duplicate recordings, keeping the latest based on timestamp
   */
  private deduplicateRecordings(records: ModelCallRecord[]): ModelCallRecord[] {
    const recordMap = new Map<string, ModelCallRecord>();
    
    for (const record of records) {
      const existing = recordMap.get(record.id);
      if (!existing || new Date(record.timestamp) > new Date(existing.timestamp)) {
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
        const cleanedRecordings = this.migrateAndCleanRecordings(recordingFile.recordings, recordingFile.metadata?.version);
        
        this.recordings.set(recordingKey, cleanedRecordings);
        console.log(
          `📼 Loaded ${cleanedRecordings.length} model call recordings from ${filePath} (version: ${recordingFile.metadata?.version || 'legacy'})`
        );
        
        if (cleanedRecordings.length !== recordingFile.recordings.length) {
          console.log(`🧹 Cleaned ${recordingFile.recordings.length - cleanedRecordings.length} problematic recordings during load`);
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
  private migrateAndCleanRecordings(recordings: ModelCallRecord[], version?: string): ModelCallRecord[] {
    let migratedRecordings = [...recordings];
    
    // For legacy recordings (pre-2.0.0), clean up duplicates and fix IDs
    if (!version || version < "2.0.0") {
      console.log("🔄 Migrating recordings from legacy format...");
      
      // Deduplicate by ID, keeping the latest
      migratedRecordings = this.deduplicateRecordings(migratedRecordings);
      
      // Fix any malformed response data (arrays stored as raw instead of JSON strings)
      migratedRecordings = migratedRecordings.map(record => {
        if (Array.isArray(record.response)) {
          console.warn(`🔧 Converting array response to JSON string for ${record.id}`);
          return {
            ...record,
            response: JSON.stringify(record.response)
          };
        }
        return record;
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
    } else if (Array.isArray(response)) {
      // This is likely an embedding - convert to JSON string for recording
      recordedResponse = JSON.stringify(response);
      console.warn(
        `🚨 Recording non-string response for ${modelType}:${callId}. This might indicate a model type mismatch.`
      );
    } else {
      // Handle other response types
      recordedResponse = JSON.stringify(response);
      console.warn(
        `🚨 Recording non-string response for ${modelType}:${callId}. Response type: ${typeof response}`
      );
    }

    const record: ModelCallRecord = {
      id: callId,
      agentId,
      modelType,
      prompt: options.prompt || options.text || "",
      options: { ...options },
      response: recordedResponse,
      timestamp: new Date().toISOString(),
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
      `🎬 Recorded model call ${callId} for ${agentId} (${modelType})`
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

    // Find matching record by agent, model type, and call order
    const agentModelCalls = records.filter((r) => r.agentId === agentId && r.modelType === modelType);
    const playbackKey = `${agentId}-${modelType}`;
    
    // Use separate counter for playback to avoid conflicts with generateCallId
    const callIndex = this.playbackCounters.get(playbackKey) || 0;
    
    // console.log(`🔍 Playback lookup: ${agentId}:${modelType} call ${callIndex + 1}, found ${agentModelCalls.length} recorded calls`);

    if (callIndex >= agentModelCalls.length) {
      const errorMessage = `No recorded response for ${agentId}:${modelType} call ${callIndex + 1}. ` +
        `Only ${agentModelCalls.length} calls recorded for this model type. ` +
        `Run tests with MODEL_RECORD_MODE=true to record missing responses.`;
      
      console.error(`❌ ${errorMessage}`);
      throw new Error(errorMessage);
    }

    const record = agentModelCalls[callIndex];
    
    // Update the playback counter for this specific agent-model combination AFTER getting the record
    this.playbackCounters.set(playbackKey, callIndex + 1);
    console.log(
      `▶️ Playing back model call ${record.id} for ${agentId} (${modelType})`
    );

    // Parse response appropriately based on what was recorded
    let response = record.response;

    // If the response looks like JSON (starts with [ or {), try to parse it
    if (
      typeof response === "string" &&
      (response.startsWith("[") || response.startsWith("{"))
    ) {
      try {
        const parsed = JSON.parse(response);
        // For embedding models, we expect arrays
        if (modelType === "TEXT_EMBEDDING" && Array.isArray(parsed)) {
          response = parsed;
        } else if (
          modelType.startsWith("TEXT_") &&
          !modelType.includes("EMBEDDING") &&
          Array.isArray(parsed)
        ) {
          // This is a text model but we recorded an array - this is the bug!
          console.warn(
            `🚨 Found array response for text model ${modelType}. Converting to string.`
          );
          response = JSON.stringify(parsed); // Keep as string for text models
        } else {
          response = parsed;
        }
      } catch (e) {
        // If parsing fails, keep original string
        console.debug(
          `Could not parse recorded response as JSON for ${modelType}:${callId}`
        );
      }
    }

    return response;
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
