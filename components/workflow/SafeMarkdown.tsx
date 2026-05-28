"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { containsForbiddenClaims, containsForbiddenHtml, containsPlaceholderText } from "@/lib/launch-studio/content-format";

interface SafeMarkdownProps {
  value: string;
}

const ALLOWED_ELEMENTS = ["h1", "h2", "h3", "p", "ul", "ol", "li", "strong", "em", "a", "br"];

function isSafeHref(href: string | undefined): href is string {
  if (!href) return false;
  return href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("https://");
}

export function getMarkdownSafetyErrors(value: string): string[] {
  const errors: string[] = [];
  if (containsForbiddenHtml(value)) errors.push("forbidden_html");
  if (containsPlaceholderText(value)) errors.push("placeholder_text");
  if (containsForbiddenClaims(value)) errors.push("forbidden_claim");
  return errors;
}

export function SafeMarkdown({ value }: SafeMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      components={{
        h1: ({ children }) => <h2 className="mt-6 text-2xl font-semibold tracking-tight text-white first:mt-0">{children}</h2>,
        h2: ({ children }) => <h2 className="mt-6 text-xl font-semibold tracking-tight text-white first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mt-5 text-base font-semibold text-zinc-100">{children}</h3>,
        p: ({ children }) => <p className="mt-3 text-sm leading-7 text-zinc-300">{children}</p>,
        ul: ({ children }) => <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-300">{children}</ul>,
        ol: ({ children }) => <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-300">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
        em: ({ children }) => <em className="text-zinc-200">{children}</em>,
        a: ({ children, href }) => {
          if (!isSafeHref(href)) {
            return <span className="text-zinc-300">{children}</span>;
          }
          return (
            <a href={href} className="font-medium text-emerald-200 underline decoration-emerald-300/30 underline-offset-4" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {value}
    </ReactMarkdown>
  );
}
