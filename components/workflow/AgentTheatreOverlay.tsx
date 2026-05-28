"use client";

import { useEffect, useState } from "react";
import type { TimelineEvent, WorkflowEdge, WorkflowNode } from "@/types/workflow";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

interface AgentTheatreOverlayProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  timeline: TimelineEvent[];
  isRunning: boolean;
  validationErrors: string[];
  generated: unknown;
  hasFreshGeneration: boolean;
  canExport: boolean;
  onShowPreview: () => void;
  onExport: () => void;
}

const STAGE_AGENT_IDS = ["strategy-agent", "copy-agent", "seo-agent", "wordpress-adapter", "qa-audit", "launch-pack"];

const CAPTIONS = {
  idle: "Napíš jednu vetu. Agenti čakajú na brief.",
  running: "Agenti skladajú stratégiu, copy, SEO a WordPress payload.",
  done: "Payload je pripravený na kontrolu a export.",
  fresh: "Výstup je pripravený. Skontroluj JSON alebo exportuj balík.",
  error: "Workflow zastavený validáciou.",
};

export function AgentTheatreOverlay({
  nodes,
  edges,
  timeline,
  isRunning,
  validationErrors,
  generated,
  hasFreshGeneration,
  canExport,
  onShowPreview,
  onExport,
}: AgentTheatreOverlayProps) {
  const { translate } = useI18n();
  const [stageLingerRunning, setStageLingerRunning] = useState(false);

  useEffect(() => {
    if (isRunning) {
      setStageLingerRunning(true);
      return;
    }
    const timeout = window.setTimeout(() => setStageLingerRunning(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [isRunning]);

  const hasError = validationErrors.length > 0 || nodes.some((node) => node.data.status === "failed");
  const isDone = Boolean(generated) && !hasError;
  const stageState = hasError ? "error" : hasFreshGeneration || isDone ? "done" : isRunning || stageLingerRunning ? "running" : "idle";
  const stageCaption = stageState === "done" && hasFreshGeneration ? CAPTIONS.fresh : CAPTIONS[stageState];
  const activeNodeId =
    nodes.find((node) => node.data.status === "running")?.id ??
    [...timeline].reverse().find((event) => event.status === "running")?.nodeId ??
    (isRunning || stageLingerRunning ? STAGE_AGENT_IDS[0] : null);
  const completedNodeIds = new Set(
    nodes.filter((node) => node.data.status === "success").map((node) => node.id).concat(timeline.filter((event) => event.status === "success").map((event) => event.nodeId))
  );
  const activeEdgeIndex = Math.max(
    0,
    STAGE_AGENT_IDS.findIndex((id) => id === activeNodeId)
  );

  return (
    <>
      <div className="agent-theatre pointer-events-none absolute inset-0 z-10 overflow-hidden" data-state={stageState} aria-hidden="true">
        <div className="agent-theatre__drift absolute inset-0" />
        <div className="agent-theatre__vignette absolute inset-0" />
        <div className="agent-theatre__center-pulse absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full" />

        <div className="absolute left-1/2 top-[47%] hidden w-[min(78%,760px)] -translate-x-1/2 items-center justify-between gap-2 md:flex">
          {STAGE_AGENT_IDS.map((nodeId, index) => {
            const node = nodes.find((item) => item.id === nodeId);
            const completed = completedNodeIds.has(nodeId) || (isDone && index <= STAGE_AGENT_IDS.length - 1);
            const active = activeNodeId === nodeId || ((isRunning || stageLingerRunning) && index === activeEdgeIndex);
            return (
              <div key={nodeId} className="flex flex-1 items-center">
                <div
                  className={cn(
                    "agent-theatre__beacon relative h-3 w-3 shrink-0 rounded-full border",
                    completed && "agent-theatre__beacon--done",
                    active && "agent-theatre__beacon--active",
                    hasError && active && "agent-theatre__beacon--error"
                  )}
                  title={node?.data.label}
                >
                  {completed ? <span className="absolute inset-0 grid place-items-center text-[8px] font-bold text-black">✓</span> : null}
                </div>
                {index < STAGE_AGENT_IDS.length - 1 ? (
                  <div className={cn("agent-theatre__rail relative h-px flex-1", (completed || ((isRunning || stageLingerRunning) && index <= activeEdgeIndex)) && "agent-theatre__rail--lit")}>
                    {(isRunning || stageLingerRunning) && index === activeEdgeIndex ? <span className="agent-theatre__spark absolute -top-[2px] h-[5px] w-12 rounded-full" /> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="absolute inset-x-8 top-8 h-px bg-gradient-to-r from-transparent via-emerald-300/20 to-transparent opacity-0 data-[state=done]:opacity-100" />
        {isDone ? <div className="agent-theatre__shimmer absolute inset-y-0 left-[-30%] w-1/3 rotate-12 bg-gradient-to-r from-transparent via-white/10 to-transparent" /> : null}
        {isRunning || stageLingerRunning ? (
          <div className="absolute inset-0">
            {edges.slice(0, 8).map((edge, index) => (
              <span
                key={`${edge.id}-${index}`}
                className="agent-theatre__particle absolute h-1 w-1 rounded-full bg-emerald-200/70 shadow-[0_0_18px_rgba(110,231,183,0.9)]"
                style={{
                  left: `${12 + ((index * 13) % 76)}%`,
                  top: `${24 + ((index * 17) % 48)}%`,
                  animationDelay: `${index * 180}ms`,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center md:bottom-4" aria-live="polite">
        <div
          className={cn(
            "max-w-[calc(100%-1rem)] rounded-full border px-3 py-1.5 text-center text-[10px] font-medium shadow-[0_14px_45px_rgba(0,0,0,0.45)] backdrop-blur-xl md:text-xs",
            stageState === "error"
              ? "border-amber-300/25 bg-amber-950/35 text-amber-100"
              : stageState === "done"
                ? "border-emerald-300/25 bg-emerald-950/35 text-emerald-100"
                : "border-white/10 bg-black/55 text-zinc-300"
          )}
        >
          {stageCaption}
          {stageState === "done" && hasFreshGeneration ? (
            <span className="mt-2 flex justify-center gap-2">
              <button
                type="button"
                onClick={onShowPreview}
                className="pointer-events-auto rounded-full border border-emerald-200/20 bg-emerald-300/15 px-3 py-1 text-[10px] font-semibold text-emerald-50 transition-colors hover:bg-emerald-300/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/45"
                aria-label={translate("app.showPreview")}
              >
                {translate("app.showPreview")}
              </button>
              <button
                type="button"
                onClick={onExport}
                disabled={!canExport}
                title={canExport ? translate("common.exportJson") : translate("app.exportUnavailable")}
                className="pointer-events-auto rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={translate("common.exportJson")}
              >
                {translate("common.exportJson")}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
