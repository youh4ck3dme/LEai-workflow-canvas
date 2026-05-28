import { addWorkflowRunAudit, getWorkflow } from "@/lib/workflow/store";
import { executeWorkflow } from "@/lib/workflow/runner";
import type { LaunchBriefInput, WorkflowDefinition } from "@/types/workflow";
import { resolveLocaleFromHeaders } from "@/lib/i18n/server";
import { t } from "@/lib/i18n";
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

function buildWorkflowFromBody(body: unknown, id: string): WorkflowDefinition | null {
  const payload = body as { workflow?: Partial<WorkflowDefinition> } | null;
  const w = payload?.workflow;
  if (!w || !Array.isArray(w.nodes) || !Array.isArray(w.edges)) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: String(w.id ?? id),
    name: String(w.name ?? "Web do 24h Generator"),
    dryRun: false,
    nodes: w.nodes as WorkflowDefinition["nodes"],
    edges: w.edges as WorkflowDefinition["edges"],
    createdAt: String(w.createdAt ?? now),
    updatedAt: now,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const ip = resolveClientIp(request.headers);
  let status = 200;
  let tokenIdentity = "unknown";
  let bodyBytes: number | undefined;
  const locale = resolveLocaleFromHeaders(request.headers);

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

    const { id } = await params;
    const rate = checkRateLimit({
      key: `workflow-run:${id}:${tokenIdentity}:${ip}`,
      limit: rateLimitMax,
      windowMs: rateLimitWindowMs,
    });
    if (!rate.allowed) {
      status = 429;
      return normalizedError(429, "rate_limit_exceeded", "Too many requests.", requestId);
    }

    const parsed = await readJsonWithSizeLimit<{ brief?: LaunchBriefInput; workflow?: Partial<WorkflowDefinition> }>(
      request,
      maxBodyBytes
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

    const workflow = getWorkflow(id) ?? buildWorkflowFromBody(body, id);
    if (!workflow) {
      status = 404;
      return normalizedError(404, "workflow_not_found", t(locale, "api.workflowNotFound"), requestId);
    }

    const run = executeWorkflow(workflow, brief, locale);
    addWorkflowRunAudit(workflow.id, {
      mode: "live",
      compliancePassed: run.compliancePassed,
      canExport: run.canExport,
      canImport: run.canImport,
      violations: run.violations,
    });
    status = 200;
    return jsonWithRequestId(run, 200, requestId);
  } catch {
    status = 500;
    return normalizedError(500, "workflow_run_failed", t(locale, "api.workflowExecutionFailed"), requestId);
  } finally {
    logApiRequest({
      route: "/api/workflows/[id]/run",
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
