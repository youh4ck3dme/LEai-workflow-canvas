"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WorkflowNode as WorkflowNodeView } from "@/components/workflow/WorkflowNode";
import { AgentTheatreOverlay } from "@/components/workflow/AgentTheatreOverlay";
import type { TimelineEvent, WorkflowEdge, WorkflowNode } from "@/types/workflow";

const nodeTypes = {
  "project-type": WorkflowNodeView,
  "launch-brief": WorkflowNodeView,
  "scope-guard": WorkflowNodeView,
  "strategy-agent": WorkflowNodeView,
  "copy-agent": WorkflowNodeView,
  "structure-agent": WorkflowNodeView,
  "template-selector": WorkflowNodeView,
  "seo-agent": WorkflowNodeView,
  "preview-builder": WorkflowNodeView,
  "wordpress-adapter": WorkflowNodeView,
  "qa-audit": WorkflowNodeView,
  "launch-pack": WorkflowNodeView,
};

interface Props {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onNodesChange: OnNodesChange<WorkflowNode>;
  onEdgesChange: OnEdgesChange<WorkflowEdge>;
  onNodeClick: (nodeId: string) => void;
  timeline: TimelineEvent[];
  isRunning: boolean;
  validationErrors: string[];
  generated: unknown;
  hasFreshGeneration: boolean;
  canExport: boolean;
  onShowPreview: () => void;
  onExport: () => void;
}

export function LaunchCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  timeline,
  isRunning,
  validationErrors,
  generated,
  hasFreshGeneration,
  canExport,
  onShowPreview,
  onExport,
}: Props) {
  const themedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const source = nodes.find((node) => node.id === edge.source);
        const target = nodes.find((node) => node.id === edge.target);
        const lit = source?.data.status === "success" || target?.data.status === "running" || target?.data.status === "success";
        return {
          ...edge,
          animated: false,
          style: {
            stroke: lit ? "rgba(52,211,153,0.62)" : "rgba(255,255,255,0.18)",
            strokeWidth: lit ? 2 : 1.5,
            filter: lit ? "drop-shadow(0 0 8px rgba(52,211,153,0.34))" : "none",
          },
        };
      }),
    [edges, nodes]
  );

  return (
    <div className="relative h-full w-full bg-black">
      <ReactFlow
        nodes={nodes}
        edges={themedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        className="bg-black"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.08)" />
        <MiniMap className="hidden !rounded-2xl !border !border-white/10 !bg-black/70 md:block" nodeColor="rgba(255,255,255,0.26)" maskColor="rgba(0,0,0,0.72)" />
        <Controls
          showFitView={false}
          showInteractive={false}
          position="bottom-left"
          aria-label="Workflow zoom controls"
          className="!rounded-2xl !border-white/10 !bg-black/70 !shadow-[0_18px_55px_rgba(0,0,0,0.45)] !backdrop-blur-xl"
        />
      </ReactFlow>
      <AgentTheatreOverlay
        nodes={nodes}
        edges={edges}
        timeline={timeline}
        isRunning={isRunning}
        validationErrors={validationErrors}
        generated={generated}
        hasFreshGeneration={hasFreshGeneration}
        canExport={canExport}
        onShowPreview={onShowPreview}
        onExport={onExport}
      />
    </div>
  );
}
