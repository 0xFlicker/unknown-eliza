import type {
  IAgentRuntime,
  ImageDescriptionParams,
  ImageGenerationParams,
} from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import {
  getSetting,
  getBaseURL,
  getAuthHeader,
  getImageDescriptionModel,
} from "../utils/config";
import { emitModelUsageEvent } from "../utils/events";
import type { OpenAIImageDescriptionResult } from "../types";

/**
 * Cache key prefix for image descriptions.
 * 
 * WHY CACHING IS NEEDED:
 * - Discord bots and other services frequently process the same images multiple times
 *   (e.g., when messages are reposted, forwarded, or when the same attachment appears
 *   in multiple channels or conversations)
 * - Image description API calls are expensive (cost, rate limits, latency)
 * - The same image URL will always produce the same description, making it ideal for caching
 * - Cache persists across restarts using the database adapter, so descriptions survive
 *   server restarts and are shared across multiple agent instances
 */
const CACHE_KEY_PREFIX = "image_description:";

/**
 * Build a cache key for image descriptions.
 * - Includes model name to avoid stale results when model changes
 * - Data URLs: hash the content (truncated to 64 bits - acceptable collision risk for cache)
 * - HTTP URLs: use URL + optional version headers from pre-fetched HEAD response
 */
async function buildCacheKey(imageUrl: string, modelName: string, headHeaders?: Headers | null): Promise<string> {
  // Data URLs contain content directly - hash it for a content-based key
  if (imageUrl.startsWith("data:")) {
    const encoded = new TextEncoder().encode(imageUrl);

    // Try crypto.subtle first, fall back to simple hash if unavailable
    if (globalThis.crypto?.subtle) {
      try {
        const hash = await globalThis.crypto.subtle.digest("SHA-256", encoded);
        const hashHex = Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return `${CACHE_KEY_PREFIX}${modelName}:data:${hashHex.slice(0, 16)}`;
      } catch {
        // Fall through to simple hash
      }
    }

    // Fallback: simple hash for environments without crypto.subtle
    let hash = encoded.length;
    for (let i = 0; i < encoded.length; i++) {
      hash = ((hash << 5) - hash + encoded[i]) | 0;
    }
    return `${CACHE_KEY_PREFIX}${modelName}:data:${Math.abs(hash).toString(16)}-${encoded.length}`;
  }

  // HTTP URLs: include version headers if available (from consolidated HEAD request)
  if (headHeaders) {
    const etag = headHeaders.get("etag");
    const lastMod = headHeaders.get("last-modified");
    if (etag || lastMod) {
      return `${CACHE_KEY_PREFIX}${modelName}:${imageUrl}:${etag || lastMod}`;
    }
  }

  return `${CACHE_KEY_PREFIX}${modelName}:${imageUrl}`;
}

/**
 * IMAGE generation model handler
 */
export async function handleImageGeneration(
  runtime: IAgentRuntime,
  params: ImageGenerationParams,
): Promise<{ url: string }[]> {
  const n = params.count || 1;
  const size = params.size || "1024x1024";
  const prompt = params.prompt;
  const modelName = getSetting(
    runtime,
    "OPENAI_IMAGE_MODEL",
    "gpt-image-1",
  ) as string;
  logger.log(`[OpenAI] Using IMAGE model: ${modelName}`);

  const baseURL = getBaseURL(runtime);

  try {
    const response = await fetch(`${baseURL}/images/generations`, {
      method: "POST",
      headers: {
        ...getAuthHeader(runtime),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        prompt: prompt,
        n: n,
        size: size,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate image: ${response.statusText}`);
    }

    const data = await response.json();
    const typedData = data as { data: { url: string }[] };

    return typedData.data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * IMAGE_DESCRIPTION model handler
 * 
 * CACHING STRATEGY:
 * This handler implements persistent caching to optimize for Discord bots and other
 * services that frequently process the same images multiple times. Key features:
 * 
 * 1. Database-backed persistence: Cache survives server restarts and is shared across instances
 * 2. URL-based caching: Same image URL = same description, cached by URL
 * 3. Size validation: Checks image size before API call to avoid wasted requests
 * 4. Best-effort caching: Cache failures don't block requests, ensuring reliability
 * 
 * USE CASES:
 * - Discord bots processing attachments that appear in multiple channels
 * - Message forwarding/reposting where the same image URL is encountered repeatedly
 * - Image processing pipelines that analyze the same content multiple times
 * - Cost optimization: Reduces API calls for frequently-seen images
 */
export async function handleImageDescription(
  runtime: IAgentRuntime,
  params: ImageDescriptionParams | string,
): Promise<{ title: string; description: string }> {
  let imageUrl: string;
  let promptText: string | undefined;
  const modelName = getImageDescriptionModel(runtime);
  logger.log(`[OpenAI] Using IMAGE_DESCRIPTION model: ${modelName}`);
  const maxTokens = Number.parseInt(
    getSetting(runtime, "OPENAI_IMAGE_DESCRIPTION_MAX_TOKENS", "8192") ||
    "8192",
    10,
  );

  const DEFAULT_PROMPT =
    "Please analyze this image and provide a title and detailed description.";

  if (typeof params === "string") {
    imageUrl = params;
    promptText = DEFAULT_PROMPT;
  } else {
    imageUrl = params.imageUrl;
    promptText = params.prompt || DEFAULT_PROMPT;
  }

  const isCustomPrompt = typeof params === "object" &&
    Boolean(params.prompt) &&
    params.prompt !== DEFAULT_PROMPT;

  // Determine URL type and preview for logging
  const imageUrlType = imageUrl.startsWith("data:") ? "base64" : imageUrl.startsWith("http") ? "url" : "path";
  const imageUrlPreview = imageUrl.startsWith("data:")
    ? `data:... (${imageUrl.length} chars)`
    : imageUrl.length > 100
      ? `${imageUrl.substring(0, 100)}...`
      : imageUrl;

  /**
   * CONSOLIDATED HEAD REQUEST: Single request for both cache key versioning and size validation
   * 
   * For HTTP URLs, we make one HEAD request (with timeout) to:
   * 1. Get ETag/Last-Modified for content-aware cache keys
   * 2. Check Content-Length for size validation (OpenAI has ~20MB limit)
   * This avoids duplicate HEAD requests and ensures consistent timeout behavior.
   */
  let headHeaders: Headers | null = null;
  let imageSizeBytes: number | null = null;

  if (imageUrlType === "url") {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const headResponse = await fetch(imageUrl, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeoutId);
      headHeaders = headResponse.headers;

      const contentLength = headHeaders.get("content-length");
      if (contentLength) {
        imageSizeBytes = parseInt(contentLength, 10);
        // OpenAI typically has a ~20MB limit for images
        if (imageSizeBytes > 20 * 1024 * 1024) {
          const sizeMB = imageSizeBytes / (1024 * 1024);
          logger.warn({
            model: modelName,
            imageUrl: imageUrlPreview,
            imageSizeMB: sizeMB.toFixed(2),
            limitMB: 20,
          }, "[OpenAI] Image size exceeds OpenAI limit, skipping description");
          return {
            title: "Image too large",
            description: `Image size (${sizeMB.toFixed(2)}MB) exceeds OpenAI's limit (20MB). Cannot generate description.`,
          };
        }
      }
    } catch (error) {
      // HEAD failed or timed out - continue without headers (URL-only cache key, no size check)
      logger.debug({ error: error instanceof Error ? error.message : String(error) }, "[OpenAI] HEAD request failed, using URL-only cache key");
    }
  }

  /**
   * CACHE CHECK: Look up cached description before making API call
   * Uses headers from consolidated HEAD request for content-aware cache keys.
   */
  let cacheStatus: "HIT" | "MISS" | "N/A" = "N/A";
  let cacheKey: string | undefined;

  if (!isCustomPrompt) {
    cacheKey = await buildCacheKey(imageUrl, modelName, headHeaders);
    try {
      const cached = await runtime.getCache<OpenAIImageDescriptionResult>(cacheKey);
      if (cached !== undefined) {
        logger.debug({
          model: modelName,
          imageUrl: imageUrlPreview,
          cache: "HIT",
        }, "[OpenAI] Image description request (cache hit)");
        return cached;
      }
      cacheStatus = "MISS";
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, "[OpenAI] Cache read failed, proceeding with API call");
      cacheStatus = "MISS";
    }
  }

  logger.debug({
    model: modelName,
    imageUrl: imageUrlPreview,
    imageSizeMB: imageSizeBytes ? (imageSizeBytes / (1024 * 1024)).toFixed(2) : undefined,
    cache: cacheStatus,
  }, "[OpenAI] Image description request");

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];

  const baseURL = getBaseURL(runtime);

  // Determine which parameter to use based on model
  // Newer models (gpt-5, o1, o3 series) require max_completion_tokens instead of max_tokens
  const useMaxCompletionTokens = modelName.startsWith("gpt-5") ||
    modelName.startsWith("o1") ||
    modelName.startsWith("o3");

  try {
    const requestBody: Record<string, any> = {
      model: modelName,
      messages: messages,
    };

    // Use the appropriate parameter based on model requirements
    if (useMaxCompletionTokens) {
      requestBody.max_completion_tokens = maxTokens;
    } else {
      requestBody.max_tokens = maxTokens;
    }

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeader(runtime),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // Read the error response body for detailed error information
      let errorBody: any = null;
      let errorText: string = "";
      try {
        errorText = await response.text();
        try {
          errorBody = JSON.parse(errorText);
        } catch {
          // If not JSON, use the text as-is
          errorBody = { raw: errorText };
        }
      } catch (parseError) {
        logger.debug({ parseError }, "[OpenAI] Failed to parse error response");
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      logger.error({
        status: response.status,
        statusText: response.statusText,
        model: modelName,
        baseURL,
        imageUrlType,
        imageUrlPreview,
        errorBody,
        errorText: errorText.length > 500 ? errorText.substring(0, 500) + "..." : errorText,
        headers: responseHeaders,
      }, "[OpenAI] Image description API error");

      throw new Error(`OpenAI API error: ${response.status} - ${errorBody?.error?.message || errorBody?.error?.type || response.statusText || "Unknown error"}`);
    }

    const result: unknown = await response.json();

    type OpenAIResponseType = {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const typedResult = result as OpenAIResponseType;
    const content = typedResult.choices?.[0]?.message?.content;

    // Log successful result with length
    if (content) {
      logger.debug({
        model: modelName,
        contentLength: content.length,
        cache: cacheStatus,
      }, "[OpenAI] Image description completed");
    }

    if (typedResult.usage) {
      emitModelUsageEvent(
        runtime,
        ModelType.IMAGE_DESCRIPTION,
        typeof params === "string" ? params : params.prompt || "",
        {
          inputTokens: typedResult.usage.prompt_tokens,
          outputTokens: typedResult.usage.completion_tokens,
          totalTokens: typedResult.usage.total_tokens,
        },
      );
    }

    if (!content) {
      return {
        title: "Failed to analyze image",
        description: "No response from API",
      };
    }

    // Otherwise, maintain backwards compatibility with object return
    const titleMatch = content.match(/title[:\s]+(.+?)(?:\n|$)/i);
    const title = titleMatch?.[1]?.trim();
    if (!title) {
      logger.warn("Could not extract title from image description response");
    }
    const finalTitle = title || "Image Analysis";
    const description = content.replace(/title[:\s]+(.+?)(?:\n|$)/i, "").trim();

    const processedResult = { title: finalTitle, description };

    /**
     * CACHE STORAGE: Save successful description to database for future use
     * 
     * WHY CACHE AFTER API CALL:
     * - Next time the same image URL is encountered, we can return immediately
     * - Database persistence means cache survives server restarts
     * - Reduces API costs and improves response time for repeated images
     * - Especially valuable for Discord bots processing the same attachments multiple times
     */
    if (!isCustomPrompt && cacheKey) {
      try {
        await runtime.setCache(cacheKey, processedResult);
      } catch (error) {
        // If cache write fails, log but don't fail the request (caching is best-effort)
        logger.debug({
          error: error instanceof Error ? error.message : String(error),
        }, "[OpenAI] Failed to write to cache");
      }
    }

    return processedResult;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const errorDetails = {
      error: message,
      model: modelName,
      baseURL,
      imageUrlType,
      imageUrlPreview,
      stack: error instanceof Error ? error.stack : undefined,
    };
    logger.error(errorDetails, "[OpenAI] Error analyzing image");
    return {
      title: "Failed to analyze image",
      description: `Error: ${message}`,
    };
  }
}
