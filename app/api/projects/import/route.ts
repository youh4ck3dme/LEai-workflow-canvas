import { resolveLocaleFromHeaders } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
import { SourceOfTruthExportSchema } from "@/lib/launch-studio/source-of-truth-schema";
import { validateSourceOfTruthExport } from "@/lib/launch-studio/validation";
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
      key: `projects-import:${tokenIdentity}:${ip}`,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.allowed) {
      status = 429;
      return normalizedError(429, "rate_limit_exceeded", "Too many requests.", requestId);
    }

    const parsedBody = await readJsonWithSizeLimit<{
      compliancePassed?: boolean;
      project?: unknown;
    }>(request, MAX_BODY_BYTES);
    if (!parsedBody.ok) {
      status = parsedBody.status;
      return normalizedError(parsedBody.status, parsedBody.errorCode, parsedBody.message, requestId);
    }
    bodyBytes = parsedBody.bodyBytes;
    const body = parsedBody.body;
    const compliancePassedFromClient = Boolean(body?.compliancePassed);
    const parsed = SourceOfTruthExportSchema.safeParse(body?.project);

    if (!parsed.success) {
      status = 422;
      return normalizedError(422, "project_schema_invalid", t(locale, "api.projectInvalid"), requestId);
    }

    const validation = validateSourceOfTruthExport(parsed.data);
    const compliancePassed = compliancePassedFromClient && parsed.data.compliance.passed;

    if (!compliancePassed || !validation.valid) {
      status = 200;
      return jsonWithRequestId({
        dryRun: false,
        mode: isLiveMode() ? "live" : "dry-run",
        imported: false,
        canImport: false,
        compliance: parsed.data.compliance,
        validation,
        payloadPreview: parsed.data.wordpress,
        message: !validation.valid ? `Import blocked because validation failed: ${validation.errors.join(", ")}` : t(locale, "api.importBlockedCompliance"),
      }, 200, requestId);
    }

    status = 200;
    return jsonWithRequestId({
      dryRun: false,
      mode: isLiveMode() ? "live" : "dry-run",
      imported: false,
      canImport: true,
      compliance: parsed.data.compliance,
      validation,
      payloadPreview: parsed.data.wordpress,
      message: "Live execution complete. Export payload is ready for review. WordPress write remains server-guarded.",
    }, 200, requestId);
  } catch {
    status = 500;
    return normalizedError(500, "project_import_failed", t(locale, "api.projectImportFailed"), requestId);
  } finally {
    logApiRequest({
      route: "/api/projects/import",
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
