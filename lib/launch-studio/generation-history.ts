import { randomId } from "@/lib/random-id";
import type { ProjectType } from "@/types/workflow";
import type { SourceOfTruthExport } from "@/lib/launch-studio/source-of-truth-schema";
import { validateSourceOfTruthExport } from "@/lib/launch-studio/validation";

export type GenerationHistoryEngine = "local" | "architect";

export type GenerationHistoryRecord = {
  id: string;
  createdAt: string;
  projectName: string;
  projectType: ProjectType;
  engine: GenerationHistoryEngine;
  prompt: string;
  compliancePassed: boolean;
  validationPassed: boolean;
  validationErrors: string[];
  payload: SourceOfTruthExport;
};

export type GenerationHistoryContext = {
  engine: GenerationHistoryEngine;
  prompt: string;
};

export const GENERATION_HISTORY_STORAGE_KEY = "le-studio:generation-history:v1";
export const GENERATION_HISTORY_LIMIT = 10;

const SECRET_PATTERNS = [
  /\b(api[_-]?key|token|secret|password|heslo)\s*[:=]\s*[^\s,;]+/gi,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(ag_[A-Za-z0-9_-]{12,})\b/g,
  /\b([A-Za-z0-9_-]{28,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
];

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeHistoryText(value: unknown): string {
  if (typeof value !== "string") return "";
  let cleaned = value.replace(/\s+/g, " ").trim().slice(0, 1200);
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[redacted]");
  }
  return cleaned;
}

function normalizeEngine(value: unknown): GenerationHistoryEngine {
  return value === "architect" ? "architect" : "local";
}

function normalizeRecord(value: unknown): GenerationHistoryRecord | null {
  if (!isRecord(value)) return null;
  const payload = value.payload;
  const gate = validateSourceOfTruthExport(payload);
  if (!gate.valid) return null;

  const typedPayload = payload as SourceOfTruthExport;
  const createdAt = typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : typedPayload.generatedAt;
  const id = typeof value.id === "string" && value.id.trim() ? value.id : randomId("generation");
  const validationErrors = Array.isArray(value.validationErrors)
    ? value.validationErrors.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id,
    createdAt,
    projectName: typedPayload.project.name,
    projectType: typedPayload.project.type,
    engine: normalizeEngine(value.engine),
    prompt: sanitizeHistoryText(value.prompt),
    compliancePassed: typedPayload.compliance.passed === true,
    validationPassed: gate.valid,
    validationErrors,
    payload: typedPayload,
  };
}

export function loadGenerationHistory(): GenerationHistoryRecord[] {
  if (!hasStorage()) return [];

  try {
    const raw = window.localStorage.getItem(GENERATION_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeRecord)
      .filter((record): record is GenerationHistoryRecord => Boolean(record))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, GENERATION_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function createGenerationHistoryRecord(
  payload: SourceOfTruthExport,
  context: GenerationHistoryContext
): GenerationHistoryRecord | null {
  const gate = validateSourceOfTruthExport(payload);
  if (!gate.valid) return null;

  return {
    id: randomId("generation"),
    createdAt: new Date().toISOString(),
    projectName: payload.project.name,
    projectType: payload.project.type,
    engine: context.engine,
    prompt: sanitizeHistoryText(context.prompt),
    compliancePassed: payload.compliance.passed === true,
    validationPassed: gate.valid,
    validationErrors: gate.errors,
    payload,
  };
}

export function saveGenerationToHistory(record: GenerationHistoryRecord): GenerationHistoryRecord[] {
  if (!hasStorage()) return [];

  const existing = loadGenerationHistory();
  const next = [record, ...existing.filter((item) => item.id !== record.id)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, GENERATION_HISTORY_LIMIT);

  try {
    window.localStorage.setItem(GENERATION_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return existing;
  }

  return next;
}

export function restoreGenerationRecord(id: string): GenerationHistoryRecord | null {
  return loadGenerationHistory().find((record) => record.id === id) ?? null;
}

export function clearGenerationHistory(): void {
  if (!hasStorage()) return;

  try {
    window.localStorage.removeItem(GENERATION_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage failures. History is an optional browser-local feature.
  }
}
