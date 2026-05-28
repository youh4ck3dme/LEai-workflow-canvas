"use client";

import { Clock3, Download, History, RotateCcw, Trash2, GitCompareArrows } from "lucide-react";
import type { SourceOfTruthExport } from "@/lib/launch-studio/source-of-truth-schema";
import type { GenerationHistoryRecord } from "@/lib/launch-studio/generation-history";
import { GenerationComparePanel } from "@/components/workflow/GenerationComparePanel";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface GenerationHistoryPanelProps {
  records: GenerationHistoryRecord[];
  currentPayload: SourceOfTruthExport | null;
  selectedCompareId: string | null;
  onCompare: (id: string) => void;
  onRestore: (id: string) => void;
  onExport: (id: string) => void;
  onClear: () => void;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function auditItems(record: GenerationHistoryRecord): Array<[string, string]> {
  return [
    ["generatedAt", record.payload.generatedAt],
    ["projectId", record.payload.projectId],
    ["buildStatus", record.payload.buildStatus],
    ["sourceOfTruth", record.payload.sourceOfTruth],
    ["schemaVersion", record.payload.schemaVersion],
    ["productionWrite", String(record.payload.productionWrite)],
    ["wordpressPostId", String(record.payload.wordpressPostId)],
    ["compliance violations", String(record.payload.compliance.violations.length)],
    ["validation errors", String(record.validationErrors.length)],
  ];
}

export function GenerationHistoryPanel({
  records,
  currentPayload,
  selectedCompareId,
  onCompare,
  onRestore,
  onExport,
  onClear,
}: GenerationHistoryPanelProps) {
  const { translate } = useI18n();
  const selectedRecord = records.find((record) => record.id === selectedCompareId) ?? null;

  return (
    <section className="rounded-[1.35rem] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_70px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <History className="h-4 w-4 text-emerald-300" />
            {translate("history.title")}
          </div>
          <p className="mt-1 text-xs text-zinc-500">{translate("history.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={records.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {translate("history.clear")}
        </button>
      </div>

      {records.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 p-6 text-center text-sm text-zinc-500">
          {translate("history.empty")}
        </div>
      ) : (
        <div className="grid gap-3">
          {records.map((record) => {
            const selected = record.id === selectedCompareId;
            return (
              <article
                key={record.id}
                className={cn(
                  "rounded-[1.25rem] border bg-black/35 p-4 transition-colors",
                  selected ? "border-emerald-300/35" : "border-white/10"
                )}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-white">{record.projectName}</h3>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-400">
                        {record.projectType}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-400">
                        {record.engine}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          record.compliancePassed ? "bg-emerald-300/10 text-emerald-100" : "bg-rose-400/10 text-rose-100"
                        )}
                      >
                        {record.compliancePassed ? translate("history.compliancePassed") : translate("history.complianceFailed")}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <Clock3 className="h-3 w-3" />
                      {formatDate(record.createdAt)}
                    </div>
                    {record.prompt ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{record.prompt}</p> : null}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
                    <button
                      type="button"
                      onClick={() => onRestore(record.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {translate("history.restore")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onExport(record.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {translate("history.exportVersion")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onCompare(record.id)}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-100/40 sm:col-span-1"
                    >
                      <GitCompareArrows className="h-3.5 w-3.5" />
                      {translate("history.compare")}
                    </button>
                  </div>
                </div>

                <details open className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-zinc-300">{translate("history.audit")}</summary>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {auditItems(record).map(([label, value]) => (
                      <div key={label} className="min-w-0 rounded-xl bg-black/30 p-2">
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">{label}</dt>
                        <dd className="mt-1 truncate text-xs text-zinc-300">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <GenerationComparePanel currentPayload={currentPayload} selectedRecord={selectedRecord} />
      </div>
    </section>
  );
}
