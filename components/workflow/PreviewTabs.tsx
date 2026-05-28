"use client";

import { FileJson, History, LayoutTemplate, PanelsTopLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

export type PreviewTab = "visual" | "json" | "payload" | "history";

interface PreviewTabsProps {
  activeTab: PreviewTab;
  onChange: (tab: PreviewTab) => void;
}

const TAB_CONFIG = [
  { id: "visual", label: "preview.visual", icon: LayoutTemplate },
  { id: "json", label: "preview.json", icon: FileJson },
  { id: "payload", label: "preview.payload", icon: PanelsTopLeft },
  { id: "history", label: "history.title", icon: History },
] as const;

export function PreviewTabs({ activeTab, onChange }: PreviewTabsProps) {
  const { translate } = useI18n();

  return (
    <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-black/35 p-1" role="tablist" aria-label={translate("preview.tabsLabel")}>
      {TAB_CONFIG.map((item) => {
        const Icon = item.icon;
        const selected = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`preview-panel-${item.id}`}
            id={`preview-tab-${item.id}`}
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 sm:flex-none",
              selected ? "bg-white text-black" : "text-zinc-400 hover:bg-white/5 hover:text-white"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {translate(item.label)}
          </button>
        );
      })}
    </div>
  );
}
