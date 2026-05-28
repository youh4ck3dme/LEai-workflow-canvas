import { generateText } from "ai";
import { createMistral } from "@ai-sdk/mistral";
import { LE_STUDIO_LAUNCH_ARCHITECT_SYSTEM_PROMPT } from "@/lib/launch-studio/launch-architect-prompt";
import { createRequestId } from "@/lib/api/request-id";
import { jsonWithRequestId, normalizedError } from "@/lib/api/errors";
import {
  readJsonWithSizeLimit,
  resolveClientIp,
  verifyPilotToken,
} from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { logApiRequest } from "@/lib/api/logging";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 20;

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const ip = resolveClientIp(request.headers);
  let status = 200;
  let tokenIdentity = "unknown";
  let bodyBytes: number | undefined;

  const maxBodyBytes = readPositiveIntEnv("LE_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES);
  const rateLimitWindowMs = readPositiveIntEnv("LE_RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS);
  const rateLimitMax = readPositiveIntEnv("LE_RATE_LIMIT_MAX", DEFAULT_RATE_LIMIT_MAX);

  try {
    const auth = verifyPilotToken(request.headers);
    if (!auth.ok) {
      status = auth.status;
      return normalizedError(auth.status, auth.errorCode, auth.message, requestId);
    }
    tokenIdentity = auth.tokenIdentity;

    const rate = checkRateLimit({
      key: `ai-generate:${tokenIdentity}:${ip}`,
      limit: rateLimitMax,
      windowMs: rateLimitWindowMs,
    });
    if (!rate.allowed) {
      status = 429;
      return normalizedError(429, "rate_limit_exceeded", "Too many requests.", requestId);
    }

    const parsed = await readJsonWithSizeLimit<{
      provider?: string;
      model?: string;
      prompt?: string;
      systemPrompt?: string;
      temperature?: number;
      purpose?: string;
    }>(request, maxBodyBytes);
    if (!parsed.ok) {
      status = parsed.status;
      return normalizedError(parsed.status, parsed.errorCode, parsed.message, requestId);
    }

    bodyBytes = parsed.bodyBytes;
    const { provider, model, prompt, systemPrompt, temperature, purpose } = parsed.body;
    const resolvedSystemPrompt =
      purpose === "launch-architect" ? LE_STUDIO_LAUNCH_ARCHITECT_SYSTEM_PROMPT : systemPrompt || undefined;

    if (!prompt) {
      status = 400;
      return normalizedError(400, "prompt_missing", "Prompt is required", requestId);
    }

    // Map provider to model string for AI Gateway
    const modelMap: Record<string, string> = {
      openai: `openai/${model || "gpt-4o"}`,
      google: `google/${model || "gemini-2.0-flash"}`,
      xai: `xai/${model || "grok-3"}`,
    };

    if (provider === "mistral") {
      const keys = [process.env.MISTRAL_API_KEY, process.env.MISTRAL_API_KEY_BACKUP].filter(Boolean) as string[];
      if (keys.length === 0) {
        if (purpose === "launch-architect") {
          status = 200;
          return jsonWithRequestId(
            { text: "", unavailable: true, error: "Mistral API key is not configured", requestId },
            200,
            requestId
          );
        }
        status = 500;
        return normalizedError(500, "mistral_key_not_configured", "Mistral API key is not configured", requestId);
      }

      let lastError: unknown = null;
      for (const apiKey of keys) {
        try {
          const mistral = createMistral({ apiKey });
          const { text } = await generateText({
            model: mistral(model || "mistral-small"),
            prompt,
            system: resolvedSystemPrompt,
            temperature: temperature ?? 0.7,
          });
          status = 200;
          return jsonWithRequestId({ text }, 200, requestId);
        } catch (error) {
          lastError = error;
        }
      }

      if (purpose === "launch-architect") {
        status = 200;
        return jsonWithRequestId(
          {
            text: "",
            unavailable: true,
            error: lastError instanceof Error ? lastError.message : "Mistral request failed",
            requestId,
          },
          200,
          requestId
        );
      }

      throw lastError ?? new Error("Mistral request failed");
    }

    const { text } = await generateText({
      model: modelMap[provider] || "openai/gpt-4o",
      prompt,
      system: resolvedSystemPrompt,
      temperature: temperature ?? 0.7,
    });

    status = 200;
    return jsonWithRequestId({ text }, 200, requestId);
  } catch {
    status = 500;
    return normalizedError(500, "ai_generation_failed", "Generation failed", requestId);
  } finally {
    logApiRequest({
      route: "/api/ai/generate",
      method: request.method,
      requestId,
      durationMs: Date.now() - startedAt,
      status,
      tokenIdentity,
      ip,
      bodyBytes,
    });
  }
}
