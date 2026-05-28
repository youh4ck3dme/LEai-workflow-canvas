"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useEdgesState, useNodesState, type Edge } from "@xyflow/react";
import { Activity, Compass, Database, FileJson, Monitor, Play, Share2, WandSparkles, X } from "lucide-react";
import { createDefaultWorkflow } from "@/lib/workflow/default-workflow";
import type { LaunchBriefInput, ProjectType, WorkflowNode, WorkflowRunResponse } from "@/types/workflow";
import { LaunchCanvas } from "@/components/workflow/LaunchCanvas";
import { WorkflowToolbar } from "@/components/workflow/WorkflowToolbar";
import { NodeInspector } from "@/components/workflow/NodeInspector";
import { ExecutionTimeline } from "@/components/workflow/ExecutionTimeline";
import { JsonPreview } from "@/components/workflow/JsonPreview";
import { PreviewTabs, type PreviewTab } from "@/components/workflow/PreviewTabs";
import { ProjectTypeSelector } from "@/components/workflow/ProjectTypeSelector";
import { VisualResultPreview } from "@/components/workflow/VisualResultPreview";
import { GenerationHistoryPanel } from "@/components/workflow/GenerationHistoryPanel";
import { useI18n } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";
import type { SourceOfTruthExport } from "@/lib/launch-studio/source-of-truth-schema";
import { validateSourceOfTruthExport } from "@/lib/launch-studio/validation";
import { validateLiveBrief } from "@/lib/launch-studio/brief-validation";
import { loadProjectConfig, saveProjectConfig } from "@/lib/launch-studio/project-store";
import { containsForbiddenClaims, containsPlaceholderText, stripHtmlForPlainText } from "@/lib/launch-studio/content-format";
import { buildLaunchArchitectUserPrompt } from "@/lib/launch-studio/launch-architect-prompt";
import {
  clearGenerationHistory,
  createGenerationHistoryRecord,
  loadGenerationHistory,
  restoreGenerationRecord,
  saveGenerationToHistory,
  type GenerationHistoryRecord,
} from "@/lib/launch-studio/generation-history";

const NODE_COPY_KEYS: Record<string, { label: `nodes.${string}.label`; description: `nodes.${string}.description` }> = {
  "project-type": { label: "nodes.project-type.label", description: "nodes.project-type.description" },
  "launch-brief": { label: "nodes.launch-brief.label", description: "nodes.launch-brief.description" },
  "scope-guard": { label: "nodes.scope-guard.label", description: "nodes.scope-guard.description" },
  "strategy-agent": { label: "nodes.strategy-agent.label", description: "nodes.strategy-agent.description" },
  "copy-agent": { label: "nodes.copy-agent.label", description: "nodes.copy-agent.description" },
  "structure-agent": { label: "nodes.structure-agent.label", description: "nodes.structure-agent.description" },
  "template-selector": { label: "nodes.template-selector.label", description: "nodes.template-selector.description" },
  "seo-agent": { label: "nodes.seo-agent.label", description: "nodes.seo-agent.description" },
  "preview-builder": { label: "nodes.preview-builder.label", description: "nodes.preview-builder.description" },
  "wordpress-adapter": { label: "nodes.wordpress-adapter.label", description: "nodes.wordpress-adapter.description" },
  "qa-audit": { label: "nodes.qa-audit.label", description: "nodes.qa-audit.description" },
  "launch-pack": { label: "nodes.launch-pack.label", description: "nodes.launch-pack.description" },
};

const PROJECT_TYPE_LABEL_KEYS: Record<ProjectType, TranslationKey> = {
  business: "projectTypes.business",
  saas: "projectTypes.saas",
  booking: "projectTypes.booking",
  "product-launch": "projectTypes.product-launch",
  "support-campaign": "projectTypes.support-campaign",
  "personal-brand": "projectTypes.personal-brand",
};

const MAGIC_TIMEOUT_MS = 10000;
const MAGIC_MAX_ATTEMPTS = 1;
const GENERATED_PAYLOAD_STORAGE_KEY = "le-studio:last-generated-payload";
const RESULT_REVEAL_MS = 2200;

const DEFAULT_CONTACT_EMAIL = "space@rubberduck.space";
type GenerationEngine = "local" | "architect";
const GLASS_PANEL =
  "rounded-[1.35rem] border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_24px_80px_rgba(0,0,0,0.46)] backdrop-blur-xl";
const GLASS_PANEL_SOFT =
  "rounded-[1.35rem] border border-white/10 bg-white/[0.028] shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl";
const FIELD_CLASS =
  "h-10 w-full rounded-xl border border-white/10 bg-black/45 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition-[background-color,border-color,box-shadow] hover:border-white/15 focus-visible:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 xl:h-11";


function cleanMagicValue(value: string): string {
  return stripHtmlForPlainText(value).replace(/\s+/g, " ").trim();
}

function readString(value: unknown): string {
  return typeof value === "string" ? cleanMagicValue(value) : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseMagicPayload(rawText: string): Partial<Pick<LaunchBriefInput, "description" | "goal" | "targetAudience" | "preferredTone">> {
  const cleaned = rawText.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = (fenced?.[1] ?? cleaned).trim();

  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    const project = readRecord(parsed.project);
    const wordpress = readRecord(parsed.wordpress);
    const main = readRecord(wordpress.main);
    const description = readString(parsed.description) || readString(project.description) || readString(main.context);
    const goal = readString(parsed.goal) || readString(project.goal);
    const targetAudience = readString(parsed.targetAudience) || readString(project.audience);
    const preferredTone = readString(parsed.preferredTone) || readString(project.tone);
    return { description, goal, targetAudience, preferredTone };
  } catch {
    return { description: cleanMagicValue(cleaned) };
  }
}

function isSafeMagicText(value: string): boolean {
  if (!value.trim()) return false;
  if (containsPlaceholderText(value)) return false;
  if (containsForbiddenClaims(value)) return false;
  return true;
}

function createDeterministicMagicDraft(brief: LaunchBriefInput): Required<Pick<LaunchBriefInput, "description" | "goal" | "targetAudience" | "preferredTone">> {
  const projectName = brief.projectName.trim();
  const projectType = brief.projectType;

  return {
    goal:
      brief.goal.trim() ||
      `Pripraviť dôveryhodný launch plán pre projekt ${projectName} so zrozumiteľnou ponukou, jasnou CTA cestou a exportom pripraveným pre WordPress payload.`,
    targetAudience:
      brief.targetAudience.trim() ||
      `Majitelia menších a stredných firiem, tímy a tvorcovia, ktorí potrebujú rýchlo spustiť profesionálnu webovú prezentáciu pre typ projektu ${projectType}.`,
    preferredTone:
      brief.preferredTone.trim() || "Jasný, profesionálny, dôveryhodný, vecný a konverzne zameraný bez lacných marketingových fráz.",
    description: [
      `Vytvor production-grade brief pre projekt „${projectName}“ typu ${projectType}.`,
      "Výstup musí byť konkrétny, overiteľný a použiteľný pre LE Studio workflow bez výplňových viet a bez fake tvrdení.",
      "Doplň hodnotový headline, stručný subheadline, sekcie (hero, benefits, process, offer, trust, faq, contact), CTA smer a SEO základy.",
      "Text musí byť pripravený pre export do source-of-truth WordPress metabox payloadu.",
    ].join(" "),
  };
}


function detectProjectTypeFromPrompt(prompt: string, fallback: ProjectType): ProjectType {
  const lower = prompt.toLowerCase();
  if (/(rezerv|booking|objedn|termín|termin)/.test(lower)) return "booking";
  if (/(saas|softvér|software|aplikáci|platform|dashboard|pwa)/.test(lower)) return "saas";
  if (/(produkt|launch|uveden|predaj)/.test(lower)) return "product-launch";
  if (/(podpor|komunit|zbierk|kampaň|kampan)/.test(lower)) return "support-campaign";
  if (/(osobn|personal|portfolio|brand|freelancer)/.test(lower)) return "personal-brand";
  return fallback || "business";
}

function inferProjectNameFromPrompt(prompt: string): string {
  const cleaned = cleanMagicValue(prompt)
    .replace(/^(chcem|potrebujem|vytvor|sprav|navrhni|urob|chcel by som|chcela by som)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  return cleaned.length > 76 ? `${cleaned.slice(0, 73).trim()}...` : cleaned;
}

function inferAudienceFromPrompt(prompt: string, projectType: ProjectType): string {
  const lower = prompt.toLowerCase();
  if (/(salón|salon|kader|kozmet|beauty|necht|spa)/.test(lower)) {
    return "Majitelia salónov, kaderníctiev, kozmetických štúdií a lokálnych služieb, ktorí potrebujú rýchlo získať dôveryhodný web s jasnou ponukou a kontaktom.";
  }
  if (/(ambul|klin|lekár|zubar|fyzi|terap)/.test(lower)) {
    return "Ambulancie, kliniky, terapeuti a zdravotnícke služby, ktoré potrebujú dôveryhodnú webovú prezentáciu s jasným kontaktom a bezpečnou komunikáciou.";
  }
  if (/(remes|servis|stavb|elektr|inštalat|instalat)/.test(lower)) {
    return "Remeselníci a lokálne služby, ktoré potrebujú zrozumiteľne ukázať ponuku, dostupnosť, kontakt a dôvody, prečo im zákazník môže dôverovať.";
  }
  if (projectType === "saas") {
    return "Tímy a firmy, ktoré hľadajú praktický digitálny nástroj s jasnou hodnotou, jednoduchým onboardingom a dôveryhodným technickým vysvetlením.";
  }
  if (projectType === "booking") {
    return "Lokálne služby a malé firmy, ktoré potrebujú jednoduchý rezervačný alebo kontaktný flow bez zbytočného technického chaosu.";
  }
  return "Majitelia menších a stredných firiem, lokálne služby a tvorcovia, ktorí potrebujú rýchlo spustiť profesionálnu webovú prezentáciu s jasnou ponukou.";
}

function buildAutopilotBrief(prompt: string, current: LaunchBriefInput): LaunchBriefInput {
  const safePrompt = cleanMagicValue(prompt);
  const projectType = detectProjectTypeFromPrompt(safePrompt, current.projectType);
  const projectName = current.projectName.trim() || inferProjectNameFromPrompt(safePrompt);
  const targetAudience = inferAudienceFromPrompt(safePrompt, projectType);
  const goal = `Pripraviť štruktúru, texty, CTA smerovanie, SEO základ a WordPress-ready obsahový payload pre projekt „${projectName}“ tak, aby bol použiteľný na kontrolu pred importom.`;
  const preferredTone = "Profesionálny, jasný, dôveryhodný, priamy, mierne prémiový, bez lacného marketingu a bez nereálnych sľubov.";
  const description = [
    `Používateľský zámer: ${safePrompt}.`,
    `Projekt: ${projectName}.`,
    `Typ projektu: ${projectType}.`,
    `Cieľová skupina: ${targetAudience}`,
    `Cieľ: ${goal}`,
    `Tón: ${preferredTone}`,
    "Výstup musí obsahovať hodnotový headline, stručný subheadline, sekcie hero, benefits, process, offer, trust, faq a contact, CTA smer, SEO námety a FAQ.",
    "Použi len overiteľné tvrdenia. Nepoužívaj fake referencie, fake počty klientov, garantované výsledky, manipulatívnu urgenciu ani výplňový text.",
  ].join(" ");

  return {
    ...current,
    projectType,
    projectName,
    targetAudience,
    goal,
    description,
    preferredTone,
    contactEmail: current.contactEmail?.trim() || DEFAULT_CONTACT_EMAIL,
  };
}


function persistGeneratedPayload(payload: unknown): string | null {
  if (typeof window === "undefined") return null;

  try {
    const savedAt = new Date().toLocaleString();
    window.localStorage.setItem(GENERATED_PAYLOAD_STORAGE_KEY, JSON.stringify({ savedAt, payload }));
    return savedAt;
  } catch {
    return null;
  }
}

function loadStoredGeneratedPayload(): { savedAt: string; payload: unknown } | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(GENERATED_PAYLOAD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; payload?: unknown };
    if (typeof parsed.savedAt !== "string" || !parsed.payload) return null;
    return { savedAt: parsed.savedAt, payload: parsed.payload };
  } catch {
    return null;
  }
}

function LaunchStudioInner() {
  const { translate } = useI18n();

  const defaultBrief: LaunchBriefInput = {
    projectType: "business",
    projectName: "",
    targetAudience: "",
    goal: "",
    description: "",
    preferredTone: "",
    contactEmail: "",
  };

  const initial = useMemo(() => {
    const workflow = createDefaultWorkflow();
    workflow.nodes = workflow.nodes.map((node) => {
      const copy = NODE_COPY_KEYS[node.type];
      if (!copy) return node;
      return {
        ...node,
        data: {
          ...node.data,
          label: translate(copy.label as TranslationKey),
          description: translate(copy.description as TranslationKey),
        },
      };
    });
    return workflow;
  }, [translate]);
  const [workflowId, setWorkflowId] = useState<string>(initial.id);
  const [workflowName, setWorkflowName] = useState<string>(translate("app.workflowName"));
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges as Edge[]);
  const [brief, setBrief] = useState<LaunchBriefInput>(defaultBrief);
  const [timeline, setTimeline] = useState<WorkflowRunResponse["timeline"]>([]);
  const [generated, setGenerated] = useState<unknown>(null);
  const [compliancePassed, setCompliancePassed] = useState<boolean>(false);
  const [violations, setViolations] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [showJson, setShowJson] = useState(true);
  const [activePreviewTab, setActivePreviewTab] = useState<PreviewTab>("visual");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string>("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isPreparingAutopilot, setIsPreparingAutopilot] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string>("");
  const [hasFreshGeneration, setHasFreshGeneration] = useState(false);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryRecord[]>([]);
  const [selectedHistoryCompareId, setSelectedHistoryCompareId] = useState<string | null>(null);
  const resultRevealTimerRef = useRef<number | null>(null);
  const mobileResultRef = useRef<HTMLDivElement | null>(null);
  const desktopJsonRef = useRef<HTMLDivElement | null>(null);

  const [studioMode, setStudioMode] = useState<"simple" | "advanced">("simple");
  const [simplePrompt, setSimplePrompt] = useState<string>("");
  const [generationEngine, setGenerationEngine] = useState<GenerationEngine>("architect");


  const selectedNode: WorkflowNode | null = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const validation = useMemo(
    () =>
      generated
        ? validateSourceOfTruthExport(generated)
        : { valid: false, errors: ["missing_generated_payload"] },
    [generated]
  );
  const canExport = compliancePassed && Boolean(generated) && validation.valid;
  const isStudioBusy = isRunning || isGeneratingPrompt || isPreparingAutopilot;
  const liveBriefErrors = useMemo(() => validateLiveBrief(brief), [brief]);
  const autopilotBrief = useMemo(() => buildAutopilotBrief(simplePrompt, brief), [simplePrompt, brief]);
  const autopilotPhases = useMemo(
    () => [
      { label: translate("autopilot.analyze"), done: Boolean(simplePrompt.trim()) || timeline.length > 0 || Boolean(generated) },
      { label: translate("autopilot.copy"), done: timeline.some((event) => event.nodeId === "copy-agent") || Boolean(generated) },
      { label: translate("autopilot.seo"), done: timeline.some((event) => event.nodeId === "seo-agent") || Boolean(generated) },
      { label: translate("autopilot.payload"), done: Boolean(generated) },
      { label: translate("autopilot.ready"), done: canExport },
    ],
    [canExport, generated, simplePrompt, timeline, translate]
  );

  useEffect(() => {
    const restored = loadProjectConfig();
    if (restored) {
      setBrief(restored);
      setSimplePrompt((current) => current || restored.projectName || "");
    }

    const storedPayload = loadStoredGeneratedPayload();
    if (storedPayload) {
      const gate = validateSourceOfTruthExport(storedPayload.payload);
      setGenerated(storedPayload.payload);
      setLastSavedAt(storedPayload.savedAt);
      setCompliancePassed(gate.valid);
      setValidationErrors(gate.valid ? [] : gate.errors);
    }

    const history = loadGenerationHistory();
    setGenerationHistory(history);
    setSelectedHistoryCompareId(history[0]?.id ?? null);
  }, []);

  useEffect(() => {
    saveProjectConfig(brief);
  }, [brief]);

  useEffect(
    () => () => {
      if (resultRevealTimerRef.current) {
        window.clearTimeout(resultRevealTimerRef.current);
      }
    },
    []
  );

  const showGeneratedResult = useCallback(() => {
    setShowJson(true);
    setActivePreviewTab("visual");
    setHasFreshGeneration(true);
    setImportMessage(translate("app.resultReady"));

    if (resultRevealTimerRef.current) {
      window.clearTimeout(resultRevealTimerRef.current);
    }

    window.requestAnimationFrame(() => {
      const target = window.matchMedia("(min-width: 1280px)").matches ? desktopJsonRef.current : mobileResultRef.current;
      target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });

    resultRevealTimerRef.current = window.setTimeout(() => {
      setHasFreshGeneration(false);
      resultRevealTimerRef.current = null;
    }, RESULT_REVEAL_MS);
  }, [translate]);

  const showPreviewTab = useCallback((tab: PreviewTab) => {
    setActivePreviewTab(tab);
    setShowJson(true);
  }, []);

  const saveHistoryVersion = useCallback(
    (payload: unknown, sourceBrief: LaunchBriefInput) => {
      const gate = validateSourceOfTruthExport(payload);
      if (!gate.valid) return;

      const prompt = studioMode === "simple" && simplePrompt.trim()
        ? simplePrompt
        : sourceBrief.description || sourceBrief.projectName;
      const record = createGenerationHistoryRecord(payload as SourceOfTruthExport, {
        engine: generationEngine,
        prompt,
      });

      if (!record) return;
      const next = saveGenerationToHistory(record);
      setGenerationHistory(next);
      setSelectedHistoryCompareId(record.id);
    },
    [generationEngine, simplePrompt, studioMode]
  );

  const toggleResultPanel = useCallback(() => {
    setShowJson((visible) => {
      const nextVisible = !visible;
      if (nextVisible) {
        setActivePreviewTab("json");
      }
      return nextVisible;
    });
  }, []);

  const generateArchitectBrief = useCallback(
    async (sourceBrief: LaunchBriefInput, overwriteInferredFields: boolean): Promise<{ brief: LaunchBriefInput; usedAi: boolean; error?: string }> => {
      const deterministicDraft = createDeterministicMagicDraft(sourceBrief);
      const fallbackBrief: LaunchBriefInput = {
        ...sourceBrief,
        description: deterministicDraft.description,
        goal: sourceBrief.goal.trim() ? sourceBrief.goal : deterministicDraft.goal,
        targetAudience: sourceBrief.targetAudience.trim() ? sourceBrief.targetAudience : deterministicDraft.targetAudience,
        preferredTone: sourceBrief.preferredTone.trim() ? sourceBrief.preferredTone : deterministicDraft.preferredTone,
        contactEmail: sourceBrief.contactEmail,
      };
      let aiText = "";
      let attemptError = "";

      for (let attempt = 1; attempt <= MAGIC_MAX_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), MAGIC_TIMEOUT_MS);
        const model = attempt === 1 ? "mistral-small" : "mistral-large-latest";

        try {
          const res = await fetch("/api/ai/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "mistral",
              model,
              purpose: "launch-architect",
              temperature: 0.45,
              prompt: buildLaunchArchitectUserPrompt(sourceBrief),
            }),
            signal: controller.signal,
          });
          const data = await res.json().catch(() => ({}));
          clearTimeout(timeout);

          if (!res.ok || !data?.text) {
            attemptError = `attempt_${attempt}_failed`;
            continue;
          }

          aiText = String(data.text);
          break;
        } catch {
          clearTimeout(timeout);
          attemptError = `attempt_${attempt}_failed`;
        }
      }

      if (!aiText) {
        return { brief: fallbackBrief, usedAi: false, error: attemptError || "network" };
      }

      const parsed = parseMagicPayload(aiText);
      const next: LaunchBriefInput = { ...fallbackBrief };
      const safeDescription = parsed.description && isSafeMagicText(parsed.description) ? parsed.description : deterministicDraft.description;
      next.description = safeDescription;

      if (overwriteInferredFields || !sourceBrief.goal.trim()) {
        next.goal = parsed.goal && isSafeMagicText(parsed.goal) ? parsed.goal : deterministicDraft.goal;
      }
      if (overwriteInferredFields || !sourceBrief.targetAudience.trim()) {
        next.targetAudience =
          parsed.targetAudience && isSafeMagicText(parsed.targetAudience) ? parsed.targetAudience : deterministicDraft.targetAudience;
      }
      if (overwriteInferredFields || !sourceBrief.preferredTone.trim()) {
        next.preferredTone =
          parsed.preferredTone && isSafeMagicText(parsed.preferredTone) ? parsed.preferredTone : deterministicDraft.preferredTone;
      }

      return { brief: next, usedAi: true };
    },
    []
  );

  const handleRun = async (briefOverride?: LaunchBriefInput) => {
    const briefToRun = briefOverride ?? brief;
    const runBriefErrors = validateLiveBrief(briefToRun);
    if (runBriefErrors.length > 0) {
      setValidationErrors(runBriefErrors);
      setImportMessage("Validation failed. Fill all required real project fields.");
      return;
    }

    if (briefOverride) {
      setBrief(briefOverride);
    }

    setIsRunning(true);
    setImportMessage("");
    try {
      await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workflowId, name: workflowName, nodes, edges }),
      });

      const runRes = await fetch(`/api/workflows/${workflowId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: briefToRun, workflow: { id: workflowId, name: workflowName, nodes, edges } }),
      });
      const runData = await runRes.json();

      if (!runRes.ok) {
        setImportMessage(runData?.message ?? translate("app.workflowRunFailed"));
        setValidationErrors(runData?.details ?? ["workflow_run_failed"]);
        return;
      }

      setNodes(runData.nodes);
      setTimeline(runData.timeline);
      setGenerated(runData.generated ?? null);
      setHasFreshGeneration(false);
      if (runData.generated) {
        setLastSavedAt(persistGeneratedPayload(runData.generated) ?? "");
      }
      const runCompliancePassed = Boolean(runData.compliancePassed);
      const runViolations: string[] = Array.isArray(runData.violations) ? runData.violations : [];
      setCompliancePassed(runCompliancePassed);
      setViolations(runViolations);
      setValidationErrors([]);

      const genRes = await fetch("/api/projects/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: briefToRun }),
      });

      const genData = await genRes.json();
      if (!genRes.ok) {
        setImportMessage(genData?.message ?? "Generation failed.");
        setValidationErrors(genData?.details ?? ["generation_failed"]);
        return;
      }
      if (genRes.ok && genData?.project) {
        setGenerated(genData.project);
        setLastSavedAt(persistGeneratedPayload(genData.project) ?? "");
        saveHistoryVersion(genData.project, briefToRun);
        const generationCompliancePassed = Boolean(genData?.compliance?.passed);
        const generationViolations: string[] = Array.isArray(genData?.compliance?.violations) ? genData.compliance.violations : [];
        setCompliancePassed(runCompliancePassed && generationCompliancePassed);
        setViolations(Array.from(new Set([...runViolations, ...generationViolations])));
        const gate = validateSourceOfTruthExport(genData.project);
        setValidationErrors(Array.from(new Set([...(runCompliancePassed ? [] : runViolations), ...gate.errors])));
        showGeneratedResult();
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleSimpleRun = () => {
    if (!simplePrompt.trim() || simplePrompt.trim().length < 6) {
      setValidationErrors([translate("autopilot.promptRequired")]);
      setImportMessage(translate("autopilot.promptRequired"));
      return;
    }
    void (async () => {
      setIsPreparingAutopilot(true);
      let briefToRun = autopilotBrief;

      try {
        if (generationEngine === "architect") {
          setImportMessage(translate("app.magicPromptPreparing"));
          const result = await generateArchitectBrief(autopilotBrief, true);
          briefToRun = result.brief;
          setBrief(result.brief);
          setImportMessage(
            result.usedAi ? translate("app.magicPromptSuccess") : `${translate("app.magicPromptFallback")} (${result.error || "network"})`
          );
        }

        await handleRun(briefToRun);
      } finally {
        setIsPreparingAutopilot(false);
      }
    })();
  };

  const handleSave = async () => {
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: workflowId, name: workflowName, nodes, edges }),
    });
    const data = await res.json();
    if (res.ok && data?.workflow?.id) {
      setWorkflowId(data.workflow.id);
      setImportMessage(translate("app.workflowSaved"));
    }
  };

  const handleLoad = async () => {
    const res = await fetch(`/api/workflows?workflowId=${workflowId}`);
    const data = await res.json();
    if (res.ok && data?.workflow) {
      setWorkflowName(data.workflow.name);
      setNodes(data.workflow.nodes);
      setEdges(data.workflow.edges);
      setImportMessage(translate("app.workflowLoaded"));
    }
  };

  const handleReset = () => {
    const fresh = createDefaultWorkflow();
    setWorkflowId(fresh.id);
    setWorkflowName(translate("app.workflowName"));
    setNodes(fresh.nodes);
    setEdges(fresh.edges as Edge[]);
    setTimeline([]);
    setGenerated(null);
    setHasFreshGeneration(false);
    setLastSavedAt("");
    setCompliancePassed(false);
    setViolations([]);
    setImportMessage("");
  };

  const exportPayload = useCallback(
    (payload: unknown, filename = "web-do-24h-launch-pack.json") => {
      const gate = validateSourceOfTruthExport(payload);
      if (!gate.valid) {
        setImportMessage(`Validation failed: ${gate.errors.join(", ")}`);
        return;
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setImportMessage(translate("app.exportPrepared"));
    },
    [translate]
  );

  const handleExport = () => {
    if (!canExport || !generated) return;
    setLastSavedAt(persistGeneratedPayload(generated) ?? "");
    exportPayload(generated);
  };

  const handleRestoreHistoryVersion = useCallback(
    (id: string) => {
      const record = restoreGenerationRecord(id);
      if (!record) return;
      const gate = validateSourceOfTruthExport(record.payload);

      setGenerated(record.payload);
      setCompliancePassed(record.payload.compliance.passed === true && gate.valid);
      setViolations(record.payload.compliance.violations);
      setValidationErrors(gate.valid ? [] : gate.errors);
      setLastSavedAt(new Date(record.createdAt).toLocaleString());
      setShowJson(true);
      setActivePreviewTab("visual");
      setSelectedHistoryCompareId(record.id);
      setHasFreshGeneration(true);
      setImportMessage(translate("history.restored"));

      if (resultRevealTimerRef.current) {
        window.clearTimeout(resultRevealTimerRef.current);
      }
      resultRevealTimerRef.current = window.setTimeout(() => {
        setHasFreshGeneration(false);
        resultRevealTimerRef.current = null;
      }, RESULT_REVEAL_MS);
    },
    [translate]
  );

  const handleExportHistoryVersion = useCallback(
    (id: string) => {
      const record = restoreGenerationRecord(id);
      if (!record) return;
      const safeName = record.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "le-studio";
      exportPayload(record.payload, `${safeName}-${record.createdAt.slice(0, 10)}.json`);
    },
    [exportPayload]
  );

  const handleCompareHistoryVersion = useCallback((id: string) => {
    setSelectedHistoryCompareId(id);
    setActivePreviewTab("history");
    setShowJson(true);
  }, []);

  const handleClearHistory = useCallback(() => {
    clearGenerationHistory();
    setGenerationHistory([]);
    setSelectedHistoryCompareId(null);
    setImportMessage(translate("history.cleared"));
  }, [translate]);

  const handleHistoryChange = useCallback(
    (tab: PreviewTab) => {
      setActivePreviewTab(tab);
      setShowJson(true);
      if (tab === "history") {
        setGenerationHistory(loadGenerationHistory());
      }
    },
    []
  );

  const handleShowJsonTab = useCallback(() => showPreviewTab("json"), [showPreviewTab]);

  const handlePreviewTabsChange = handleHistoryChange;

  const handleImportDryRun = async () => {
    if (!generated) return;
    const gate = validateSourceOfTruthExport(generated);
    if (!gate.valid) {
      setImportMessage(`Validation failed: ${gate.errors.join(", ")}`);
      return;
    }
    const res = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: generated, compliancePassed }),
    });
    const data = await res.json();
    setImportMessage(data?.message ?? translate("app.importResponseReceived"));
  };

  const handleMagicPrompt = useCallback(async () => {
    const sourceBrief = !brief.projectName.trim() && simplePrompt.trim() ? buildAutopilotBrief(simplePrompt, brief) : brief;

    if (!sourceBrief.projectName.trim()) {
      setValidationErrors([translate("app.magicPromptMissingProjectName")]);
      setImportMessage(translate("app.magicPromptMissingProjectName"));
      return;
    }

    setValidationErrors([]);
    setImportMessage(translate("app.magicPromptPreparing"));
    setIsGeneratingPrompt(true);

    try {
      const result = await generateArchitectBrief(sourceBrief, studioMode === "simple");
      setBrief(result.brief);
      setImportMessage(
        result.usedAi ? translate("app.magicPromptSuccess") : `${translate("app.magicPromptFallback")} (${result.error || "network"})`
      );
    } catch {
      setImportMessage(translate("app.magicPromptError"));
    } finally {
      setIsGeneratingPrompt(false);
    }
  }, [brief, generateArchitectBrief, simplePrompt, studioMode, translate]);

  const handleAddNode = useCallback(() => {
    const last = nodes[nodes.length - 1];
    const newNode: WorkflowNode = {
      id: `custom-${Date.now()}`,
      type: "launch-pack",
      position: { x: (last?.position.x ?? 100) + 220, y: last?.position.y ?? 80 },
      data: {
        label: translate("app.customStepLabel"),
        description: translate("app.customStepDescription"),
        status: "idle",
      },
    };
    setNodes((prev) => [...prev, newNode]);
  }, [nodes, setNodes, translate]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const lastRunAt = timeline[timeline.length - 1]?.at;
  const activeBrief = studioMode === "simple" && simplePrompt.trim() ? autopilotBrief : brief;
  const projectTypeLabel = translate(PROJECT_TYPE_LABEL_KEYS[activeBrief.projectType]);
  const latestEvent = timeline[timeline.length - 1];
  const latestEventText = latestEvent
    ? `${latestEvent.nodeLabel}: ${latestEvent.message}`
    : translate("timeline.empty");
  const wordpressPayloadPreview =
    generated && typeof generated === "object" && "wordpress" in (generated as Record<string, unknown>)
      ? (generated as Record<string, unknown>).wordpress
      : null;

  const currentPayload = validation.valid && generated ? (generated as SourceOfTruthExport) : null;

  const historyPanel = (
    <GenerationHistoryPanel
      records={generationHistory}
      currentPayload={currentPayload}
      selectedCompareId={selectedHistoryCompareId}
      onCompare={handleCompareHistoryVersion}
      onRestore={handleRestoreHistoryVersion}
      onExport={handleExportHistoryVersion}
      onClear={handleClearHistory}
    />
  );

  const payloadPreviewPanel = (
    <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.035] p-4 xl:p-5 xl:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_70px_rgba(0,0,0,0.4)] xl:backdrop-blur-xl">
      <h3 className="text-sm font-semibold text-white">{translate("preview.payload")}</h3>
      <p className="mt-1 text-[11px] text-zinc-500">{translate("preview.payloadNotice")}</p>
      <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/45 p-4 text-xs text-zinc-300">
        {wordpressPayloadPreview ? JSON.stringify(wordpressPayloadPreview, null, 2) : translate("jsonPreview.empty")}
      </pre>
    </div>
  );

  return (
    <div className="app-shell launch-studio-shell relative flex h-[100vh] h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-black text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.055),transparent_30%),radial-gradient(circle_at_85%_8%,rgba(16,185,129,0.055),transparent_26%)]" />
      <nav className="xl:hidden flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-black/70 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          aria-label={translate("common.resetWorkflow")}
          title={translate("common.resetWorkflow")}
        >
          <X className="h-[18px] w-[18px]" />
        </button>
        <div className="text-xs font-medium tracking-wide text-zinc-500">studio.rubberduck.sk</div>
        <button
          type="button"
          onClick={toggleResultPanel}
          className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          aria-label={translate("common.codeJsonView")}
          title={translate("common.codeJsonView")}
        >
          <Monitor className="h-[18px] w-[18px]" />
        </button>
      </nav>

      <header className="xl:hidden flex shrink-0 items-center justify-between px-4 py-4">
        <h1 className="text-xl font-semibold tracking-tight text-white">{translate("app.brandName")}</h1>
        <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] backdrop-blur-xl">
          <span className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            LIVE
          </span>
          <span className="border-l border-white/10 px-2.5 py-1 text-[10px] font-medium text-zinc-400">
            {translate("app.brandTop")}
          </span>
        </div>
      </header>

      <div className="hidden xl:block">
        <WorkflowToolbar
          workflowName={workflowName}
          onWorkflowNameChange={setWorkflowName}
          onRun={studioMode === "simple" ? handleSimpleRun : handleRun}
          onSave={handleSave}
          onLoad={handleLoad}
          onReset={handleReset}
          onAddNode={handleAddNode}
          onToggleJson={toggleResultPanel}
          onMagicPrompt={handleMagicPrompt}
          onExport={handleExport}
          isRunning={isRunning}
          dryRun={false}
          canExport={canExport}
          isGeneratingPrompt={isGeneratingPrompt}
        />
      </div>

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden px-4 pb-3 xl:p-5">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1800px] flex-col gap-4 xl:grid xl:grid-cols-12">
          <div className="flex min-h-0 flex-col gap-4 xl:col-span-8">
	            <section className={`${GLASS_PANEL} shrink-0 p-3 xl:p-6`}>
	              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-white xl:text-xl">{translate("app.headline")}</h2>
                  <p className="mt-1 text-sm font-light text-zinc-400">{translate("app.subheadline")}</p>
                </div>
	                <div className="flex flex-wrap items-center gap-2">
	                  <div className="inline-flex w-fit rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl" aria-label={translate("autopilot.modeLabel")}>
	                    <button
	                      type="button"
	                      onClick={() => setStudioMode("simple")}
	                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
	                        studioMode === "simple" ? "bg-white text-black" : "text-zinc-400 hover:bg-white/5 hover:text-white"
	                      }`}
	                    >
	                      {translate("autopilot.simpleMode")}
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => setStudioMode("advanced")}
	                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
	                        studioMode === "advanced" ? "bg-white text-black" : "text-zinc-400 hover:bg-white/5 hover:text-white"
	                      }`}
	                    >
	                      {translate("autopilot.advancedMode")}
	                    </button>
	                  </div>
	                  <div className="inline-flex w-fit rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl" aria-label={translate("autopilot.engineLabel")}>
	                    <button
	                      type="button"
	                      onClick={() => setGenerationEngine("local")}
	                      title={translate("autopilot.engineHintLocal")}
	                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
	                        generationEngine === "local" ? "bg-white text-black" : "text-zinc-400 hover:bg-white/5 hover:text-white"
	                      }`}
	                    >
	                      {translate("autopilot.engineLocal")}
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => setGenerationEngine("architect")}
	                      title={translate("autopilot.engineHintArchitect")}
	                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
	                        generationEngine === "architect" ? "bg-emerald-300 text-black" : "text-emerald-200 hover:bg-white/5 hover:text-white"
	                      }`}
	                    >
	                      {translate("autopilot.engineArchitect")}
	                    </button>
	                  </div>
	                </div>
              </div>

	              {studioMode === "simple" ? (
	                <div className="mt-4 space-y-3 xl:mt-6 xl:space-y-5">
	                  <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,box-shadow] focus-within:border-white/20 focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_60px_rgba(255,255,255,0.055)] sm:p-4 xl:p-5">
	                    <label htmlFor="autopilot-prompt" className="mb-2 block text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 xl:mb-3 xl:text-xs">
	                      {translate("autopilot.promptLabel")}
	                    </label>
	                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end xl:gap-3">
	                      <textarea
                        id="autopilot-prompt"
                        value={simplePrompt}
                        onChange={(event) => setSimplePrompt(event.target.value)}
                        rows={3}
                        placeholder={translate("autopilot.placeholder")}
	                        className="min-h-[64px] flex-1 resize-none bg-transparent text-lg font-semibold leading-tight tracking-tight text-white outline-none placeholder:text-zinc-700 sm:min-h-[92px] sm:text-3xl xl:min-h-[116px] xl:text-4xl"
	                      />
                      <button
                        type="button"
                        onClick={handleSimpleRun}
	                        disabled={isStudioBusy}
	                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-[0_18px_45px_rgba(255,255,255,0.12)] transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50 xl:h-12"
                      >
                        <Play className="h-4 w-4" />
	                        {isRunning
                            ? translate("common.running")
                            : isPreparingAutopilot
                              ? translate("autopilot.workingTitle")
                              : translate("autopilot.generateAll")}
                      </button>
                    </div>
	                    <p className="mt-2 line-clamp-1 text-[11px] leading-relaxed text-zinc-500 sm:line-clamp-2 xl:mt-3 xl:text-xs">{translate("autopilot.helper")}</p>
	                  </div>

		                  <div className="hidden gap-3 xl:grid xl:grid-cols-[1.15fr_0.85fr]">
		                    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 xl:p-4">
		                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 xl:mb-3 xl:text-xs">{translate("autopilot.aiWillInfer")}</div>
		                      <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400 xl:line-clamp-none xl:text-sm">{translate("autopilot.internalSummary")}</p>
		                      <div className="mt-3 flex flex-wrap gap-2 xl:mt-4">
	                        {[projectTypeLabel, translate("autopilot.fieldStructure"), translate("autopilot.fieldTone"), translate("autopilot.seo"), translate("autopilot.fieldWordPress")].map((item) => (
	                          <span key={item} className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-medium text-zinc-300">
	                            {item}
	                          </span>
	                        ))}
	                      </div>
	                    </div>

	                    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 xl:p-4" aria-live="polite">
	                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 xl:mb-3 xl:text-xs">{translate("autopilot.workingTitle")}</div>
	                      <div className="grid grid-cols-2 gap-1.5 xl:block xl:space-y-2">
	                        {autopilotPhases.map((phase, index) => (
	                          <div key={phase.label} className="flex min-w-0 items-center gap-2 text-[10px] xl:text-xs">
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-colors ${
                                phase.done
                                  ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-200"
                                  : isRunning && autopilotPhases.findIndex((item) => !item.done) === index
                                    ? "border-white/20 bg-white/10 text-white animate-pulse"
                                    : "border-white/10 text-zinc-600"
                              }`}
                            >
                              {phase.done ? "✓" : "·"}
                            </span>
	                            <span className={`truncate ${phase.done ? "text-zinc-200" : "text-zinc-500"}`}>{phase.label}</span>
	                          </div>
	                        ))}
	                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3 xl:gap-4">
                  <div>
                    <label htmlFor="brief-project-type" className="mb-1.5 block text-xs font-medium text-zinc-400">
                      {translate("app.projectType")}
                    </label>
                    <ProjectTypeSelector
                      id="brief-project-type"
                      ariaLabel={translate("app.projectType")}
                      value={brief.projectType as ProjectType}
                      onChange={(projectType) => setBrief((b) => ({ ...b, projectType }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="brief-project-name" className="mb-1.5 block text-xs font-medium text-zinc-400">
                      {translate("app.projectName")}
                    </label>
                    <input
                      id="brief-project-name"
                      className={FIELD_CLASS}
                      value={brief.projectName}
                      onChange={(e) => setBrief((b) => ({ ...b, projectName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="brief-target-audience" className="mb-1.5 block text-xs font-medium text-zinc-400">
                      {translate("app.targetAudience")}
                    </label>
                    <input
                      id="brief-target-audience"
                      className={FIELD_CLASS}
                      value={brief.targetAudience}
                      onChange={(e) => setBrief((b) => ({ ...b, targetAudience: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="brief-goal" className="mb-1.5 block text-xs font-medium text-zinc-400">
                      {translate("app.goal")}
                    </label>
                    <input
                      id="brief-goal"
                      className={FIELD_CLASS}
                      value={brief.goal}
                      onChange={(e) => setBrief((b) => ({ ...b, goal: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label htmlFor="brief-description" className="block text-xs font-medium text-zinc-400">
                        {translate("app.description")}
                      </label>
                      <button
                        type="button"
                        onClick={handleMagicPrompt}
                        disabled={isStudioBusy}
                        aria-label={translate("common.improvePrompt")}
                        title={translate("common.improvePrompt")}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-[10px] font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-50 xl:hidden"
                      >
                        <WandSparkles className="h-3.5 w-3.5" />
                        <span>{isGeneratingPrompt ? translate("app.magicPromptRunning") : translate("common.magicPrompt")}</span>
                      </button>
                    </div>
                    <textarea
                      id="brief-description"
                      className={`${FIELD_CLASS} min-h-11 resize-none py-2 xl:h-auto`}
                      rows={2}
                      value={brief.description}
                      onChange={(e) => setBrief((b) => ({ ...b, description: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="brief-preferred-tone" className="mb-1.5 block text-xs font-medium text-zinc-400">
                      {translate("app.preferredTone")}
                    </label>
                    <input
                      id="brief-preferred-tone"
                      className={FIELD_CLASS}
                      value={brief.preferredTone}
                      onChange={(e) => setBrief((b) => ({ ...b, preferredTone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="brief-contact-email" className="mb-1.5 block text-xs font-medium text-zinc-400">
                      {translate("app.contactEmail")}
                    </label>
                    <input
                      id="brief-contact-email"
                      type="email"
                      className={FIELD_CLASS}
                      value={brief.contactEmail ?? ""}
                      onChange={(e) => setBrief((b) => ({ ...b, contactEmail: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </section>

            <section className={`${GLASS_PANEL_SOFT} relative min-h-[260px] flex-1 overflow-hidden sm:min-h-[300px] xl:min-h-0`}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:18px_18px] opacity-40 xl:hidden" />
              <div className="relative h-full w-full">
                <LaunchCanvas
                  nodes={nodes as WorkflowNode[]}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={handleNodeClick}
                  timeline={timeline}
                  isRunning={isStudioBusy}
                  validationErrors={validationErrors}
                  generated={generated}
                  hasFreshGeneration={hasFreshGeneration}
                  canExport={canExport}
                  onShowPreview={() => showPreviewTab("visual")}
                  onExport={handleExport}
                />
              </div>
            </section>

            <section className="hidden shrink-0 gap-3 overflow-x-auto pb-1 snap-x [scrollbar-width:none] [-ms-overflow-style:none] sm:flex xl:hidden [&::-webkit-scrollbar]:hidden">
              <article className={`${GLASS_PANEL_SOFT} w-52 shrink-0 snap-start p-4`}>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                  <Database className="h-3 w-3 text-blue-400" />
                  {translate("inspector.launchSummary")}
                </h4>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">{translate("inspector.projectType")}:</span>
                    <span className="font-medium text-zinc-300">{projectTypeLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">{translate("inspector.complianceStatus")}:</span>
                    <span className={compliancePassed ? "font-medium text-emerald-300" : "font-medium text-amber-300"}>
                      {compliancePassed ? translate("inspector.passed") : translate("inspector.pendingFailed")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">{translate("inspector.exportReadiness")}:</span>
                    <span className={canExport ? "font-medium text-emerald-300" : "font-medium text-zinc-300"}>
                      {canExport ? translate("inspector.ready") : translate("inspector.blocked")}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleImportDryRun}
                  disabled={!compliancePassed || !generated}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.035] px-2 py-2 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {translate("app.prepareWpImport")}
                </button>
              </article>

              {showJson ? (
                <article className={`${GLASS_PANEL_SOFT} flex w-52 shrink-0 snap-start flex-col justify-between p-4`}>
                  <div>
                    <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                      <FileJson className="h-3 w-3 text-purple-400" />
                      {translate("jsonPreview.title")}
                    </h4>
                    <p className="text-[9px] leading-tight text-zinc-500">{translate("jsonPreview.metaboxNotice")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={!canExport}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.035] py-2 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {translate("common.exportJson")}
                  </button>
                </article>
              ) : null}

              <article className={`${GLASS_PANEL_SOFT} w-52 shrink-0 snap-start p-4`}>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                  <Activity className="h-3 w-3 text-orange-400" />
                  {translate("timeline.title")}
                </h4>
                <p className="line-clamp-3 text-[10px] text-zinc-400">{latestEventText}</p>
              </article>
            </section>

	            <section
                ref={mobileResultRef}
	              className={`${GLASS_PANEL_SOFT} overflow-auto p-3 xl:hidden ${
                  generated || activePreviewTab === "history"
                    ? "fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-40 max-h-[58dvh] border-emerald-300/25"
                    : hasFreshGeneration
                      ? "result-reveal-card max-h-52 border-emerald-300/35"
                      : "max-h-28"
                } ${(showJson && (generated || generationHistory.length > 0)) || validationErrors.length > 0 || violations.length > 0 || importMessage ? "block" : "hidden"}`}
	              aria-live="polite"
	            >
              <div className="text-[10px] text-emerald-300">LIVE mode active. Real user inputs required.</div>
              {hasFreshGeneration && generated ? (
                <div className="mb-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-[10px] text-emerald-50">
                  <div className="font-semibold">{translate("app.resultRevealTitle")}</div>
                  <p className="mt-1 text-emerald-100/80">{translate("app.resultRevealBody")}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleShowJsonTab}
                      className="rounded-full border border-emerald-200/25 bg-emerald-300/15 px-3 py-1 text-[10px] font-semibold text-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/45"
                      aria-label={translate("app.showJson")}
                    >
                      {translate("app.showJson")}
                    </button>
                    <button
                      type="button"
                      onClick={handleExport}
                      disabled={!canExport}
                      className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label={translate("common.exportJson")}
                      title={canExport ? translate("common.exportJson") : translate("app.exportUnavailable")}
                    >
                      {translate("common.exportJson")}
                    </button>
                  </div>
                </div>
              ) : null}
              {violations.length > 0 ? (
                <div className="mt-1 text-[10px] text-rose-400">
                  {translate("app.complianceViolations")}: {violations.join(", ")}
                </div>
              ) : null}
              {validationErrors.length > 0 ? (
                <div className="mt-1 text-[10px] text-amber-300">
                  {translate("app.validationErrors")}: {validationErrors.join(", ")}
                </div>
              ) : null}
              {importMessage ? <div className="mt-1 text-[10px] text-zinc-300">{importMessage}</div> : null}
              {generated || generationHistory.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <PreviewTabs activeTab={activePreviewTab} onChange={handlePreviewTabsChange} />
                  <div
                    id={`preview-panel-${activePreviewTab}`}
                    role="tabpanel"
                    aria-labelledby={`preview-tab-${activePreviewTab}`}
                    className="min-h-0"
                  >
                    {activePreviewTab === "visual" ? (
                      <VisualResultPreview
                        payload={generated}
                        canExport={canExport}
                        onExport={handleExport}
                        onShowJson={handleShowJsonTab}
                        highlight={hasFreshGeneration}
                      />
                    ) : null}
                    {activePreviewTab === "json" ? (
                      <JsonPreview data={generated} blocked={!canExport} onExport={handleExport} lastSavedAt={lastSavedAt} highlight={hasFreshGeneration} />
                    ) : null}
                    {activePreviewTab === "payload" ? payloadPreviewPanel : null}
                    {activePreviewTab === "history" ? historyPanel : null}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="hidden min-h-0 flex-col gap-3 overflow-hidden xl:col-span-4 xl:flex">
            <div className="min-h-[220px] overflow-auto">
              <NodeInspector
                node={selectedNode}
                projectType={activeBrief.projectType}
                dryRun={false}
                compliancePassed={compliancePassed}
                canExport={canExport}
                lastRunAt={lastRunAt}
              />
            </div>
            <div className="min-h-[120px] overflow-auto">
              <ExecutionTimeline events={timeline} />
            </div>
            {showJson ? (
              <div ref={desktopJsonRef} className="min-h-[230px] overflow-auto">
                <div className="space-y-3">
                  <PreviewTabs activeTab={activePreviewTab} onChange={handlePreviewTabsChange} />
                  <div
                    id={`preview-panel-${activePreviewTab}`}
                    role="tabpanel"
                    aria-labelledby={`preview-tab-${activePreviewTab}`}
                  >
                    {activePreviewTab === "visual" ? (
                      <VisualResultPreview
                        payload={generated}
                        canExport={canExport}
                        onExport={handleExport}
                        onShowJson={handleShowJsonTab}
                        highlight={hasFreshGeneration}
                      />
                    ) : null}
                    {activePreviewTab === "json" ? (
                      <JsonPreview data={generated} blocked={!canExport} onExport={handleExport} lastSavedAt={lastSavedAt} highlight={hasFreshGeneration} />
                    ) : null}
                    {activePreviewTab === "payload" ? payloadPreviewPanel : null}
                    {activePreviewTab === "history" ? historyPanel : null}
                  </div>
                </div>
              </div>
            ) : null}
            <div className={`${GLASS_PANEL_SOFT} p-4`}>
              <button
                type="button"
                onClick={handleImportDryRun}
                disabled={!compliancePassed || !generated}
                className="w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-40"
              >
                {translate("app.prepareWpImport")}
              </button>
              <div className="mt-2 text-xs text-emerald-300">LIVE mode active. Real user inputs required.</div>
              {violations.length > 0 ? (
                <div className="mt-2 text-xs text-rose-400">
                  {translate("app.complianceViolations")}: {violations.join(", ")}
                </div>
              ) : null}
              {validationErrors.length > 0 ? (
                <div className="mt-2 text-xs text-amber-300">
                  {translate("app.validationErrors")}: {validationErrors.join(", ")}
                </div>
              ) : null}
              {importMessage ? <div className="mt-2 text-xs text-zinc-300">{importMessage}</div> : null}
            </div>
          </aside>
        </div>
      </main>

      <footer
        className="xl:hidden shrink-0 border-t border-white/10 bg-black/85 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur-2xl"
        aria-label={translate("app.mobileActionBarLabel")}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (studioMode === "simple") {
                handleSimpleRun();
                return;
              }
              void handleRun();
            }}
            disabled={isStudioBusy}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-50 px-4 text-sm font-semibold text-black shadow-[0_18px_45px_rgba(255,255,255,0.12)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            <span>{isRunning ? translate("common.running") : isPreparingAutopilot ? translate("autopilot.workingTitle") : translate("common.run")}</span>
          </button>
          <button
            type="button"
            onClick={handleMagicPrompt}
            disabled={isStudioBusy}
            aria-label={translate("common.improvePrompt")}
            title={translate("common.improvePrompt")}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-200 transition-colors hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <WandSparkles className={isGeneratingPrompt ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          </button>
          <button
            type="button"
            onClick={toggleResultPanel}
            aria-label={translate("common.preview")}
            title={translate("common.preview")}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          >
            <Compass className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!canExport}
            aria-label={translate("common.exportJson")}
            title={translate("common.exportJson")}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {hasFreshGeneration
            ? translate("app.resultReadyA11y")
            : isGeneratingPrompt
              ? translate("app.magicPromptRunning")
              : isPreparingAutopilot
                ? translate("autopilot.workingTitle")
                : importMessage}
        </p>
      </footer>
    </div>
  );
}

export function LaunchStudioApp() {
  return (
    <ReactFlowProvider>
      <LaunchStudioInner />
    </ReactFlowProvider>
  );
}
