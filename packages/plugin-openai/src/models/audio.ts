import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import type {
  OpenAITranscriptionParams,
  OpenAITextToSpeechParams,
} from "../types";
import { getSetting, getBaseURL, getAuthHeader } from "../utils/config";
import { detectAudioMimeType } from "../utils/audio";

/**
 * Cache key prefix for transcriptions.
 * 
 * WHY CACHING IS NEEDED:
 * - Discord bots and message processors frequently encounter the same audio files
 *   (voice messages, audio clips that are reposted, forwarded, or appear in multiple channels)
 * - Transcription API calls are expensive (cost, rate limits, latency)
 * - The same audio content will always produce the same transcription, making it ideal for caching
 * - Cache persists across restarts using the database adapter, so transcriptions survive
 *   server restarts and are shared across multiple agent instances
 * - Audio files are hashed by content (not URL) to handle cases where the same audio
 *   appears at different URLs or is uploaded multiple times
 */
const CACHE_KEY_PREFIX = "transcription:";

/**
 * Generate a hash from audio blob for cache key using minimal I/O.
 * 
 * WHY HASH BY CONTENT (not URL):
 * - Same audio file may appear at different URLs (e.g., Discord CDN, re-uploads)
 * - Audio files are often uploaded multiple times with different filenames
 * - Hashing by content ensures we cache based on actual audio data, not location
 * - This maximizes cache hits even when the same audio appears in different contexts
 * 
 * OPTIMIZATION: Only reads small slices of the blob (start, middle, end) to minimize
 * memory usage for large audio files. This avoids reading the entire blob just to
 * check the cache, which would be wasteful for cache hits.
 */
async function hashAudioBlob(blob: Blob): Promise<string> {
  const sampleSize = 4000;
  const len = blob.size;

  // Read only the slices we need for hashing
  const startSlice = await blob.slice(0, Math.min(len, sampleSize)).arrayBuffer();
  const midStart = Math.max(0, Math.floor(len / 2) - sampleSize / 2);
  const midSlice = await blob.slice(midStart, Math.min(len, midStart + sampleSize)).arrayBuffer();
  const endStart = Math.max(0, len - sampleSize);
  const endSlice = await blob.slice(endStart, len).arrayBuffer();

  // Combine slices for hashing
  const combined = new Uint8Array(startSlice.byteLength + midSlice.byteLength + endSlice.byteLength + 8);
  combined.set(new Uint8Array(startSlice), 0);
  combined.set(new Uint8Array(midSlice), startSlice.byteLength);
  combined.set(new Uint8Array(endSlice), startSlice.byteLength + midSlice.byteLength);
  // Append length as 8 bytes for uniqueness
  const lenView = new DataView(combined.buffer, startSlice.byteLength + midSlice.byteLength + endSlice.byteLength, 8);
  lenView.setBigUint64(0, BigInt(len), true);

  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    try {
      const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", combined);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fall through to simple hash
    }
  }

  // Fallback: simple hash
  let hash = len;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined[i]) | 0;
  }
  return `${Math.abs(hash).toString(16)}-${len}`;
}

/**
 * Helper function for text-to-speech
 */
async function fetchTextToSpeech(
  runtime: IAgentRuntime,
  options: OpenAITextToSpeechParams,
): Promise<ArrayBuffer> {
  const defaultModel = getSetting(
    runtime,
    "OPENAI_TTS_MODEL",
    "gpt-4o-mini-tts",
  );
  const defaultVoice = getSetting(runtime, "OPENAI_TTS_VOICE", "nova");
  const defaultInstructions = getSetting(
    runtime,
    "OPENAI_TTS_INSTRUCTIONS",
    "",
  );
  const baseURL = getBaseURL(runtime);

  const model = options.model || (defaultModel as string);
  const voice = options.voice || (defaultVoice as string);
  const instructions = options.instructions ?? (defaultInstructions as string);
  const format = options.format || "mp3";

  try {
    const res = await fetch(`${baseURL}/audio/speech`, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
        "Content-Type": "application/json",
        // Hint desired audio format in Accept when possible
        ...(format === "mp3" ? { Accept: "audio/mpeg" } : {}),
      },
      body: JSON.stringify({
        model,
        voice,
        input: options.text,
        format,
        ...(instructions && { instructions }),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS error ${res.status}: ${err}`);
    }

    // Return ArrayBuffer to match core type expectations
    return await res.arrayBuffer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch speech from OpenAI TTS: ${message}`);
  }
}

/**
 * TRANSCRIPTION model handler
 * 
 * CACHING STRATEGY:
 * This handler implements persistent caching to optimize for Discord bots and other
 * services that frequently process the same audio files multiple times. Key features:
 * 
 * 1. Database-backed persistence: Cache survives server restarts and is shared across instances
 * 2. Content-based caching: Audio is hashed by content (not URL) to catch duplicates at different URLs
 * 3. Best-effort caching: Cache failures don't block requests, ensuring reliability
 * 
 * USE CASES:
 * - Discord bots processing voice messages that are reposted or forwarded
 * - Audio clips that appear in multiple channels or conversations
 * - Same audio file uploaded multiple times with different filenames/URLs
 * - Cost optimization: Reduces API calls for frequently-seen audio content
 */
export async function handleTranscription(
  runtime: IAgentRuntime,
  input: Blob | File | Buffer | OpenAITranscriptionParams,
): Promise<string> {
  let modelName = getSetting(
    runtime,
    "OPENAI_TRANSCRIPTION_MODEL",
    "gpt-4o-mini-transcribe",
  );
  logger.log(`[OpenAI] Using TRANSCRIPTION model: ${modelName}`);

  const baseURL = getBaseURL(runtime);

  // Support Blob/File/Buffer directly, or an object with { audio: Blob/File/Buffer, ...options }
  let blob: Blob;
  let extraParams: OpenAITranscriptionParams | null = null;

  if (input instanceof Blob || input instanceof File) {
    blob = input as Blob;
  } else if (Buffer.isBuffer(input)) {
    // Convert Buffer to Blob for Node.js environments
    // Auto-detect MIME type from buffer content
    const detectedMimeType = detectAudioMimeType(input);
    logger.debug(`Auto-detected audio MIME type: ${detectedMimeType}`);
    // Create a new Uint8Array from the Buffer to ensure type compatibility
    const uint8Array = new Uint8Array(input);
    blob = new Blob([uint8Array], { type: detectedMimeType });
  } else if (
    typeof input === "object" &&
    input !== null &&
    (input as any).audio != null
  ) {
    const params = input as any;
    if (
      !(params.audio instanceof Blob) &&
      !(params.audio instanceof File) &&
      !Buffer.isBuffer(params.audio)
    ) {
      throw new Error(
        "TRANSCRIPTION param 'audio' must be a Blob/File/Buffer.",
      );
    }
    // Convert Buffer to Blob if needed
    if (Buffer.isBuffer(params.audio)) {
      // Use provided mimeType or auto-detect from buffer
      let mimeType = params.mimeType;
      if (!mimeType) {
        mimeType = detectAudioMimeType(params.audio);
        logger.debug(`Auto-detected audio MIME type: ${mimeType}`);
      } else {
        logger.debug(`Using provided MIME type: ${mimeType}`);
      }
      // Create a new Uint8Array from the Buffer to ensure type compatibility
      const uint8Array = new Uint8Array(params.audio);
      blob = new Blob([uint8Array], { type: mimeType });
    } else {
      blob = params.audio as Blob;
    }
    extraParams = params as OpenAITranscriptionParams;
    if (typeof params.model === "string" && params.model) {
      modelName = params.model;
    }
  } else {
    throw new Error(
      "TRANSCRIPTION expects a Blob/File/Buffer or an object { audio: Blob/File/Buffer, mimeType?, language?, response_format?, timestampGranularities?, prompt?, temperature?, model? }",
    );
  }

  const mime = (blob as File).type || "audio/webm";
  const filename =
    (blob as File).name ||
    (mime.includes("mp3") || mime.includes("mpeg")
      ? "recording.mp3"
      : mime.includes("ogg")
        ? "recording.ogg"
        : mime.includes("wav")
          ? "recording.wav"
          : mime.includes("webm")
            ? "recording.webm"
            : "recording.bin");

  /**
   * CACHE CHECK: Look up cached transcription before making API call
   * 
   * WHY CHECK CACHE FIRST:
   * - Discord spiders and message processors often encounter the same audio files repeatedly
   * - Same audio content = same transcription, so we can skip expensive API calls
   * - Database-backed cache persists across restarts, so we benefit from previous runs
   * - We hash the audio blob content (not URL) to catch duplicates even at different URLs
   * 
   * OPTIMIZATION: hashAudioBlob only reads small slices of the blob for hashing,
   * avoiding the need to read the entire blob into memory just to check the cache.
   * The full blob is only read on cache miss when we need to send it to the API.
   */
  let cacheStatus: "HIT" | "MISS" | "N/A" = "N/A";
  let cacheKey: string | undefined = undefined;

  try {
    const audioHash = await hashAudioBlob(blob);
    // Include parameters that affect transcription output in cache key
    // Note: filter checks for null/undefined specifically to preserve temperature=0
    const paramParts = [
      modelName,
      extraParams?.language,
      extraParams?.response_format,
      extraParams?.prompt,
      extraParams?.temperature !== undefined && extraParams?.temperature !== null ? `temp:${extraParams.temperature}` : null,
      extraParams?.timestampGranularities?.join(","),
    ].filter((v) => v !== null && v !== undefined && v !== "").join("|");
    cacheKey = `${CACHE_KEY_PREFIX}${audioHash}:${paramParts || "default"}`;

    const cached = await runtime.getCache<string>(cacheKey);
    if (cached !== undefined) {
      logger.debug({
        model: modelName,
        audioSize: blob.size,
        cache: "HIT",
      }, "[OpenAI] Transcription request (cache hit)");
      return cached;
    }
    cacheStatus = "MISS";
  } catch (error) {
    // If cache read fails, continue with API call (don't fail the request)
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "[OpenAI] Cache read failed, proceeding with API call");
    cacheStatus = "MISS";
  }

  logger.debug({
    model: modelName,
    audioSize: blob.size,
    cache: cacheStatus,
  }, "[OpenAI] Transcription request");

  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("model", String(modelName));
  if (extraParams) {
    if (typeof extraParams.language === "string") {
      formData.append("language", String(extraParams.language));
    }
    if (typeof extraParams.response_format === "string") {
      formData.append("response_format", String(extraParams.response_format));
    }
    if (typeof extraParams.prompt === "string") {
      formData.append("prompt", String(extraParams.prompt));
    }
    if (typeof extraParams.temperature === "number") {
      formData.append("temperature", String(extraParams.temperature));
    }
    if (Array.isArray(extraParams.timestampGranularities)) {
      for (const g of extraParams.timestampGranularities) {
        formData.append("timestamp_granularities[]", String(g));
      }
    }
  }

  try {
    const response = await fetch(`${baseURL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to transcribe audio: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { text: string };
    const transcription = data.text || "";

    /**
     * CACHE STORAGE: Save successful transcription to database for future use
     * 
     * WHY CACHE AFTER API CALL:
     * - Next time the same audio content is encountered (even at different URL), we can return immediately
     * - Database persistence means cache survives server restarts
     * - Reduces API costs and improves response time for repeated audio files
     * - Especially valuable for Discord bots processing the same voice messages/audio clips multiple times
     */
    if (cacheStatus === "MISS" && cacheKey) {
      try {
        await runtime.setCache(cacheKey, transcription);
      } catch (error) {
        // If cache write fails, log but don't fail the request (caching is best-effort)
        logger.debug({
          error: error instanceof Error ? error.message : String(error),
        }, "[OpenAI] Failed to write transcription to cache");
      }
    }

    logger.debug({
      model: modelName,
      transcriptionLength: transcription.length,
      cache: cacheStatus,
    }, "[OpenAI] Transcription completed");

    return transcription;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`TRANSCRIPTION error: ${message}`);
    throw error;
  }
}

/**
 * TEXT_TO_SPEECH model handler
 */
export async function handleTextToSpeech(
  runtime: IAgentRuntime,
  input: string | OpenAITextToSpeechParams,
): Promise<ArrayBuffer> {
  // Normalize input into options with per-call overrides
  const options: OpenAITextToSpeechParams =
    typeof input === "string"
      ? { text: input }
      : (input as OpenAITextToSpeechParams);

  const resolvedModel =
    options.model ||
    (getSetting(runtime, "OPENAI_TTS_MODEL", "gpt-4o-mini-tts") as string);
  logger.log(`[OpenAI] Using TEXT_TO_SPEECH model: ${resolvedModel}`);
  try {
    return await fetchTextToSpeech(runtime, options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error in TEXT_TO_SPEECH: ${message}`);
    throw error;
  }
}
