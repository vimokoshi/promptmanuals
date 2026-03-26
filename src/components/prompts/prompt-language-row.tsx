"use client";

import Link from "next/link";
import { Globe } from "lucide-react";

const PROMPT_LANGUAGES = [
  { code: "en", label: "EN", name: "English" },
  { code: "es", label: "ES", name: "Español" },
  { code: "zh", label: "ZH", name: "中文" },
  { code: "ja", label: "JA", name: "日本語" },
  { code: "de", label: "DE", name: "Deutsch" },
  { code: "fr", label: "FR", name: "Français" },
  { code: "pt", label: "PT", name: "Português" },
  { code: "ko", label: "KO", name: "한국어" },
  { code: "tr", label: "TR", name: "Türkçe" },
  { code: "ar", label: "AR", name: "العربية" },
  { code: "ru", label: "RU", name: "Русский" },
  { code: "hi", label: "HI", name: "हिन्दी" },
  { code: "bn", label: "BN", name: "বাংলা" },
  { code: "ta", label: "TA", name: "தமிழ்" },
  { code: "te", label: "TE", name: "తెలుగు" },
  { code: "mr", label: "MR", name: "मराठी" },
  { code: "gu", label: "GU", name: "ગુજరાతી" },
];

interface PromptLanguageRowProps {
  currentLocale: string;
  promptId: string;
  promptSlug: string;
  translations: Record<string, { title?: string }> | null;
}

export function PromptLanguageRow({
  currentLocale,
  promptId,
  promptSlug,
  translations,
}: PromptLanguageRowProps) {
  // Only show languages that have actual translated content
  const availableLangs = PROMPT_LANGUAGES.filter(
    (lang) => lang.code === "en" || translations?.[lang.code]?.title,
  );

  if (availableLangs.length <= 1) return null;

  const baseSlug = `${promptId}_${promptSlug}`;

  return (
    <div className="flex flex-col gap-1.5 pt-3 border-t">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
        <Globe className="h-3.5 w-3.5" />
        <span>Available in</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {availableLangs.map((lang) => {
          const href =
            lang.code === "en"
              ? `/prompts/${baseSlug}`
              : `/prompts/${baseSlug}/${lang.code}`;
          const isActive = currentLocale === lang.code;
          return (
            <Link
              key={lang.code}
              href={href}
              title={lang.name}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                isActive
                  ? "bg-[var(--purple,#9B1FCC)]/10 border-[var(--purple,#9B1FCC)]/30 text-[var(--purple,#9B1FCC)]"
                  : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {lang.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
