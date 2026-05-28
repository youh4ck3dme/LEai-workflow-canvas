import type { LaunchBriefInput } from "@/types/workflow";
import { resolveLocaleFromHeaders } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import { generateSourceOfTruthPayload } from "@/lib/launch-studio/generate-source-of-truth-payload";
import { validateSourceOfTruthExport } from "@/lib/launch-studio/validation";
import { validateLiveBrief } from "@/lib/launch-studio/brief-validation";
import { isLiveMode } from "@/lib/launch-studio/mode";
import { createRequestId } from "@/lib/api/request-id";
import { jsonWithRequestId, normalizedError } from "@/lib/api/errors";
import {
  readJsonWithSizeLimit,
  resolveClientIp,
  verifyPilotToken,
} from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { logApiRequest } from "@/lib/api/logging";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const ip = resolveClientIp(request.headers);
  let status = 200;
  let tokenIdentity = "unknown";
  let bodyBytes: number | undefined;
  const locale = resolveLocaleFromHeaders(request.headers);

  try {
    const auth = verifyPilotToken(request.headers);
    if (!auth.ok) {
      status = auth.status;
      return normalizedError(auth.status, auth.errorCode, auth.message, requestId);
    }
    tokenIdentity = auth.tokenIdentity;

    const rate = checkRateLimit({
      key: `projects-generate:${tokenIdentity}:${ip}`,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.allowed) {
      status = 429;
      return normalizedError(429, "rate_limit_exceeded", "Too many requests.", requestId);
    }

    const parsed = await readJsonWithSizeLimit<{ brief?: LaunchBriefInput }>(
      request,
      MAX_BODY_BYTES
    );
    if (!parsed.ok) {
      status = parsed.status;
      return normalizedError(parsed.status, parsed.errorCode, parsed.message, requestId);
    }
    bodyBytes = parsed.bodyBytes;
    const body = parsed.body;
    const brief = body?.brief as LaunchBriefInput | undefined;

    if (!brief) {
      status = 400;
      return normalizedError(400, "brief_missing", t(locale, "api.briefRequired"), requestId);
    }

    const briefErrors = validateLiveBrief(brief);
    if (briefErrors.length > 0) {
      status = 422;
      return jsonWithRequestId(
        {
          errorCode: "brief_validation_failed",
          message: "Live mode requires complete real project inputs.",
          status: 422,
          details: briefErrors,
          mode: isLiveMode() ? "live" : "dry-run",
        },
        422,
        requestId
      );
    }

    const project = generateSourceOfTruthPayload({
      projectType: brief.projectType,
      projectName: brief.projectName,
      targetAudience: brief.targetAudience,
      goal: brief.goal,
      description: brief.description,
      preferredTone: brief.preferredTone,
      contactEmail: brief.contactEmail ?? "",
      targetAmount: brief.targetAmount ?? null,
    });

    const validation = validateSourceOfTruthExport(project);

    status = 200;
    return jsonWithRequestId({
      dryRun: false,
      mode: "live",
      project,
      compliance: project.compliance,
      validation,
      canExport: validation.valid,
      canImport: validation.valid,
    }, 200, requestId);
  } catch {
    status = 500;
    return normalizedError(500, "project_generate_failed", t(locale, "api.projectGenerationFailed"), requestId);
  } finally {
    logApiRequest({
      route: "/api/projects/generate",
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
