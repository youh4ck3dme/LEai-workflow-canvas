"use client";

import { ArrowRightLeft } from "lucide-react";
import type { SourceOfTruthExport } from "@/lib/launch-studio/source-of-truth-schema";
import type { GenerationHistoryRecord } from "@/lib/launch-studio/generation-history";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface GenerationComparePanelProps {
  currentPayload: SourceOfTruthExport | null;
  selectedRecord: GenerationHistoryRecord | null;
}

type CompareRow = {
  label: string;
  current: string;
  selected: string;
};

function asText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function buildRows(current: SourceOfTruthExport, selected: SourceOfTruthExport): CompareRow[] {
  return [
    {
      label: "wordpress.main.title",
      current: asText(current.wordpress.main.title),
      selected: asText(selected.wordpress.main.title),
    },
    {
      label: "wordpress.main.tagline",
      current: asText(current.wordpress.main.tagline),
      selected: asText(selected.wordpress.main.tagline),
    },
    {
      label: "wordpress.main.context",
      current: asText(current.wordpress.main.context),
      selected: asText(selected.wordpress.main.context),
    },
    {
      label: "seo.title",
      current: asText(current.seo.title),
      selected: asText(selected.seo.title),
    },
    {
      label: "seo.description",
      current: asText(current.seo.description),
      selected: asText(selected.seo.description),
    },
    {
      label: "faq count",
      current: asText(current.faq.length),
      selected: asText(selected.faq.length),
    },
    {
      label: "services count",
      current: asText(current.wordpress.services.length),
      selected: asText(selected.wordpress.services.length),
    },
    {
      label: "compliance status",
      current: current.compliance.passed ? "passed" : "failed",
      selected: selected.compliance.passed ? "passed" : "failed",
    },
  ];
}

export function GenerationComparePanel({ currentPayload, selectedRecord }: GenerationComparePanelProps) {
  const { translate } = useI18n();

  if (!selectedRecord) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-zinc-500">
        {translate("history.compareEmpty")}
      </div>
    );
  }

  if (!currentPayload) {
    return (
      <div className="rounded-2xl border border-amber-300/20 bg-amber-950/20 p-4 text-xs text-amber-100/80">
        {translate("history.compareNeedsCurrent")}
      </div>
    );
  }

  const rows = buildRows(currentPayload, selectedRecord.payload);

  return (
    <section className="rounded-[1.25rem] border border-white/10 bg-black/30 p-4" aria-label={translate("history.compareTitle")}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <ArrowRightLeft className="h-4 w-4 text-emerald-300" />
        {translate("history.compareTitle")}
      </div>
      <div className="grid gap-2">
        {rows.map((row) => {
          const changed = row.current !== row.selected;
          return (
            <article key={row.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{row.label}</div>
                <div
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                    changed ? "bg-amber-300/12 text-amber-100" : "bg-emerald-300/10 text-emerald-100"
                  )}
                >
                  {changed ? translate("history.changed") : translate("history.same")}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-black/35 p-2">
                  <div className="mb-1 text-[10px] text-zinc-500">{translate("history.currentVersion")}</div>
                  <p className="line-clamp-3 text-xs leading-5 text-zinc-300">{row.current}</p>
                </div>
                <div className="rounded-xl bg-black/35 p-2">
                  <div className="mb-1 text-[10px] text-zinc-500">{translate("history.selectedVersion")}</div>
                  <p className="line-clamp-3 text-xs leading-5 text-zinc-300">{row.selected}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
