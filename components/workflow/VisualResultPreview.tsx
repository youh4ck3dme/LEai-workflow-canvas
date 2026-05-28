"use client";

import { ArrowUpRight, CheckCircle2, Download, FileJson, Lock, Search, ShieldAlert, Tag } from "lucide-react";
import type { SourceOfTruthExport } from "@/lib/launch-studio/source-of-truth-schema";
import { validateSourceOfTruthExport } from "@/lib/launch-studio/validation";
import { containsForbiddenClaims, containsForbiddenHtml, containsPlaceholderText, isPlaceholderUrl } from "@/lib/launch-studio/content-format";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { getMarkdownSafetyErrors, SafeMarkdown } from "@/components/workflow/SafeMarkdown";

interface VisualResultPreviewProps {
  payload: unknown;
  canExport: boolean;
  onExport: () => void;
  onShowJson: () => void;
  highlight?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSafeLink(value: string): string {
  if (value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("https://")) {
    return value;
  }
  return "#kontakt";
}

function getPreviewErrors(payload: unknown): string[] {
  const validation = validateSourceOfTruthExport(payload);
  const errors = [...validation.errors];

  if (!isRecord(payload)) {
    return Array.from(new Set([...errors, "payload_missing"]));
  }

  const wordpress = isRecord(payload.wordpress) ? payload.wordpress : null;
  const main = isRecord(wordpress?.main) ? wordpress.main : null;
  const media = isRecord(wordpress?.media) ? wordpress.media : null;
  const editor = typeof main?.editor === "string" ? main.editor : "";

  if (editor && getMarkdownSafetyErrors(editor).length > 0) {
    errors.push("editor_not_safe_for_preview");
  }

  const searchable = JSON.stringify({ wordpress: payload.wordpress, seo: payload.seo, faq: payload.faq });
  if (containsForbiddenHtml(searchable)) errors.push("forbidden_html_detected");
  if (containsPlaceholderText(searchable)) errors.push("placeholder_text_detected");
  if (containsForbiddenClaims(searchable)) errors.push("forbidden_claim_detected");

  for (const key of ["video", "icon", "image"] as const) {
    const value = media?.[key];
    if (typeof value === "string" && isPlaceholderUrl(value)) errors.push(`placeholder_${key}_url`);
  }

  return Array.from(new Set(errors));
}

function formatNullableNumber(value: number | null, suffix = ""): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value}${suffix}`;
}

export function VisualResultPreview({ payload, canExport, onExport, onShowJson, highlight = false }: VisualResultPreviewProps) {
  const { translate } = useI18n();
  const errors = getPreviewErrors(payload);

  if (!payload) {
    return (
      <section className="rounded-[1.35rem] border border-white/10 bg-white/[0.035] p-5 text-sm text-zinc-400">
        <div className="font-semibold text-white">{translate("preview.visual")}</div>
        <p className="mt-2 leading-relaxed">{translate("preview.empty")}</p>
      </section>
    );
  }

  if (errors.length > 0) {
    return (
      <section className="rounded-[1.35rem] border border-amber-300/25 bg-amber-950/20 p-5 text-sm text-amber-100">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" />
          {translate("preview.blocked")}
        </div>
        <p className="mt-2 text-amber-100/80">{translate("preview.validationBlocked")}</p>
        <ul className="mt-3 max-h-32 list-disc overflow-auto pl-5 text-xs text-amber-100/75">
          {errors.slice(0, 8).map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </section>
    );
  }

  const data = payload as SourceOfTruthExport;
  const main = data.wordpress.main;
  const post = data.wordpress.post;
  const media = data.wordpress.media;
  const services = data.wordpress.services;
  const products = data.wordpress.products;
  const safeCta = getSafeLink(main.link);
  const hasImage = typeof media.image === "string" && media.image.length > 0 && !isPlaceholderUrl(media.image);

  return (
    <section
      className={cn(
        "rounded-[1.35rem] border bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_70px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-5",
        highlight ? "result-reveal-card border-emerald-300/40" : "border-white/10"
      )}
      aria-label={translate("preview.visual")}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">{translate("preview.safeNotice")}</div>
          <h3 className="mt-1 text-sm font-semibold text-white">{translate("preview.ready")}</h3>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onShowJson}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          >
            <FileJson className="h-3.5 w-3.5" />
            {translate("app.showJson")}
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-100/60 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="h-3.5 w-3.5" />
            {translate("common.exportJson")}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black/45">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="p-5 sm:p-7">
            <div className="mb-4 flex flex-wrap gap-2">
              {post.section.map((section) => (
                <span key={section} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                  {section}
                </span>
              ))}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{main.title}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">{main.tagline}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href={safeCta} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-100">
                {main.label}
                <ArrowUpRight className="h-4 w-4" />
              </a>
              <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <Lock className="h-3.5 w-3.5" />
                {translate("preview.wordpressRenders")}
              </span>
            </div>
          </div>
          <div className="border-t border-white/10 p-5 lg:border-l lg:border-t-0">
            {hasImage ? (
              <a href={media.image ?? "#"} className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-emerald-200">
                {media.image}
              </a>
            ) : (
              <div className="grid min-h-56 place-items-center rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_30%_20%,rgba(52,211,153,0.22),transparent_34%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.08),transparent_30%),rgba(255,255,255,0.025)]">
                <div className="text-center">
                  <div className="mx-auto h-12 w-12 rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_0_60px_rgba(52,211,153,0.18)]" />
                  <p className="mt-3 text-xs text-zinc-500">{translate("preview.noMedia")}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-white/10 p-5 sm:p-7">
          <p className="max-w-3xl text-sm leading-7 text-zinc-300">{main.context}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {post.topic.map((topic) => (
              <span key={topic} className="inline-flex items-center gap-1 rounded-full border border-emerald-300/15 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                <Tag className="h-3 w-3" />
                {topic}
              </span>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 p-5 sm:p-7">
          <SafeMarkdown value={main.editor} />
        </div>

        {services.length > 0 ? (
          <div className="border-t border-white/10 p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-white">{translate("preview.services")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {services.map((service, index) => {
                const price = formatNullableNumber(service.price, " €");
                const duration = formatNullableNumber(service.duration, " h");
                return (
                  <article key={`${service.type.join("-")}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="font-semibold text-white">{service.type.join(", ")}</div>
                    <p className="mt-1 text-xs text-zinc-500">{service.category.join(", ")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {service.badge.map((badge) => (
                        <span key={badge} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] text-zinc-300">
                          {badge}
                        </span>
                      ))}
                    </div>
                    {price || duration || service.datetime ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                        {price ? <span>{price}</span> : null}
                        {duration ? <span>{duration}</span> : null}
                        {service.datetime ? <span>{service.datetime}</span> : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {products.length > 0 ? (
          <div className="border-t border-white/10 p-5 sm:p-7">
            <h2 className="text-lg font-semibold text-white">{translate("preview.products")}</h2>
            <div className="mt-3 text-sm text-zinc-400">{translate("preview.productsPresent")}</div>
          </div>
        ) : null}

        <div className="border-t border-white/10 p-5 sm:p-7">
          <h2 className="text-lg font-semibold text-white">FAQ</h2>
          <div className="mt-4 space-y-3">
            {data.faq.map((item) => (
              <article key={item.question} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <h3 className="text-sm font-semibold text-zinc-100">{item.question}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{item.answer}</p>
              </article>
            ))}
          </div>
        </div>

        <div id="kontakt" className="border-t border-white/10 p-5 sm:p-7">
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-5">
            <div className="text-lg font-semibold text-white">{main.label}</div>
            <p className="mt-2 text-sm text-emerald-50/75">{data.project.contactEmail}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-black/35 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            <Search className="h-3.5 w-3.5" />
            SEO
          </div>
          <h3 className="text-sm font-semibold text-white">{data.seo.title}</h3>
          <p className="mt-2 text-xs leading-5 text-zinc-400">{data.seo.description}</p>
          <p className="mt-3 text-xs text-zinc-500">OG: {data.seo.ogTitle}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-black/35 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Compliance
          </div>
          <div className={data.compliance.passed ? "text-sm font-semibold text-emerald-200" : "text-sm font-semibold text-amber-200"}>
            {data.compliance.passed ? translate("preview.compliancePassed") : translate("preview.complianceFailed")}
          </div>
          {data.compliance.violations.length > 0 ? <p className="mt-2 text-xs text-amber-200">{data.compliance.violations.join(", ")}</p> : null}
        </article>
      </div>
    </section>
  );
}
