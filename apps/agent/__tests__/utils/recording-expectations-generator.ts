import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Utility to help generate updated test expectations based on recordings
 */
export class RecordingExpectationsGenerator {
  private recordingsDir: string;
  
  constructor(recordingsDir: string = "./recordings") {
    this.recordingsDir = recordingsDir;
  }

  /**
   * Generate expectation updates based on recorded model responses
   */
  generateExpectationUpdates(testSuite: string, testName: string): string[] {
    const recordingPath = this.getRecordingPath(testSuite, testName);
    
    if (!existsSync(recordingPath)) {
      return [`No recording found for ${testSuite}::${testName}`];
    }

    try {
      const recording = JSON.parse(readFileSync(recordingPath, 'utf-8'));
      const suggestions: string[] = [];
      
      suggestions.push(`// Expectations for ${testName}`);
      suggestions.push(`// Based on recording: ${recordingPath}`);
      suggestions.push('');

      recording.recordings.forEach((call: any, index: number) => {
        const responseText = this.extractResponseText(call.response);
        suggestions.push(`// Call ${index + 1}: ${call.agentId} - ${call.modelType}`);
        suggestions.push(`// Prompt: ${call.prompt}`);
        suggestions.push(`expect(response${index + 1}).toContain("${this.escapeString(responseText.substring(0, 50))}");`);
        suggestions.push('');
      });

      return suggestions;
    } catch (error) {
      return [`Error reading recording: ${error}`];
    }
  }

  /**
   * Generate a test expectations file based on all recordings
   */
  generateExpectationsFile(outputPath: string = "./test-expectations.ts"): void {
    const recordings = this.getAllRecordings();
    let content = `// Auto-generated test expectations based on recordings
// Run this generator after recording to update test expectations

export const TEST_EXPECTATIONS = {
`;

    recordings.forEach(({ testSuite, testName, filePath }) => {
      const key = this.sanitizeKey(`${testSuite}_${testName}`);
      content += `  ${key}: {\n`;
      
      try {
        const recording = JSON.parse(readFileSync(filePath, 'utf-8'));
        recording.recordings.forEach((call: any, index: number) => {
          const responseText = this.extractResponseText(call.response);
          content += `    call${index + 1}: "${this.escapeString(responseText)}",\n`;
        });
      } catch (error) {
        content += `    error: "Failed to read recording: ${error}",\n`;
      }
      
      content += `  },\n`;
    });

    content += `};

// Usage example:
// import { TEST_EXPECTATIONS } from './test-expectations';
// expect(response).toContain(TEST_EXPECTATIONS.AgentServer_integration_demonstrates_model_mocking.call1);
`;

    writeFileSync(outputPath, content);
    console.log(`📝 Generated expectations file: ${outputPath}`);
  }

  /**
   * Compare current test results with recordings to detect drift
   */
  detectResponseDrift(testSuite: string, testName: string, actualResponses: string[]): string[] {
    const recordingPath = this.getRecordingPath(testSuite, testName);
    
    if (!existsSync(recordingPath)) {
      return [`No recording found to compare against for ${testSuite}::${testName}`];
    }

    try {
      const recording = JSON.parse(readFileSync(recordingPath, 'utf-8'));
      const driftReport: string[] = [];
      
      recording.recordings.forEach((call: any, index: number) => {
        if (index < actualResponses.length) {
          const recordedResponse = this.extractResponseText(call.response);
          const actualResponse = actualResponses[index];
          
          if (recordedResponse !== actualResponse) {
            driftReport.push(`📊 Response drift detected for call ${index + 1}:`);
            driftReport.push(`   Recorded: ${recordedResponse.substring(0, 100)}...`);
            driftReport.push(`   Actual:   ${actualResponse.substring(0, 100)}...`);
            driftReport.push('');
          }
        }
      });

      if (driftReport.length === 0) {
        driftReport.push(`✅ No response drift detected for ${testName}`);
      }

      return driftReport;
    } catch (error) {
      return [`Error comparing responses: ${error}`];
    }
  }

  /**
   * Get recording file path for a test
   */
  private getRecordingPath(testSuite: string, testName: string): string {
    const sanitizedSuite = testSuite.replace(/[^a-zA-Z0-9-_]/g, '_');
    const sanitizedTest = testName.replace(/[^a-zA-Z0-9-_]/g, '_');
    return join(this.recordingsDir, `${sanitizedSuite}__${sanitizedTest}.json`);
  }

  /**
   * Get all recording files
   */
  private getAllRecordings(): Array<{ testSuite: string; testName: string; filePath: string }> {
    if (!existsSync(this.recordingsDir)) {
      return [];
    }

    const fs = require('fs');
    const files = fs.readdirSync(this.recordingsDir).filter((f: string) => f.endsWith('.json'));
    
    return files.map((file: string) => {
      const [testSuite, testName] = file.replace('.json', '').split('__');
      return {
        testSuite: testSuite.replace(/_/g, ' '),
        testName: testName.replace(/_/g, ' '),
        filePath: join(this.recordingsDir, file)
      };
    });
  }

  /**
   * Extract text from model response (handle both string and JSON responses)
   */
  private extractResponseText(response: any): string {
    if (typeof response === 'string') {
      try {
        const parsed = JSON.parse(response);
        return parsed.text || response;
      } catch {
        return response;
      }
    }
    return response.text || JSON.stringify(response);
  }

  /**
   * Escape string for use in generated code
   */
  private escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Sanitize key for use in JavaScript object
   */
  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}