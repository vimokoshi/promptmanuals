"use client";

import { useState } from "react";
import { toast } from "sonner";

// ── Design tokens (Prompt Manuals brand) ────────────────────────────────────
// These reference CSS custom properties defined in globals.css (:root).
// Inline styles in React require string literals, so we mirror the vars here.
// The canonical source of truth is globals.css — update both together.
const PM_PURPLE        = "var(--pm-purple)";
const PM_CORAL         = "var(--pm-coral)";
const PM_PURPLE_TINT   = "var(--pm-purple-tint)";
const PM_PURPLE_BORDER = "var(--pm-purple-border)";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Describes a single AI or code platform the user can test a prompt with.
 *
 * One of three launch strategies must be defined:
 * - `qParam + baseUrl` — appends encoded prompt to the URL
 * - `copyAndOpen`      — copies to clipboard, then opens baseUrl in a new tab
 * - `copyOnly`         — copies to clipboard only (IDE tools)
 */
interface Platform {
  /** Unique machine-readable identifier. */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** CSS background value for the logo badge (brand colour or gradient). */
  readonly bg: string;
  /** Foreground/text colour on the logo badge. */
  readonly fg: string;
  /** Short label displayed inside the logo badge (1–3 chars or emoji). */
  readonly label: string;
  /** When true the label font-size is reduced to fit longer labels like "v0". */
  readonly smallLabel?: boolean;
  /** Root URL for the platform. Required unless `copyOnly` is true. */
  readonly baseUrl?: string;
  /**
   * Query-string prefix appended before the URL-encoded prompt.
   * e.g. `"/?q="` → `https://chatgpt.com/?q=<encoded>`
   */
  readonly qParam?: string;
  /**
   * Copy prompt to clipboard then open `baseUrl`.
   * Used when the platform has no URL-based prompt injection.
   */
  readonly copyAndOpen?: boolean;
  /**
   * Copy prompt to clipboard only.
   * Used for IDE tools that read from the system clipboard.
   */
  readonly copyOnly?: boolean;
}

/** Identifies which content tab is currently active in the sidebar. */
type SidebarTab = "ai" | "code";

// ── Platform definitions ─────────────────────────────────────────────────────

const AI_MAINSTREAM: readonly Platform[] = [
  { id: "chatgpt",    name: "ChatGPT",      bg: "#10a37f", fg: "#fff", label: "G",  baseUrl: "https://chatgpt.com",                       qParam: "/?q=" },
  { id: "claude",     name: "Claude",       bg: "#c2612a", fg: "#fff", label: "C",  baseUrl: "https://claude.ai/new",                     qParam: "?q=" },
  { id: "gemini",     name: "Gemini",       bg: "linear-gradient(135deg,#4285f4,#ea4335)", fg: "#fff", label: "✦", baseUrl: "https://gemini.google.com/app", copyAndOpen: true },
  { id: "grok",       name: "Grok",         bg: "#1a1a1a", fg: "#fff", label: "𝕏",  baseUrl: "https://grok.com/chat?reasoningMode=none",   qParam: "&q=" },
  { id: "copilot",    name: "Copilot",      bg: "#0078d4", fg: "#fff", label: "◈",  baseUrl: "https://copilot.microsoft.com",              copyAndOpen: true },
  { id: "perplexity", name: "Perplexity",   bg: "#20b8cd", fg: "#fff", label: "◎",  baseUrl: "https://www.perplexity.ai",                  qParam: "/search?q=" },
  { id: "meta",       name: "Meta AI",      bg: "#0866ff", fg: "#fff", label: "f",  baseUrl: "https://www.meta.ai",                        copyAndOpen: true },
  { id: "deepseek",   name: "DeepSeek",     bg: "#1a6eff", fg: "#fff", label: "D",  baseUrl: "https://chat.deepseek.com",                  copyAndOpen: true },
  { id: "mistral",    name: "Mistral",      bg: "#ff6b35", fg: "#fff", label: "▲",  baseUrl: "https://chat.mistral.ai/chat",               qParam: "?q=" },
] as const;

const AI_MORE: readonly Platform[] = [
  { id: "poe",        name: "Poe",          bg: "#7c3aed", fg: "#fff", label: "P",  baseUrl: "https://poe.com",                            copyAndOpen: true },
  { id: "you",        name: "You.com",      bg: "#e94057", fg: "#fff", label: "Y",  baseUrl: "https://you.com",                            qParam: "/search?q=" },
  { id: "phind",      name: "Phind",        bg: "#5b5bd6", fg: "#fff", label: "φ",  baseUrl: "https://www.phind.com",                      qParam: "/search?q=" },
  { id: "groq",       name: "Groq",         bg: "#f55036", fg: "#fff", label: "⚡", baseUrl: "https://groq.com",                            copyAndOpen: true },
  { id: "hf",         name: "HuggingChat",  bg: "#ff9d00", fg: "#fff", label: "🤗", baseUrl: "https://huggingface.co/chat",                copyAndOpen: true },
  { id: "pi",         name: "Pi",           bg: "#14b8a6", fg: "#fff", label: "π",  baseUrl: "https://pi.ai",                              copyAndOpen: true },
  { id: "kagi",       name: "Kagi",         bg: "#2563eb", fg: "#fff", label: "K",  baseUrl: "https://kagi.com",                           copyAndOpen: true },
  { id: "cohere",     name: "Cohere",       bg: "#39d353", fg: "#000", label: "~",  baseUrl: "https://coral.cohere.com",                   copyAndOpen: true },
  { id: "amazonq",    name: "Amazon Q",     bg: "#ff9900", fg: "#000", label: "Q",  baseUrl: "https://aws.amazon.com/q",                   copyAndOpen: true },
] as const;

const CODE_BUILDERS: readonly Platform[] = [
  { id: "bolt",       name: "Bolt.new",       bg: "#1c1c1c", fg: "#fff", label: "⚡", baseUrl: "https://bolt.new",          qParam: "?prompt=" },
  { id: "v0",         name: "v0 by Vercel",   bg: "#000",    fg: "#fff", label: "v0", smallLabel: true, baseUrl: "https://v0.dev/chat", qParam: "?q=" },
  { id: "lovable",    name: "Lovable",        bg: "#ff4d6d", fg: "#fff", label: "♥",  baseUrl: "https://lovable.dev",       qParam: "/?autosubmit=true#prompt=" },
  { id: "replit",     name: "Replit",         bg: "#f26207", fg: "#fff", label: "R",  baseUrl: "https://replit.com",        copyAndOpen: true },
  { id: "stackblitz", name: "StackBlitz",     bg: "#1374ef", fg: "#fff", label: "⚡", baseUrl: "https://stackblitz.com",    copyAndOpen: true },
  { id: "csb",        name: "CodeSandbox",    bg: "#151515", fg: "#fff", label: "⬡",  baseUrl: "https://codesandbox.io",    copyAndOpen: true },
  { id: "create",     name: "Create.xyz",     bg: "#7c3aed", fg: "#fff", label: "✦",  baseUrl: "https://www.create.xyz",    copyAndOpen: true },
  { id: "tempo",      name: "Tempo Labs",     bg: "#0ea5e9", fg: "#fff", label: "T",  baseUrl: "https://www.tempolabs.ai",  copyAndOpen: true },
  { id: "devin",      name: "Devin",          bg: "#0f172a", fg: "#fff", label: "D",  baseUrl: "https://devin.ai",          copyAndOpen: true },
] as const;

const CODE_IDE: readonly Platform[] = [
  { id: "cursor",   name: "Cursor",         bg: "#1a1a1a", fg: "#fff", label: "◻",  copyOnly: true },
  { id: "windsurf", name: "Windsurf",       bg: "#00d4aa", fg: "#000", label: "W",  copyOnly: true },
  { id: "ghcopilot",name: "GitHub Copilot", bg: "#24292e", fg: "#fff", label: "⬡",  copyOnly: true },
  { id: "zed",      name: "Zed",            bg: "#084cdf", fg: "#fff", label: "Z",  copyOnly: true },
  { id: "jb",       name: "JetBrains AI",   bg: "#fe315d", fg: "#fff", label: "J",  copyOnly: true },
  { id: "ccode",    name: "Claude Code",    bg: "#c2612a", fg: "#fff", label: "C",  copyOnly: true },
  { id: "tabnine",  name: "Tabnine",        bg: "#6b21a8", fg: "#fff", label: "T",  copyOnly: true },
  { id: "codeium",  name: "Codeium",        bg: "#09b6a2", fg: "#fff", label: "C",  copyOnly: true },
] as const;

// ── URL builder ──────────────────────────────────────────────────────────────

/**
 * Launches a prompt in the given platform.
 *
 * Handles three strategies:
 * 1. `copyOnly`    — writes to clipboard only (IDE tools)
 * 2. `copyAndOpen` — writes to clipboard then opens the platform URL
 * 3. URL injection — appends the encoded prompt as a query parameter
 */
async function launchPlatform(platform: Platform, content: string): Promise<void> {
  try {
    if (platform.copyOnly) {
      await navigator.clipboard.writeText(content);
      toast.success(`Copied — paste into ${platform.name}`);
      return;
    }

    if (platform.copyAndOpen) {
      await navigator.clipboard.writeText(content);
      toast.success(`Copied — opening ${platform.name}`);
      window.open(platform.baseUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (platform.qParam && platform.baseUrl) {
      const url = `${platform.baseUrl}${platform.qParam}${encodeURIComponent(content)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    toast.error(`Could not open ${platform.name}. Please try again.`);
  }
}

// ── Subcomponents ────────────────────────────────────────────────────────────

/** Coloured square badge displaying a platform's initial or symbol. */
function PlatformLogo({ platform, size = 22 }: { platform: Platform; size?: number }) {
  const radius = size <= 20 ? 4 : 5;
  const fontSize = platform.smallLabel ? 8 : size <= 20 ? 9 : 10;
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: radius,
        background: platform.bg, color: platform.fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize, fontWeight: 800, flexShrink: 0, lineHeight: 1,
      }}
    >
      {platform.label}
    </span>
  );
}

/** Desktop list row: logo + name + launch arrow (or copy badge for IDEs). */
function PlatformRow({ platform, content }: { platform: Platform; content: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={platform.copyOnly
        ? `Copy prompt for ${platform.name}`
        : `Open prompt in ${platform.name}`}
      onClick={() => void launchPlatform(platform, content)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%",
        padding: "7px 8px", borderRadius: 8, cursor: "pointer",
        background: hovered ? "var(--card)" : "transparent",
        border: "none", textAlign: "left", fontSize: 12, fontWeight: 500,
        color: hovered ? "var(--foreground)" : "var(--muted-foreground)",
        transition: "all .12s",
      }}
    >
      <PlatformLogo platform={platform} size={22} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {platform.name}
      </span>
      {platform.copyOnly ? (
        <span
          aria-hidden="true"
          style={{
            fontSize: 9, color: "var(--muted-foreground)", background: "var(--muted)",
            border: "1px solid var(--border)", padding: "1px 5px", borderRadius: 3, fontWeight: 600, flexShrink: 0,
          }}
        >📋</span>
      ) : (
        <span
          aria-hidden="true"
          style={{
            fontSize: 13, fontWeight: 700, flexShrink: 0,
            color: hovered ? PM_CORAL : "var(--border)",
            transform: hovered ? "translateX(4px)" : "none",
            display: "inline-block", transition: "color .18s, transform .22s ease",
          }}
        >↗</span>
      )}
    </button>
  );
}

/** Section heading label (uppercase, muted). */
function GroupLabel({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase",
        letterSpacing: ".8px", fontWeight: 700, padding: "8px 6px 4px",
      }}
    >
      {label}
    </div>
  );
}

/** Visual separator between platform groups. */
function PlatformDivider() {
  return <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 6px" }} />;
}

/** Mobile chip button showing a platform's logo and name. */
function PlatformChip({ platform, content }: { platform: Platform; content: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={platform.copyOnly
        ? `Copy prompt for ${platform.name}`
        : `Open prompt in ${platform.name}`}
      onClick={() => void launchPlatform(platform, content)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 11px", borderRadius: 20,
        background: hovered ? PM_PURPLE_TINT : "var(--card)",
        border: `1px solid ${hovered ? PM_PURPLE_BORDER : "var(--border)"}`,
        fontSize: 12, fontWeight: 600,
        color: hovered ? PM_PURPLE : "var(--muted-foreground)",
        cursor: "pointer", transition: "all .12s", flexShrink: 0,
      }}
    >
      <PlatformLogo platform={platform} size={20} />
      <span>{platform.name}</span>
    </button>
  );
}

/** Mobile 2-column grid button. */
function PlatformGridButton({ platform, content }: { platform: Platform; content: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={platform.copyOnly
        ? `Copy prompt for ${platform.name}`
        : `Open prompt in ${platform.name}`}
      onClick={() => void launchPlatform(platform, content)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "7px 9px", borderRadius: 8, cursor: "pointer",
        background: hovered ? PM_PURPLE_TINT : "var(--card)",
        border: `1px solid ${hovered ? PM_PURPLE_BORDER : "var(--border)"}`,
        fontSize: 11, fontWeight: 600,
        color: hovered ? PM_PURPLE : "var(--muted-foreground)",
        overflow: "hidden", transition: "all .12s",
      }}
    >
      <PlatformLogo platform={platform} size={20} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {platform.name}
      </span>
    </button>
  );
}

/** Animated status dot (coral pulse) indicating the sidebar is live. */
function StatusDot() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 6, height: 6, borderRadius: "50%",
        background: PM_CORAL, flexShrink: 0,
        animation: "pm-pulse 2s ease-in-out infinite",
      }}
    />
  );
}

interface TabButtonProps {
  tab: SidebarTab;
  activeTab: SidebarTab;
  emoji: string;
  label: string;
  onSelect: (tab: SidebarTab) => void;
}

/** Toggle button for switching between AI Chat and Code tabs. */
function TabButton({ tab, activeTab, emoji, label, onSelect }: TabButtonProps) {
  const isActive = activeTab === tab;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`sidebar-panel-${tab}`}
      onClick={() => onSelect(tab)}
      style={{
        padding: "7px 0", textAlign: "center", fontSize: 11, fontWeight: 700,
        color: isActive ? "#fff" : "var(--muted-foreground)",
        background: isActive ? PM_PURPLE : "transparent",
        border: "none", cursor: "pointer", transition: "all .15s",
      }}
    >
      {emoji} {label}
    </button>
  );
}

// ── Shared tab toggle bar ────────────────────────────────────────────────────

interface TabBarProps {
  activeTab: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
}

function TabBar({ activeTab, onSelect }: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Platform category"
      style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        background: "var(--muted)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden",
      }}
    >
      <TabButton tab="ai"   activeTab={activeTab} emoji="🤖" label="AI Chat" onSelect={onSelect} />
      <TabButton tab="code" activeTab={activeTab} emoji="💻" label="Code"    onSelect={onSelect} />
    </div>
  );
}

// ── "Show all" expand toggle ─────────────────────────────────────────────────

interface ShowAllButtonProps {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}

function ShowAllButton({ expanded, label, onToggle }: ShowAllButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: "100%", marginTop: 10, padding: 8, borderRadius: 9,
        background: "var(--muted)", border: "1px solid var(--border)",
        fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", cursor: "pointer",
      }}
    >
      {label}
      <span aria-hidden="true" style={{ transition: "transform .2s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
    </button>
  );
}

// ── Mobile expanded grid sections ───────────────────────────────────────────

const MOBILE_GRID_LABEL_STYLE: React.CSSProperties = {
  gridColumn: "1/-1", fontSize: 10, color: "var(--muted-foreground)",
  textTransform: "uppercase", letterSpacing: ".8px", fontWeight: 700, padding: "8px 0 4px",
};

const MOBILE_GRID_DIVIDER_STYLE: React.CSSProperties = {
  border: "none", borderTop: "1px solid var(--border)", margin: "4px 0", gridColumn: "1/-1",
};

// ── Main export ──────────────────────────────────────────────────────────────

interface TestPromptSidebarProps {
  /** The prompt text that will be injected into or copied for the target platform. */
  content: string;
}

/**
 * Sidebar panel listing AI and code platforms where the user can test a prompt.
 *
 * - Desktop: sticky sidebar with full platform lists grouped by category
 * - Mobile: top-3 chips with expandable 2-column grid
 */
export function TestPromptSidebar({ content }: TestPromptSidebarProps) {
  const [activeTab, setActiveTab]       = useState<SidebarTab>("ai");
  const [aiExpanded, setAiExpanded]     = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);

  const sidebarStyle: React.CSSProperties = {
    background: "var(--sidebar)", border: "1px solid var(--border)",
    borderRadius: 14, borderTop: `3px solid ${PM_PURPLE}`,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(45,37,53,.06)",
  };

  return (
    <>
      {/* ── DESKTOP SIDEBAR ── */}
      <aside
        className="hidden lg:block"
        aria-label="Test this prompt in an AI platform"
        style={{ ...sidebarStyle, position: "sticky", top: 68 }}
      >
        <div style={{ padding: "12px 14px 0", display: "flex", alignItems: "center", gap: 7 }}>
          <StatusDot />
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 1 }}>
            Test Prompt
          </span>
        </div>

        <div style={{ margin: "8px 12px 0" }}>
          <TabBar activeTab={activeTab} onSelect={setActiveTab} />
        </div>

        <div
          id="sidebar-panel-ai"
          role="tabpanel"
          aria-label="AI Chat platforms"
          hidden={activeTab !== "ai"}
          style={{ padding: "8px 10px 14px", maxHeight: 540, overflowY: "auto" }}
        >
          <GroupLabel label="Mainstream" />
          {AI_MAINSTREAM.map(p => <PlatformRow key={p.id} platform={p} content={content} />)}
          <PlatformDivider />
          <GroupLabel label="More" />
          {AI_MORE.map(p => <PlatformRow key={p.id} platform={p} content={content} />)}
        </div>

        <div
          id="sidebar-panel-code"
          role="tabpanel"
          aria-label="Code platforms"
          hidden={activeTab !== "code"}
          style={{ padding: "8px 10px 14px", maxHeight: 540, overflowY: "auto" }}
        >
          <GroupLabel label="Web Builders" />
          {CODE_BUILDERS.map(p => <PlatformRow key={p.id} platform={p} content={content} />)}
          <PlatformDivider />
          <GroupLabel label="IDE / Editor" />
          {CODE_IDE.map(p => <PlatformRow key={p.id} platform={p} content={content} />)}
        </div>
      </aside>

      {/* ── MOBILE TEST PANEL ── */}
      <div
        className="lg:hidden"
        aria-label="Test this prompt in an AI platform"
        style={{ ...sidebarStyle, marginTop: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid var(--border)", gap: 7 }}>
          <StatusDot />
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 1 }}>
            Test Prompt
          </span>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <div style={{ marginBottom: 12 }}>
            <TabBar activeTab={activeTab} onSelect={setActiveTab} />
          </div>

          {/* AI tab */}
          <div
            id="mobile-panel-ai"
            role="tabpanel"
            aria-label="AI Chat platforms"
            hidden={activeTab !== "ai"}
          >
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {AI_MAINSTREAM.slice(0, 3).map(p => <PlatformChip key={p.id} platform={p} content={content} />)}
            </div>
            <ShowAllButton
              expanded={aiExpanded}
              label="Show all AI platforms"
              onToggle={() => setAiExpanded(prev => !prev)}
            />
            {aiExpanded && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  <div style={MOBILE_GRID_LABEL_STYLE}>Mainstream</div>
                  {AI_MAINSTREAM.slice(3).map(p => <PlatformGridButton key={p.id} platform={p} content={content} />)}
                  <hr style={MOBILE_GRID_DIVIDER_STYLE} />
                  <div style={MOBILE_GRID_LABEL_STYLE}>More</div>
                  {AI_MORE.map(p => <PlatformGridButton key={p.id} platform={p} content={content} />)}
                </div>
              </div>
            )}
          </div>

          {/* Code tab */}
          <div
            id="mobile-panel-code"
            role="tabpanel"
            aria-label="Code platforms"
            hidden={activeTab !== "code"}
          >
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {CODE_BUILDERS.slice(0, 3).map(p => <PlatformChip key={p.id} platform={p} content={content} />)}
            </div>
            <ShowAllButton
              expanded={codeExpanded}
              label="Show all code platforms"
              onToggle={() => setCodeExpanded(prev => !prev)}
            />
            {codeExpanded && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  <div style={MOBILE_GRID_LABEL_STYLE}>Web Builders</div>
                  {CODE_BUILDERS.slice(3).map(p => <PlatformGridButton key={p.id} platform={p} content={content} />)}
                  <hr style={MOBILE_GRID_DIVIDER_STYLE} />
                  <div style={MOBILE_GRID_LABEL_STYLE}>IDE / Editor</div>
                  {CODE_IDE.map(p => <PlatformGridButton key={p.id} platform={p} content={content} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
